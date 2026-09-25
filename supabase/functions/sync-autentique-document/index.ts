import { z } from "npm:zod@3.25.76";
import { adminErrorResponse, requireAdmin } from "../_shared/admin-auth.ts";
import { fetchAutentiqueDocument, persistAutentiqueDocument } from "../_shared/autentique.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const requestSchema = z.object({ signatureRequestId: z.string().uuid() }).strict();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada." }, 403);
  try {
    await requireAdmin(request, ["super_admin", "manager"]);
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonResponse(request, { error: "Solicitação de assinatura inválida." }, 422);
    const admin = adminClient();
    const found = await admin.from("contract_signature_requests")
      .select("id,provider_document_id")
      .eq("id", parsed.data.signatureRequestId).maybeSingle();
    if (found.error || !found.data) return jsonResponse(request, { error: "Envio para assinatura não encontrado." }, 404);
    if (!found.data.provider_document_id) return jsonResponse(request, { error: "O contrato ainda não possui documento na Autentique." }, 422);
    const document = await fetchAutentiqueDocument(found.data.provider_document_id);
    await persistAutentiqueDocument(admin, found.data.id, document);
    const refreshed = await admin.from("contract_signature_requests")
      .select("id,status,sandbox,provider_document_id,provider_document_name,signed_pdf_url,pades_pdf_url,error_message,production_month_key,approved_at,customer_notified_at,customer_notification_status,customer_notification_error,created_at,updated_at,contract_signature_signers(*)")
      .eq("id", found.data.id).single();
    if (refreshed.error) throw refreshed.error;
    return jsonResponse(request, { request: refreshed.data });
  } catch (error) {
    if (error instanceof Response) return adminErrorResponse(error, request, {});
    const code = error instanceof Error ? error.message : "AUTENTIQUE_SYNC_FAILED";
    console.error("sync-autentique-document failed", code);
    return jsonResponse(request, {
      code,
      error: code === "AUTENTIQUE_NOT_CONFIGURED"
        ? "Integração com Autentique não configurada."
        : "Não foi possível atualizar o status na Autentique.",
    }, code === "AUTENTIQUE_NOT_CONFIGURED" ? 503 : 502);
  }
});
