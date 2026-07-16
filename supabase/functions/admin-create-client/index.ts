import { z } from "npm:zod@3.25.76";
import { isAllowedOrigin, jsonResponse, normalizeOrigin, preflightResponse } from "../_shared/http.ts";
import { bearerToken } from "../_shared/security.ts";
import { adminClient } from "../_shared/supabase.ts";

const createSchema = z.object({
  fullName: z.string().trim().min(3).max(160),
  birthDate: z.string().date(),
  email: z.string().trim().email(),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).optional(),
  accessChannel: z.enum(["email", "phone"]),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  planName: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  address: z.object({
    postalCode: z.string().trim().min(3).max(16),
    street: z.string().trim().min(2).max(160),
    number: z.string().trim().min(1).max(30),
    complement: z.string().trim().max(120).optional(),
    neighborhood: z.string().trim().min(2).max(100),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(80),
    countryCode: z.string().trim().length(2).default("BR"),
  }),
}).refine((data) => data.accessChannel === "email" ? Boolean(data.email) : Boolean(data.phone), {
  message: "O canal escolhido precisa estar preenchido",
}).refine((data) => data.endsOn >= data.startsOn, {
  message: "A data final deve ser igual ou posterior à inicial",
}).refine((data) => data.birthDate <= new Date().toISOString().slice(0, 10), {
  message: "A data de nascimento não pode estar no futuro",
}).refine((data) => data.address.countryCode.toUpperCase() !== "BR" || /^[A-Za-z]{2}$/.test(data.address.state), {
  message: "Informe uma UF válida",
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return preflightResponse(request);
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Método não permitido" }, 405);
  }

  if (!isAllowedOrigin(request)) {
    return jsonResponse(request, { error: "Origem não autorizada" }, 403);
  }

  const token = bearerToken(request);
  if (!token) {
    return jsonResponse(request, { error: "Sessão administrativa ausente" }, 401);
  }

  const admin = adminClient();
  let createdAuthUserId: string | null = null;

  try {
    const { data: callerResult, error: callerError } = await admin.auth.getUser(token);
    const caller = callerResult?.user;
    if (callerError || !caller) {
      return jsonResponse(request, { error: "Sessão administrativa inválida" }, 401);
    }

    const { data: staff } = await admin
      .from("staff_members")
      .select("role, active")
      .eq("user_id", caller.id)
      .eq("active", true)
      .in("role", ["super_admin", "manager"])
      .maybeSingle();

    if (!staff) {
      return jsonResponse(request, { error: "Operação não autorizada" }, 403);
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(request, {
        error: "Dados inválidos",
        fields: parsed.error.flatten().fieldErrors,
      }, 400);
    }

    const body = parsed.data;
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email: body.email,
      phone: body.phone,
      email_confirm: Boolean(body.email),
      phone_confirm: Boolean(body.phone),
      user_metadata: { full_name: body.fullName },
    });

    if (createUserError || !createdUser.user) {
      const authError = `${createUserError?.code ?? ""} ${createUserError?.message ?? ""}`.toLowerCase();
      if (authError.includes("email") && (
        authError.includes("exist") ||
        authError.includes("already") ||
        authError.includes("registered")
      )) {
        return jsonResponse(request, {
          code: "email_already_registered",
          error: "Este e-mail já pertence a outro usuário. Use um e-mail exclusivo para o cliente.",
        }, 409);
      }
      if (authError.includes("phone") && (
        authError.includes("exist") ||
        authError.includes("already") ||
        authError.includes("registered")
      )) {
        return jsonResponse(request, {
          code: "phone_already_registered",
          error: "Este telefone já pertence a outro usuário. Use um telefone exclusivo para o cliente.",
        }, 409);
      }
      console.error("admin-create-client auth user failed", createUserError?.code ?? "unknown");
      return jsonResponse(request, {
        code: "auth_user_creation_failed",
        error: "Não foi possível criar o acesso. Confira e-mail, telefone e configurações do Auth.",
      }, 409);
    }

    createdAuthUserId = createdUser.user.id;
    const { data: bundle, error: bundleError } = await admin.rpc("create_client_bundle", {
      p_actor_user_id: caller.id,
      p_auth_user_id: createdAuthUserId,
      p_full_name: body.fullName,
      p_email: body.email ?? "",
      p_phone_e164: body.phone ?? "",
      p_access_channel: body.accessChannel,
      p_birth_date: body.birthDate,
      p_notes: body.notes ?? null,
      p_postal_code: body.address.postalCode,
      p_street: body.address.street,
      p_number: body.address.number,
      p_complement: body.address.complement ?? null,
      p_neighborhood: body.address.neighborhood,
      p_city: body.address.city,
      p_state: body.address.state,
      p_country_code: body.address.countryCode.toUpperCase(),
      p_starts_on: body.startsOn,
      p_ends_on: body.endsOn,
      p_plan_name: body.planName ?? null,
    });

    if (bundleError || !bundle) {
      await admin.auth.admin.deleteUser(createdAuthUserId);
      createdAuthUserId = null;
      throw bundleError ?? new Error("Falha ao criar cadastro do cliente");
    }

    const appUrl = normalizeOrigin(Deno.env.get("APP_URL") ?? "http://localhost:5173");
    return jsonResponse(request, {
      clientId: bundle.clientId,
      publicId: bundle.publicId,
      accessLink: `${appUrl}/c/${bundle.publicId}`,
    }, 201);
  } catch (error) {
    if (createdAuthUserId) {
      await admin.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
    }
    const errorCode = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "unknown";
    console.error("admin-create-client failed", errorCode);
    return jsonResponse(request, { error: "Não foi possível concluir o cadastro" }, 500);
  }
});
