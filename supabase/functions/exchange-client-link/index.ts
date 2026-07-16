import { z } from "npm:zod@3.25.76";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient, publicAuthClient } from "../_shared/supabase.ts";

const schema = z.object({
  token: z.string().trim().regex(/^[a-f0-9]{64}$/i),
});

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fingerprint(request: Request): Promise<string> {
  const raw = [
    request.headers.get("x-forwarded-for") ?? "",
    request.headers.get("user-agent") ?? "",
    request.headers.get("accept-language") ?? "",
  ].join("|").slice(0, 500);
  return sha256Hex(raw);
}

const GENERIC_ERROR = { error: "Link inválido, expirado ou revogado." };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido" }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada" }, 403);

  const admin = adminClient();
  const fingerprintHash = await fingerprint(request);

  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      await admin.from("client_direct_access_events").insert({ event_type: "invalid", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const tokenHash = await sha256Hex(parsed.data.token.toLowerCase());
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("client_direct_access_events")
      .select("id", { count: "exact", head: true })
      .eq("fingerprint_hash", fingerprintHash)
      .gte("created_at", windowStart);

    if ((count ?? 0) >= 10) {
      await admin.from("client_direct_access_events").insert({ event_type: "rate_limited", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 429);
    }

    const { data: link } = await admin
      .from("client_direct_access_links")
      .select("id, client_id, status, expires_at, use_count")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!link) {
      await admin.from("client_direct_access_events").insert({ event_type: "invalid", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    if (link.status !== "active") {
      await admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "revoked", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      await Promise.all([
        admin.from("client_direct_access_links").update({ status: "expired" }).eq("id", link.id),
        admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "expired", fingerprint_hash: fingerprintHash }),
      ]);
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: client } = await admin
      .from("clients")
      .select("id, status")
      .eq("id", link.client_id)
      .eq("status", "active")
      .maybeSingle();

    const { data: contract } = await admin
      .from("management_contracts")
      .select("id")
      .eq("client_id", link.client_id)
      .eq("status", "active")
      .lte("starts_on", today)
      .gte("ends_on", today)
      .limit(1)
      .maybeSingle();

    if (!client || !contract) {
      await admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "inactive", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const { data: clientUsers } = await admin
      .from("client_users")
      .select("user_id")
      .eq("client_id", link.client_id)
      .eq("active", true)
      .limit(1);

    const userId = clientUsers?.[0]?.user_id;
    if (!userId) {
      await admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "no_user", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const { data: authUserResult } = await admin.auth.admin.getUserById(userId);
    const authUser = authUserResult?.user;
    if (!authUser?.email) {
      await admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "no_user", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const generated = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: authUser.email,
      options: { shouldCreateUser: false },
    });
    const tokenHashForAuth = generated.data?.properties?.hashed_token;
    if (generated.error || !tokenHashForAuth) throw generated.error ?? new Error("Magic link sem token hash");

    const verification = await publicAuthClient().auth.verifyOtp({
      type: "magiclink",
      email: authUser.email,
      token_hash: tokenHashForAuth,
    });
    if (verification.error || !verification.data.session) throw verification.error ?? new Error("Sessão não criada");

    await Promise.all([
      admin.from("client_direct_access_links").update({ last_used_at: new Date().toISOString(), use_count: (link.use_count ?? 0) + 1 }).eq("id", link.id),
      admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "success", fingerprint_hash: fingerprintHash }),
    ]);

    return jsonResponse(request, {
      accessToken: verification.data.session.access_token,
      refreshToken: verification.data.session.refresh_token,
      expiresIn: verification.data.session.expires_in,
    });
  } catch (error) {
    console.error("exchange-client-link failed", error instanceof Error ? error.message : "unknown");
    await admin.from("client_direct_access_events").insert({ event_type: "exchange_failed", fingerprint_hash: fingerprintHash });
    return jsonResponse(request, GENERIC_ERROR, 401);
  }
});
