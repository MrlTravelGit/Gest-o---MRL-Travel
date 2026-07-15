import { z } from "npm:zod@3.25.76";
import { corsHeaders, isAllowedOrigin, jsonResponse } from "../_shared/http.ts";
import { requestHashes } from "../_shared/security.ts";
import { adminClient, publicAuthClient } from "../_shared/supabase.ts";

const verifySchema = z.object({
  publicId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(60),
  challengeId: z.string().uuid(),
  code: z.string().trim().regex(/^[0-9]{6,8}$/),
});

const GENERIC_ERROR = {
  error: "Não foi possível validar o acesso. Solicite um novo código.",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Método não permitido" }, 405);
  }

  if (!isAllowedOrigin(request)) {
    return jsonResponse(request, { error: "Origem não autorizada" }, 403);
  }

  try {
    const parsed = verifySchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const { publicId, firstName, challengeId, code } = parsed.data;
    const hashes = await requestHashes(request, publicId, firstName);
    const admin = adminClient();
    const { data: challenge } = await admin
      .from("client_access_challenges")
      .select("id, client_id, user_id, channel, status, attempts, expires_at")
      .eq("id", challengeId)
      .eq("status", "pending")
      .maybeSingle();

    if (!challenge || new Date(challenge.expires_at).getTime() < Date.now() || challenge.attempts >= 5) {
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("id", challenge.client_id)
      .eq("public_id", publicId)
      .eq("status", "active")
      .maybeSingle();

    if (!client) {
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const { data: authUserResult } = await admin.auth.admin.getUserById(challenge.user_id);
    const authUser = authUserResult?.user;
    if (!authUser) {
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const auth = publicAuthClient();
    const verification = challenge.channel === "email" && authUser.email
      ? await auth.auth.verifyOtp({ email: authUser.email, token: code, type: "email" })
      : challenge.channel === "phone" && authUser.phone
        ? await auth.auth.verifyOtp({ phone: authUser.phone, token: code, type: "sms" })
        : { data: { session: null, user: null }, error: new Error("Contato indisponível") };

    if (verification.error || !verification.data.session || verification.data.user?.id !== challenge.user_id) {
      const nextAttempts = challenge.attempts + 1;
      await Promise.all([
        admin
          .from("client_access_challenges")
          .update({
            attempts: nextAttempts,
            status: nextAttempts >= 5 ? "blocked" : "pending",
          })
          .eq("id", challenge.id),
        admin.from("login_events").insert({
          user_id: challenge.user_id,
          client_id: challenge.client_id,
          event_type: nextAttempts >= 5 ? "blocked" : "code_failed",
          fingerprint_hash: hashes.fingerprintHash,
        }),
      ]);
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    await Promise.all([
      admin
        .from("client_access_challenges")
        .update({ status: "verified", verified_at: new Date().toISOString() })
        .eq("id", challenge.id),
      admin.from("login_events").insert({
        user_id: challenge.user_id,
        client_id: challenge.client_id,
        event_type: "code_verified",
        fingerprint_hash: hashes.fingerprintHash,
      }),
    ]);

    return jsonResponse(request, {
      accessToken: verification.data.session.access_token,
      refreshToken: verification.data.session.refresh_token,
      expiresIn: verification.data.session.expires_in,
    });
  } catch (error) {
    console.error("verify-client-access failed", error instanceof Error ? error.message : "unknown");
    return jsonResponse(request, GENERIC_ERROR, 401);
  }
});
