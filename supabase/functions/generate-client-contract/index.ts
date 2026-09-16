import { z } from "npm:zod@3.25.76";
import { adminErrorResponse, requireAdmin } from "../_shared/admin-auth.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { renderContractPdf } from "./render-contract.ts";

const contractSchema = z.object({
  nome: z.string().trim().min(2).max(180), cpf: z.string().trim().max(24).default(""), rg: z.string().trim().max(30).default(""),
  email: z.string().trim().max(180).default(""), estado_civil: z.string().trim().max(80).default(""), profissao: z.string().trim().max(120).default(""),
  endereco: z.string().trim().max(500).default(""), valor_total: z.number().positive().max(100000000), num_parcelas: z.number().int().min(1).max(120),
  valor_parcela: z.number().nonnegative().max(100000000), data: z.string().date(), cidade: z.string().trim().min(2).max(100).default("POMPÉU"),
  incluir_cashback: z.boolean().default(false), pct_cashback: z.number().min(0).max(100).default(2), incluir_reembolso: z.boolean().default(false),
}).strict();
const requestSchema = z.object({ client_id: z.string().uuid(), contract_data: contractSchema }).strict();

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada." }, 403);
  let createdId: string | null = null;
  let objectPath: string | null = null;
  try {
    const actor = await requireAdmin(request, ["super_admin", "manager", "operator"]);
    const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonResponse(request, { code: "INVALID_CONTRACT", error: "Revise os dados obrigatórios do contrato." }, 422);
    const { client_id, contract_data: data } = parsed.data;
    const admin = adminClient();
    const client = await admin.from("clients").select("id").eq("id", client_id).maybeSingle();
    if (client.error || !client.data) return jsonResponse(request, { code: "CLIENT_NOT_FOUND", error: "Cliente não encontrado." }, 404);
    const contractNumber = `MRL-${data.data.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const inserted = await admin.from("client_contracts").insert({
      client_id, contract_number: contractNumber, client_name: data.nome, cpf: data.cpf || null, rg: data.rg || null, email: data.email || null,
      marital_status: data.estado_civil || null, profession: data.profissao || null, full_address: data.endereco || null,
      contract_value: data.valor_total, installments: data.num_parcelas, installment_value: data.valor_parcela,
      signature_city: data.cidade, contract_date: data.data, include_cashback: data.incluir_cashback, cashback_percent: data.pct_cashback,
      include_roi_guarantee: data.incluir_reembolso, contract_data: data, clauses: { cashback: data.incluir_cashback, cashback_percent: data.pct_cashback, roi_guarantee: data.incluir_reembolso },
      generation_version: "server-pdf-v1", document_format: "pdf", created_by: actor.userId,
    }).select("id").single();
    if (inserted.error || !inserted.data) throw inserted.error ?? new Error("CONTRACT_INSERT_FAILED");
    createdId = inserted.data.id;
    objectPath = `${client_id}/${createdId}.pdf`;
    const bytes = await renderContractPdf(data, contractNumber);
    const uploaded = await admin.storage.from("contracts").upload(objectPath, bytes, { contentType: "application/pdf", upsert: true, cacheControl: "3600" });
    if (uploaded.error) throw uploaded.error;
    const updated = await admin.from("client_contracts").update({ pdf_path: objectPath }).eq("id", createdId);
    if (updated.error) throw updated.error;
    const signed = await admin.storage.from("contracts").createSignedUrl(objectPath, 300, { download: `${contractNumber}.pdf` });
    if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error("SIGNED_URL_FAILED");
    return jsonResponse(request, { contract_id: createdId, pdf_path: objectPath, signed_url: signed.data.signedUrl });
  } catch (error) {
    console.error("generate-client-contract failed", error instanceof Error ? error.message : "unknown");
    const admin = adminClient();
    if (objectPath) { try { await admin.storage.from("contracts").remove([objectPath]); } catch { /* best effort rollback */ } }
    if (createdId) { try { await admin.from("client_contracts").delete().eq("id", createdId); } catch { /* best effort rollback */ } }
    if (error instanceof Response) return adminErrorResponse(error, request, {});
    return jsonResponse(request, { code: "CONTRACT_GENERATION_FAILED", error: "Não foi possível gerar o contrato no servidor." }, 500);
  }
});
