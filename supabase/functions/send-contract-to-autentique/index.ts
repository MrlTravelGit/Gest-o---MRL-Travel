import { z } from "npm:zod@3.25.76";
import { adminErrorResponse, requireAdmin } from "../_shared/admin-auth.ts";
import { createAutentiqueDocument, autentiqueSandbox } from "../_shared/autentique.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const signerSchema = z.object({
  name: z.string().trim().min(2).max(180),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(24).optional().or(z.literal("")),
  cpf: z.string().trim().max(24).optional().or(z.literal("")),
  action: z.string().trim().default("SIGN"),
  deliveryMethod: z.enum(["link", "email", "whatsapp", "sms"]).default("link"),
}).superRefine((signer, context) => {
  if (signer.deliveryMethod === "email" && !signer.email) context.addIssue({ code: "custom", message: "E-mail obrigatório." });
  if (["whatsapp", "sms"].includes(signer.deliveryMethod) && !signer.phone) context.addIssue({ code: "custom", message: "Telefone obrigatório." });
});

const requestSchema = z.object({
  contractId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  pdfPath: z.string().trim().optional(),
  documentName: z.string().trim().min(2).max(255),
  sandbox: z.boolean().default(true),
  signers: z.array(signerSchema).min(1).max(20),
}).strict();

function failure(request: Request, code: string, status: number): Response {
  const messages: Record<string, string> = {
    CONTRACT_PDF_REQUIRED: "Gere o PDF do contrato antes de enviar para assinatura.",
    CONTRACT_SIGNER_REQUIRED: "Adicione pelo menos um signatário para enviar o contrato.",
    AUTENTIQUE_NOT_CONFIGURED: "Integração com Autentique não configurada.",
    AUTENTIQUE_FILE_TOO_LARGE: "O PDF excede o limite aceito pela Autentique.",
    AUTENTIQUE_API_FAILED: "Não foi possível enviar o contrato para assinatura. Tente novamente.",
    CONTRACT_ALREADY_SENT: "Este contrato já foi enviado para assinatura.",
    AUTENTIQUE_MODE_MISMATCH: "O modo escolhido não corresponde à configuração segura do servidor.",
  };
  return jsonResponse(request, { code, error: messages[code] ?? messages.AUTENTIQUE_API_FAILED }, status);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada." }, 403);
  let signatureRequestId: string | null = null;
  try {
    const actor = await requireAdmin(request, ["super_admin", "manager"]);
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      const noSigners = parsed.error.issues.some((issue) => issue.path[0] === "signers");
      return failure(request, noSigners ? "CONTRACT_SIGNER_REQUIRED" : "AUTENTIQUE_API_FAILED", 422);
    }
    const input = parsed.data;
    const admin = adminClient();
    if (input.sandbox !== autentiqueSandbox()) return failure(request, "AUTENTIQUE_MODE_MISMATCH", 409);
    const contractResult = await admin.from("client_contracts")
      .select("id,client_id,contract_number,client_name,pdf_path,status")
      .eq("id", input.contractId).maybeSingle();
    if (contractResult.error || !contractResult.data) return jsonResponse(request, { error: "Contrato não encontrado." }, 404);
    const contract = contractResult.data;
    if (input.clientId && input.clientId !== contract.client_id) return jsonResponse(request, { error: "Contrato não pertence ao cliente informado." }, 422);
    if (!contract.pdf_path || (input.pdfPath && input.pdfPath !== contract.pdf_path)) return failure(request, "CONTRACT_PDF_REQUIRED", 422);

    const existing = await admin.from("contract_signature_requests").select("id,status")
      .eq("contract_id", contract.id).in("status", ["sent","pending_signature","partially_signed","completed"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return failure(request, "CONTRACT_ALREADY_SENT", 409);

    const downloaded = await admin.storage.from("contracts").download(contract.pdf_path);
    if (downloaded.error || !downloaded.data) return failure(request, "CONTRACT_PDF_REQUIRED", 422);
    const maximumBytes = Number(Deno.env.get("AUTENTIQUE_MAX_FILE_BYTES") ?? 5 * 1024 * 1024);
    if (downloaded.data.size > maximumBytes) return failure(request, "AUTENTIQUE_FILE_TOO_LARGE", 413);

    const sandbox = input.sandbox;
    const inserted = await admin.from("contract_signature_requests").insert({
      contract_id: contract.id,
      client_id: contract.client_id,
      provider: "autentique",
      provider_document_name: input.documentName,
      status: "draft",
      sandbox,
      original_pdf_path: contract.pdf_path,
      created_by: actor.userId,
    }).select("id").single();
    if (inserted.error || !inserted.data) throw inserted.error ?? new Error("SIGNATURE_REQUEST_INSERT_FAILED");
    signatureRequestId = inserted.data.id;

    const localSigners = await admin.from("contract_signature_signers").insert(input.signers.map((signer) => ({
      signature_request_id: signatureRequestId,
      name: signer.name,
      email: signer.email || null,
      phone: signer.phone || null,
      cpf: signer.cpf?.replace(/\D/g, "") || null,
      action: signer.action,
      delivery_method: signer.deliveryMethod,
    })));
    if (localSigners.error) throw localSigners.error;

    const document = await createAutentiqueDocument(
      downloaded.data,
      `${contract.contract_number ?? contract.id}.pdf`,
      input.documentName,
      input.signers,
    );
    const signatures = document.signatures ?? [];
    for (let index = 0; index < input.signers.length; index += 1) {
      const local = input.signers[index];
      const remote = signatures.find((signature) => local.email && signature.email?.toLowerCase() === local.email.toLowerCase())
        ?? signatures.find((signature) => signature.name?.toLowerCase() === local.name.toLowerCase())
        ?? signatures[index];
      if (!remote) continue;
      const signerUpdate = await admin.from("contract_signature_signers").update({
        provider_public_id: remote.public_id ?? null,
        signature_link: remote.link?.short_link ?? null,
        raw_signature: remote,
      }).eq("signature_request_id", signatureRequestId).eq("name", local.name);
      if (signerUpdate.error) throw signerUpdate.error;
    }
    const requestUpdate = await admin.from("contract_signature_requests").update({
      provider_document_id: document.id,
      provider_document_name: document.name ?? input.documentName,
      status: signatures.length ? "pending_signature" : "sent",
      raw_response: document,
      error_message: null,
    }).eq("id", signatureRequestId);
    if (requestUpdate.error) throw requestUpdate.error;

    const saved = await admin.from("contract_signature_requests")
      .select("id,status,sandbox,provider_document_id,provider_document_name,contract_signature_signers(*)")
      .eq("id", signatureRequestId).single();
    if (saved.error) throw saved.error;
    return jsonResponse(request, { request: saved.data });
  } catch (error) {
    const code = error instanceof Error ? error.message : "AUTENTIQUE_API_FAILED";
    if (signatureRequestId) {
      try {
        await adminClient().from("contract_signature_requests").update({ status: "failed", error_message: code }).eq("id", signatureRequestId);
      } catch { /* best effort status */ }
    }
    if (error instanceof Response) return adminErrorResponse(error, request, {});
    if (["AUTENTIQUE_NOT_CONFIGURED","AUTENTIQUE_FILE_TOO_LARGE","AUTENTIQUE_API_FAILED"].includes(code)) {
      return failure(request, code, code === "AUTENTIQUE_FILE_TOO_LARGE" ? 413 : code === "AUTENTIQUE_NOT_CONFIGURED" ? 503 : 502);
    }
    console.error("send-contract-to-autentique failed", code);
    return failure(request, "AUTENTIQUE_API_FAILED", 500);
  }
});
