import { z } from "npm:zod@3.25.76";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { normalizeFirstName, requestHashes } from "../_shared/security.ts";
import { adminClient, publicAuthClient } from "../_shared/supabase.ts";

const requestSchema = z.object({
  publicId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(60),
});

const GENERIC_RESPONSE = {
  accepted: true,
  message: "Se os dados coincidirem, enviaremos um código ao contato cadastrado.",
  destination: "contato cadastrado",
};

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

  let challengeId = crypto.randomUUID();

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    const { publicId, firstName } = parsed.data;
    const normalizedName = normalizeFirstName(firstName);
    const hashes = await requestHashes(request, publicId, firstName);
    const admin = adminClient();
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const [fingerprintLimit, publicIdLimit] = await Promise.all([
      admin
        .from("client_access_attempts")
        .select("id", { count: "exact", head: true })
        .eq("fingerprint_hash", hashes.fingerprintHash)
        .gte("created_at", windowStart),
      admin
        .from("client_access_attempts")
        .select("id", { count: "exact", head: true })
        .eq("public_id_hash", hashes.publicIdHash)
        .gte("created_at", windowStart),
    ]);

    const blocked = (fingerprintLimit.count ?? 0) >= 5 || (publicIdLimit.count ?? 0) >= 8;
    if (blocked) {
      await admin.from("client_access_attempts").insert({
        public_id_hash: hashes.publicIdHash,
        fingerprint_hash: hashes.fingerprintHash,
        first_name_hash: hashes.firstNameHash,
        accepted: false,
      });
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("public_id", publicId)
      .eq("status", "active")
      .maybeSingle();

    if (!client) {
      await admin.from("client_access_attempts").insert({
        public_id_hash: hashes.publicIdHash,
        fingerprint_hash: hashes.fingerprintHash,
        first_name_hash: hashes.firstNameHash,
        accepted: false,
      });
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: contract } = await admin
      .from("management_contracts")
      .select("id")
      .eq("client_id", client.id)
      .eq("status", "active")
      .lte("starts_on", today)
      .gte("ends_on", today)
      .limit(1)
      .maybeSingle();

    if (!contract) {
      await admin.from("client_access_attempts").insert({
        client_id: client.id,
        public_id_hash: hashes.publicIdHash,
        fingerprint_hash: hashes.fingerprintHash,
        first_name_hash: hashes.firstNameHash,
        accepted: false,
      });
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    const { data: links } = await admin
      .from("client_users")
      .select("user_id")
      .eq("client_id", client.id)
      .eq("active", true);

    const userIds = (links ?? []).map((link) => link.user_id);
    if (userIds.length === 0) {
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, first_name_normalized, preferred_access_channel, active")
      .in("id", userIds)
      .eq("first_name_normalized", normalizedName)
      .eq("active", true)
      .limit(2);

    if (!profiles || profiles.length !== 1) {
      await admin.from("client_access_attempts").insert({
        client_id: client.id,
        public_id_hash: hashes.publicIdHash,
        fingerprint_hash: hashes.fingerprintHash,
        first_name_hash: hashes.firstNameHash,
        accepted: false,
      });
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    const profile = profiles[0];
    const { data: authUserResult, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
    const authUser = authUserResult?.user;
    if (authUserError || !authUser) {
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    const channel = profile.preferred_access_channel === "phone" && authUser.phone
      ? "phone"
      : "email";

    if (channel === "email" && !authUser.email) {
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    if (channel === "phone" && !authUser.phone) {
      return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
    }

    challengeId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: challengeError } = await admin.from("client_access_challenges").insert({
      id: challengeId,
      client_id: client.id,
      user_id: profile.id,
      channel,
      expires_at: expiresAt,
      fingerprint_hash: hashes.fingerprintHash,
    });

    if (challengeError) throw challengeError;

    const auth = publicAuthClient();
    const otpResult = channel === "email"
      ? await auth.auth.signInWithOtp({
          email: authUser.email!,
          options: { shouldCreateUser: false },
        })
      : await auth.auth.signInWithOtp({
          phone: authUser.phone!,
          options: { shouldCreateUser: false },
        });

    if (otpResult.error) {
      await admin
        .from("client_access_challenges")
        .update({ status: "blocked" })
        .eq("id", challengeId);
      throw otpResult.error;
    }

    await Promise.all([
      admin.from("client_access_attempts").insert({
        client_id: client.id,
        public_id_hash: hashes.publicIdHash,
        fingerprint_hash: hashes.fingerprintHash,
        first_name_hash: hashes.firstNameHash,
        accepted: true,
      }),
      admin.from("login_events").insert({
        user_id: profile.id,
        client_id: client.id,
        event_type: "code_requested",
        fingerprint_hash: hashes.fingerprintHash,
      }),
    ]);

    return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
  } catch (error) {
    console.error("request-client-access failed", error instanceof Error ? error.message : "unknown");
    return jsonResponse(request, { ...GENERIC_RESPONSE, challengeId }, 202);
  }
});
