import { z } from "npm:zod@3.25.76";
import { requireAdmin, adminErrorResponse } from "../_shared/admin-auth.ts";
import { hashClientLinkToken } from "../_shared/client-link.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { decryptToken, encryptToken, newToken } from "../_shared/token-vault.ts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), clientId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("rotate"), clientId: z.string().uuid(), expiresAt: z.string().datetime().nullable().optional(), notes: z.string().max(500).optional() }).strict(),
  z.object({ action: z.literal("revoke"), linkId: z.string().uuid(), reason: z.string().max(500).optional() }).strict(),
  z.object({ action: z.literal("copy"), linkId: z.string().uuid() }).strict(),
]);

function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://gestao-mrltravel.vercel.app").replace(/\/+$/, "");
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function safeLinkResponse(link: Record<string, unknown> | null, url: string | null, recoverable: boolean) {
  if (!link) return { hasActiveLink: false, recoverable: false, requiresRotation: false, url: null };
  return {
    hasActiveLink: true,
    recoverable,
    requiresRotation: !recoverable,
    url,
    linkId: link.id,
    createdAt: link.created_at,
    expiresAt: link.expires_at,
    lastUsedAt: link.last_used_at,
    useCount: link.use_count ?? 0,
  };
}

async function activeLinkForClient(clientId: string) {
  const admin = adminClient();
  const { data, error } = await admin
    .from("client_direct_access_links")
    .select("id, client_id, status, expires_at, created_at, last_used_at, use_count, token_ciphertext, token_iv")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function responseForActiveLink(clientId: string) {
  const link = await activeLinkForClient(clientId);
  if (!link) return safeLinkResponse(null, null, false);
  if (!link.token_ciphertext || !link.token_iv) return safeLinkResponse(link, null, false);
  const token = await decryptToken(link.token_ciphertext, link.token_iv);
  return safeLinkResponse(link, `${appUrl()}/economia/${token}`, true);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido" }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada" }, 403);

  try {
    const actor = await requireAdmin(request, ["super_admin", "manager"]);
    const parsed = bodySchema.safeParse(await readBody(request));
    if (!parsed.success) return jsonResponse(request, { error: "Requisição inválida." }, 400);

    const admin = adminClient();

    if (parsed.data.action === "get") {
      const result = await responseForActiveLink(parsed.data.clientId);
      if (result.hasActiveLink) {
        await admin.from("audit_logs").insert({
          actor_user_id: actor.userId,
          client_id: parsed.data.clientId,
          action: "view_direct_access_link",
          table_name: "client_direct_access_links",
          record_id: result.linkId ?? null,
          new_data: { recoverable: result.recoverable },
        });
      }
      return jsonResponse(request, result);
    }

    if (parsed.data.action === "copy") {
      const { data: link } = await admin.from("client_direct_access_links").select("id, client_id").eq("id", parsed.data.linkId).maybeSingle();
      if (link) {
        await admin.from("audit_logs").insert({
          actor_user_id: actor.userId,
          client_id: link.client_id,
          action: "copy_direct_access_link",
          table_name: "client_direct_access_links",
          record_id: link.id,
          new_data: { copied: true },
        });
      }
      return jsonResponse(request, { ok: true });
    }

    if (parsed.data.action === "revoke") {
      const { data: link, error } = await admin
        .from("client_direct_access_links")
        .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: actor.userId, notes: parsed.data.reason ?? null })
        .eq("id", parsed.data.linkId)
        .select("id, client_id, status")
        .maybeSingle();
      if (error) throw error;
      if (!link) return jsonResponse(request, { error: "Link não encontrado." }, 404);
      await admin.from("audit_logs").insert({
        actor_user_id: actor.userId,
        client_id: link.client_id,
        action: "revoke_direct_access_link",
        table_name: "client_direct_access_links",
        record_id: link.id,
        new_data: { reason: parsed.data.reason ?? null },
      });
      return jsonResponse(request, { hasActiveLink: false, recoverable: false, requiresRotation: false, url: null, revokedLinkId: link.id });
    }

    const { data: client, error: clientError } = await admin
      .from("clients")
      .select("id, status")
      .eq("id", parsed.data.clientId)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client || client.status !== "active") return jsonResponse(request, { error: "Cliente ativo não encontrado." }, 404);

    const previous = await activeLinkForClient(parsed.data.clientId);
    if (previous) {
      await admin
        .from("client_direct_access_links")
        .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: actor.userId })
        .eq("id", previous.id);
    }

    const token = newToken();
    const tokenHash = await hashClientLinkToken(token);
    const encrypted = await encryptToken(token);
    const { data: inserted, error: insertError } = await admin
      .from("client_direct_access_links")
      .insert({
        client_id: parsed.data.clientId,
        token_hash: tokenHash,
        token_ciphertext: encrypted.ciphertext,
        token_iv: encrypted.iv,
        token_key_version: encrypted.keyVersion,
        rotated_from: previous?.id ?? null,
        expires_at: parsed.data.expiresAt ?? null,
        notes: parsed.data.notes ?? null,
        created_by: actor.userId,
      })
      .select("id, client_id, status, expires_at, created_at, last_used_at, use_count, token_ciphertext, token_iv")
      .single();
    if (insertError) throw insertError;

    await admin.from("audit_logs").insert({
      actor_user_id: actor.userId,
      client_id: parsed.data.clientId,
      action: previous ? "rotate_direct_access_link" : "create_direct_access_link",
      table_name: "client_direct_access_links",
      record_id: inserted.id,
      new_data: { previousLinkId: previous?.id ?? null, expiresAt: parsed.data.expiresAt ?? null },
    });

    return jsonResponse(request, safeLinkResponse(inserted, `${appUrl()}/economia/${token}`, true));
  } catch (error) {
    return adminErrorResponse(error, request, { "Cache-Control": "no-store" });
  }
});
