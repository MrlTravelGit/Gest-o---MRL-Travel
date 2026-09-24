import { supabase } from "@/lib/supabase";
import { validateContractDraft } from "@/lib/contracts/contractFormat";
import type { ClientContract, ContractDraft, ContractFilter, ContractSignatureRequest, ContractSignatureStatus, ContractSignerStatus } from "@/types/contracts";

type SignatureSignerRow = {
  id: string; provider_public_id: string | null; name: string; email: string | null; phone: string | null;
  action: string; delivery_method: string | null; signature_link: string | null; status: ContractSignerStatus;
  signed_at: string | null; viewed_at: string | null; rejected_at: string | null;
};

type SignatureRequestRow = {
  id: string; provider_document_id: string | null; provider_document_name: string | null;
  status: ContractSignatureStatus; sandbox: boolean; signed_pdf_url: string | null; pades_pdf_url: string | null;
  error_message: string | null; created_at: string; updated_at: string;
  contract_signature_signers?: SignatureSignerRow[];
};

type ContractRow = {
  id: string;
  client_id: string;
  contract_number: string | null;
  client_name: string;
  cpf: string | null;
  rg: string | null;
  email: string | null;
  marital_status: string | null;
  profession: string | null;
  full_address: string | null;
  contract_value: number | string;
  installments: number;
  installment_value: number | string;
  signature_city: string;
  contract_date: string;
  include_cashback: boolean;
  cashback_percent: number | string;
  include_roi_guarantee: boolean;
  include_courtesy_ticket: boolean;
  status: "generated" | "archived";
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  contract_signature_requests?: SignatureRequestRow[];
};

function mapSignatureRequest(row: SignatureRequestRow): ContractSignatureRequest {
  return {
    id: row.id,
    providerDocumentId: row.provider_document_id,
    providerDocumentName: row.provider_document_name,
    status: row.status,
    sandbox: row.sandbox,
    signedPdfUrl: row.signed_pdf_url,
    padesPdfUrl: row.pades_pdf_url,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    signers: (row.contract_signature_signers ?? []).map((signer) => ({
      id: signer.id,
      providerPublicId: signer.provider_public_id,
      name: signer.name,
      email: signer.email,
      phone: signer.phone,
      action: signer.action,
      deliveryMethod: signer.delivery_method,
      signatureLink: signer.signature_link,
      status: signer.status,
      signedAt: signer.signed_at,
      viewedAt: signer.viewed_at,
      rejectedAt: signer.rejected_at,
    })),
  };
}

