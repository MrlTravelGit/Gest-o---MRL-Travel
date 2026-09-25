import { z } from "npm:zod@3.25.76";
import { adminErrorResponse, requireAdmin } from "../_shared/admin-auth.ts";
import { sendCustomerContractApprovedMessage } from "../_shared/contract-notifications.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const schema = z.object({ signatureRequestId: z.string().uuid() }).strict();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada." }, 403);
  try {
    await requireAdmin(request, ["super_admin", "manager"]);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonResponse(request, { error: "Solicitação inválida." }, 422);
    const admin = adminClient();
    const found = await admin.from("contract_signature_requests")
      .select("id,contract_id,client_id,approved_at,signed_pdf_url,pades_pdf_url,client_contracts(client_name),clients(full_name,email,phone_e164,whatsapp_e164)")
      .eq("id", parsed.data.signatureRequestId).maybeSingle();
    if (found.error || !found.data) return jsonResponse(request, { error: "Contrato não encontrado." }, 404);
    if (!found.data.approved_at) return jsonResponse(request, { error: "O contrato ainda não foi aprovado." }, 409);
    const client = found.data.clients as unknown as { full_name?: string; email?: string | null; phone_e164?: string | null; whatsapp_e164?: string | null } | null;
    const contract = found.data.client_contracts as unknown as { client_name?: string } | null;
    if (!found.data.client_id) return jsonResponse(request, { error: "Cliente não vinculado ao contrato." }, 422);
    const outcome = await sendCustomerContractApprovedMessage(admin, {
      requestId: found.data.id, clientId: found.data.client_id, contractId: found.data.contract_id,
      customerName: client?.full_name ?? contract?.client_name ?? "Cliente",
      customerPhone: client?.whatsapp_e164 ?? client?.phone_e164 ?? null,
      customerEmail: client?.email ?? null,
      signedPdfUrl: found.data.pades_pdf_url ?? found.data.signed_pdf_url ?? null,
      force: true,
    });
    return jsonResponse(request, { outcome });
  } catch (error) {
    if (error instanceof Response) return adminErrorResponse(error, request, {});
    console.error("resend-contract-approved-message failed", error instanceof Error ? error.message : "unknown");
    return jsonResponse(request, { error: "Não foi possível reenviar a mensagem ao cliente." }, 500);
  }
});
