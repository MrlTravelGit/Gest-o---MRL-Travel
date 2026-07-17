import { z } from "npm:zod@3.25.76";
import { hashClientLinkToken, isClientLinkTokenFormat, requestFingerprintHash } from "../_shared/client-link.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const schema = z.object({
  token: z.string().refine(isClientLinkTokenFormat),
});

const GENERIC_ERROR = { error: "Painel indisponível." };

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido" }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada" }, 403);

  const admin = adminClient();
  const fingerprintHash = await requestFingerprintHash(request);

  try {
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      await admin.from("client_direct_access_events").insert({ event_type: "invalid", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 400);
    }

    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("client_direct_access_events")
      .select("id", { count: "exact", head: true })
      .eq("fingerprint_hash", fingerprintHash)
      .gte("created_at", windowStart);

    if ((count ?? 0) >= 20) {
      await admin.from("client_direct_access_events").insert({ event_type: "rate_limited", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 429);
    }

    const tokenHash = await hashClientLinkToken(parsed.data.token);
    const { data: link } = await admin
      .from("client_direct_access_links")
      .select("id, client_id, status, expires_at, use_count")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!link || link.status !== "active") {
      await admin.from("client_direct_access_events").insert({
        link_id: link?.id ?? null,
        client_id: link?.client_id ?? null,
        event_type: link ? "revoked" : "invalid",
        fingerprint_hash: fingerprintHash,
      });
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
    const [{ data: client }, { data: contract }] = await Promise.all([
      admin.from("clients").select("id").eq("id", link.client_id).eq("status", "active").maybeSingle(),
      admin
        .from("management_contracts")
        .select("id")
        .eq("client_id", link.client_id)
        .in("status", ["active", "paused"])
        .lte("starts_on", today)
        .gte("ends_on", today)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!client || !contract) {
      await admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "inactive", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const { data: dashboard, error: dashboardError } = await admin.rpc("build_public_client_dashboard_payload", { p_client_id: link.client_id });
    if (dashboardError || !dashboard) throw dashboardError ?? new Error("dashboard payload vazio");

    await Promise.all([
      admin.from("client_direct_access_links").update({ last_used_at: new Date().toISOString(), use_count: (link.use_count ?? 0) + 1 }).eq("id", link.id),
      admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "success", fingerprint_hash: fingerprintHash }),
    ]);

    return jsonResponse(request, dashboard);
  } catch (error) {
    console.error("get-client-dashboard-by-link failed", error instanceof Error ? error.message : "unknown");
    await admin.from("client_direct_access_events").insert({ event_type: "exchange_failed", fingerprint_hash: fingerprintHash });
    return jsonResponse(request, GENERIC_ERROR, 401);
  }
});