function mapContract(row: ContractRow): ClientContract {
  const latestSignature = [...(row.contract_signature_requests ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return {
    id: row.id,
    clientId: row.client_id,
    contractNumber: row.contract_number,
    clientName: row.client_name,
    cpf: row.cpf ?? "",
    rg: row.rg ?? "",
    email: row.email ?? "",
    maritalStatus: row.marital_status ?? "",
    profession: row.profession ?? "",
    fullAddress: row.full_address ?? "",
    contractValue: Number(row.contract_value),
    installments: row.installments,
    installmentValue: Number(row.installment_value),
    signatureCity: row.signature_city,
    contractDate: row.contract_date,
    includeCashback: row.include_cashback,
    cashbackPercent: Number(row.cashback_percent),
    includeRoiGuarantee: row.include_roi_guarantee,
    includeCourtesyTicket: row.include_courtesy_ticket ?? false,
    status: row.status,
    pdfPath: row.pdf_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    signatureRequest: latestSignature ? mapSignatureRequest(latestSignature) : null,
  };
}

export async function listClientContracts(input: { clientId?: string; filter?: ContractFilter } = {}): Promise<ClientContract[]> {
  let query = supabase.from("client_contracts").select("*,contract_signature_requests(id,provider_document_id,provider_document_name,status,sandbox,signed_pdf_url,pades_pdf_url,error_message,created_at,updated_at,contract_signature_signers(id,provider_public_id,name,email,phone,action,delivery_method,signature_link,status,signed_at,viewed_at,rejected_at))").order("created_at", { ascending: false });
  if (input.clientId) query = query.eq("client_id", input.clientId);
  if (input.filter === "active" || !input.filter) query = query.is("archived_at", null).neq("status", "archived");
  if (input.filter === "archived") query = query.or("archived_at.not.is.null,status.eq.archived");
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar o histórico de contratos.");
  return ((data ?? []) as ContractRow[]).map(mapContract);
}

async function functionError(error: unknown, fallback: string): Promise<Error> {
  const context = error && typeof error === "object" ? (error as { context?: Response }).context : undefined;
  if (context) {
    try {
      const payload = await context.clone().json() as { error?: string };
      if (payload.error) return new Error(payload.error);
    } catch { /* response without JSON */ }
  }
  return new Error(fallback);
}

export async function sendContractToAutentique(input: {
  contract: ClientContract;
  documentName: string;
  sandbox: boolean;
  signers: Array<{ name: string; email?: string; phone?: string; cpf?: string; action?: string; deliveryMethod: "link" | "email" | "whatsapp" | "sms" }>;
}): Promise<ContractSignatureRequest> {
  if (!input.contract.pdfPath) throw new Error("Gere o PDF do contrato antes de enviar para assinatura.");
  if (!input.signers.length) throw new Error("Adicione pelo menos um signatário para enviar o contrato.");
  const { data, error } = await supabase.functions.invoke<{ request: SignatureRequestRow }>("send-contract-to-autentique", {
    body: {
      contractId: input.contract.id,
      clientId: input.contract.clientId,
      pdfPath: input.contract.pdfPath,
      documentName: input.documentName,
      sandbox: input.sandbox,
      signers: input.signers.map((signer) => ({ ...signer, action: signer.action ?? "SIGN" })),
    },
  });
  if (error || !data?.request) throw await functionError(error, "Não foi possível enviar o contrato para assinatura. Tente novamente.");
  return mapSignatureRequest(data.request);
}

export async function syncAutentiqueDocument(signatureRequestId: string): Promise<ContractSignatureRequest> {
  const { data, error } = await supabase.functions.invoke<{ request: SignatureRequestRow }>("sync-autentique-document", {
    body: { signatureRequestId },
  });
  if (error || !data?.request) throw await functionError(error, "Não foi possível atualizar o status na Autentique.");
  return mapSignatureRequest(data.request);
}

export async function createClientContract(draft: ContractDraft): Promise<{ contractId: string; pdfPath: string; signedUrl: string }> {
  const validation = validateContractDraft(draft);
  if (validation) throw new Error(validation);
  const { data, error } = await supabase.functions.invoke<{ contract_id: string; pdf_path: string; signed_url: string }>("generate-client-contract", {
    body: {
      client_id: draft.clientId,
      contract_data: {
        nome: draft.clientName.trim(), cpf: draft.cpf.trim(), rg: draft.rg.trim(), email: draft.email.trim(),
        estado_civil: draft.maritalStatus.trim(), profissao: draft.profession.trim(), endereco: draft.fullAddress.trim(),
        valor_total: draft.contractValue, num_parcelas: draft.installments, valor_parcela: draft.installmentValue,
        data: draft.contractDate, cidade: draft.signatureCity.trim() || "POMPÉU", incluir_cashback: draft.includeCashback,
        pct_cashback: draft.cashbackPercent, incluir_reembolso: draft.includeRoiGuarantee, include_courtesy_ticket: draft.includeCourtesyTicket,
      },
    },
  });
  if (error || !data?.signed_url) {
    console.error("[Contratos] geração no servidor falhou", error);
    throw new Error("Não foi possível gerar o contrato no servidor.");
  }
  return { contractId: data.contract_id, pdfPath: data.pdf_path, signedUrl: data.signed_url };
}

export async function archiveClientContract(contractId: string): Promise<void> {
  const { error } = await supabase.from("client_contracts").update({
    status: "archived",
    archived_at: new Date().toISOString(),
  }).eq("id", contractId);
  if (error) throw new Error("Não foi possível arquivar o contrato.");
}

export async function downloadStoredContract(contract: ClientContract): Promise<string> {
  if (!contract.pdfPath) throw new Error("Este contrato não possui PDF salvo.");
  const signed = await supabase.storage.from("contracts").createSignedUrl(contract.pdfPath, 120, { download: (contract.contractNumber ?? "contrato-mrl") + ".pdf" });
  if (signed.error || !signed.data?.signedUrl) throw new Error("Não foi possível autorizar o download do PDF.");
  return signed.data.signedUrl;
}
