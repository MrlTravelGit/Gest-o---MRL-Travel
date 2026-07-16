import { z } from "npm:zod@3.25.76";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const schema = z.object({
  token: z.string().trim().regex(/^[a-f0-9]{64}$/i),
});

const GENERIC_ERROR = { error: "Página indisponível." };

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

    const tokenHash = await sha256Hex(parsed.data.token.toLowerCase());
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
      admin.from("clients").select("id, full_name, status").eq("id", link.client_id).eq("status", "active").maybeSingle(),
      admin
        .from("management_contracts")
        .select("id")
        .eq("client_id", link.client_id)
        .eq("status", "active")
        .lte("starts_on", today)
        .gte("ends_on", today)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!client || !contract) {
      await admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "inactive", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    const { data: redemptions, error: redemptionsError } = await admin
      .from("redemptions")
      .select("issued_at, launched_on, redemption_type, payment_mode, description, cash_reference_total, effective_cost, savings_amount, created_at")
      .eq("client_id", link.client_id)
      .eq("status", "confirmed")
      .order("issued_at", { ascending: false });

    if (redemptionsError) throw redemptionsError;

    const items = (redemptions ?? []).map((item) => ({
      issuedAt: item.issued_at,
      launchedOn: item.launched_on,
      travelType: item.redemption_type,
      paymentMode: item.payment_mode,
      details: item.description,
      originalValue: Number(item.cash_reference_total ?? 0),
      paidValue: Number(item.effective_cost ?? 0),
      savingsAmount: Number(item.savings_amount ?? 0),
    }));

    const generatedSavings = items.reduce((total, item) => total + item.savingsAmount, 0);
    const lastUpdatedAt = (redemptions ?? []).reduce<string | null>((latest, item) => {
      if (!item.created_at) return latest;
      return latest && latest > item.created_at ? latest : item.created_at;
    }, null);

    await Promise.all([
      admin.from("client_direct_access_links").update({ last_used_at: new Date().toISOString(), use_count: (link.use_count ?? 0) + 1 }).eq("id", link.id),
      admin.from("client_direct_access_events").insert({ link_id: link.id, client_id: link.client_id, event_type: "success", fingerprint_hash: fingerprintHash }),
    ]);

    return jsonResponse(request, {
      client: {
        displayName: client.full_name,
        lastUpdatedAt,
      },
      summary: {
        generatedSavings,
        redemptionsCount: items.length,
        positiveSavingsCount: items.filter((item) => item.savingsAmount > 0).length,
      },
      items,
    });
  } catch (error) {
    console.error("get-client-economy-by-link failed", error instanceof Error ? error.message : "unknown");
    await admin.from("client_direct_access_events").insert({ event_type: "exchange_failed", fingerprint_hash: fingerprintHash });
    return jsonResponse(request, GENERIC_ERROR, 401);
  }
});
