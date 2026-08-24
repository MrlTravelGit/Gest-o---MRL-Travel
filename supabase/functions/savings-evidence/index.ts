import { z } from "npm:zod@3.25.76";
import { requireAdmin, adminErrorResponse } from "../_shared/admin-auth.ts";
import { hashClientLinkToken, isClientLinkTokenFormat } from "../_shared/client-link.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const BUCKET = "savings-evidence";
const MIME_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
const sha256Pattern = /^[a-f0-9]{64}$/;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_upload"), redemptionId: z.string().uuid(), filename: z.string().min(1).max(180), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]), size: z.number().int().positive().max(MAX_BYTES), sha256: z.string().regex(sha256Pattern) }).strict(),
  z.object({ action: z.literal("confirm_upload"), evidenceId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("admin_view"), redemptionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("public_view"), redemptionId: z.string().uuid(), token: z.string().refine(isClientLinkTokenFormat) }).strict(),
  z.object({ action: z.literal("remove"), redemptionId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).strict(),
]);

async function readBody(request: Request) {
  try { return await request.json(); } catch { return {}; }
}

function bytesEqual(bytes: Uint8Array, offset: number, expected: number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function sniffMime(bytes: Uint8Array): keyof typeof MIME_EXTENSIONS | null {
  if (bytes.length >= 12 && bytesEqual(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 3 && bytesEqual(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 12 && bytesEqual(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && bytesEqual(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function activeEvidence(redemptionId: string) {
  const { data, error } = await adminClient().from("saving_evidence_files").select("id,client_id,redemption_id,object_path,mime_type,size_bytes,original_name").eq("redemption_id", redemptionId).eq("status", "active").maybeSingle();
  if (error) throw error;
  return data;
}

async function validatePublicClient(token: string, redemptionId: string) {
  const admin = adminClient();
  const tokenHash = await hashClientLinkToken(token);
  const { data: link } = await admin.from("client_direct_access_links").select("client_id,status,expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (!link || link.status !== "active" || (link.expires_at && new Date(link.expires_at).getTime() < Date.now())) return null;
  const { data: client } = await admin.from("clients").select("id,status").eq("id", link.client_id).maybeSingle();
  if (!client || client.status !== "active") return null;
  const { data: saving } = await admin.from("redemptions").select("id,client_id,status").eq("id", redemptionId).eq("client_id", client.id).eq("status", "confirmed").maybeSingle();
  return saving ? client.id : null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido" }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada" }, 403);
  try {
    const parsed = schema.safeParse(await readBody(request));
    if (!parsed.success) return jsonResponse(request, { error: "Requisição inválida." }, 400);
    const admin = adminClient();

    if (parsed.data.action === "public_view") {
      const clientId = await validatePublicClient(parsed.data.token, parsed.data.redemptionId);
      if (!clientId) return jsonResponse(request, { error: "Comprovante indisponível." }, 401);
      const evidence = await activeEvidence(parsed.data.redemptionId);
      if (!evidence || evidence.client_id !== clientId) return jsonResponse(request, { error: "Comprovante indisponível." }, 404);
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(evidence.object_path, 120, { download: false });
      if (error || !data) throw error ?? new Error("signed URL ausente");
      return jsonResponse(request, { url: data.signedUrl, expiresIn: 120, mimeType: evidence.mime_type, filename: evidence.original_name });
    }

    const actor = await requireAdmin(request, ["super_admin", "manager", "operator"]);
    if (parsed.data.action === "create_upload") {
      const { data: saving } = await admin.from("redemptions").select("id,client_id,status").eq("id", parsed.data.redemptionId).eq("status", "confirmed").maybeSingle();
      if (!saving) return jsonResponse(request, { error: "Economia não encontrada." }, 404);
      const evidenceId = crypto.randomUUID();
      const objectPath = `${saving.client_id}/${saving.id}/${crypto.randomUUID()}.${MIME_EXTENSIONS[parsed.data.mimeType]}`;
      const { error: registerError } = await admin.rpc("register_saving_evidence_pending", { p_actor: actor.userId, p_evidence_id: evidenceId, p_redemption_id: saving.id, p_object_path: objectPath, p_original_name: parsed.data.filename, p_mime_type: parsed.data.mimeType, p_size_bytes: parsed.data.size, p_sha256: parsed.data.sha256 });
      if (registerError) throw registerError;
      const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUploadUrl(objectPath);
      if (signedError || !signed) {
        await admin.from("saving_evidence_files").delete().eq("id", evidenceId).eq("status", "pending");
        throw signedError ?? new Error("upload URL ausente");
      }
      return jsonResponse(request, { evidenceId, path: signed.path, token: signed.token, maxBytes: MAX_BYTES });
    }

    if (parsed.data.action === "confirm_upload") {
      const { data: evidence } = await admin.from("saving_evidence_files").select("id,object_path,mime_type,size_bytes,sha256,status,uploaded_by").eq("id", parsed.data.evidenceId).maybeSingle();
      if (!evidence || evidence.status !== "pending" || evidence.uploaded_by !== actor.userId) return jsonResponse(request, { error: "Upload pendente não encontrado." }, 404);
      const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(evidence.object_path);
      if (downloadError || !blob) throw downloadError ?? new Error("arquivo ausente");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const actualMime = sniffMime(bytes);
      const actualHash = await sha256(bytes);
      if (!actualMime || actualMime !== evidence.mime_type || bytes.length !== Number(evidence.size_bytes) || bytes.length > MAX_BYTES || actualHash !== evidence.sha256) {
        await admin.storage.from(BUCKET).remove([evidence.object_path]);
        await admin.from("saving_evidence_files").delete().eq("id", evidence.id).eq("status", "pending");
        return jsonResponse(request, { error: "O conteúdo do comprovante não corresponde a uma imagem válida." }, 415);
      }
      const { data: confirmed, error: confirmError } = await admin.rpc("confirm_saving_evidence", { p_actor: actor.userId, p_evidence_id: evidence.id, p_actual_mime: actualMime, p_actual_size: bytes.length, p_actual_sha256: actualHash });
      if (confirmError || !confirmed) throw confirmError ?? new Error("confirmação ausente");
      const oldPath = typeof confirmed === "object" && confirmed && "oldPath" in confirmed ? String(confirmed.oldPath ?? "") : "";
      if (oldPath) await admin.storage.from(BUCKET).remove([oldPath]);
      return jsonResponse(request, confirmed);
    }

    if (parsed.data.action === "admin_view") {
      const evidence = await activeEvidence(parsed.data.redemptionId);
      if (!evidence) return jsonResponse(request, { error: "Comprovante não encontrado." }, 404);
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(evidence.object_path, 120, { download: false });
      if (error || !data) throw error ?? new Error("signed URL ausente");
      return jsonResponse(request, { url: data.signedUrl, expiresIn: 120, mimeType: evidence.mime_type, filename: evidence.original_name });
    }

    const { data: removed, error } = await admin.rpc("remove_saving_evidence", { p_actor: actor.userId, p_redemption_id: parsed.data.redemptionId, p_reason: parsed.data.reason });
    if (error || !removed) throw error ?? new Error("remoção ausente");
    const path = typeof removed === "object" && removed && "path" in removed ? String(removed.path ?? "") : "";
    if (path) await admin.storage.from(BUCKET).remove([path]);
    return jsonResponse(request, removed);
  } catch (error) {
    return adminErrorResponse(error, request, { "Cache-Control": "no-store" });
  }
});
