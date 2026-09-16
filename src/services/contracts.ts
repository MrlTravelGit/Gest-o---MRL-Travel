import { supabase } from "@/lib/supabase";
import { validateContractDraft } from "@/lib/contracts/contractFormat";
import type { ClientContract, ContractDraft, ContractFilter } from "@/types/contracts";

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
  status: "generated" | "archived";
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

function mapContract(row: ContractRow): ClientContract {
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
    status: row.status,
    pdfPath: row.pdf_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export async function listClientContracts(input: { clientId?: string; filter?: ContractFilter } = {}): Promise<ClientContract[]> {
  let query = supabase.from("client_contracts").select("*").order("created_at", { ascending: false });
  if (input.clientId) query = query.eq("client_id", input.clientId);
  if (input.filter === "active" || !input.filter) query = query.is("archived_at", null).neq("status", "archived");
  if (input.filter === "archived") query = query.or("archived_at.not.is.null,status.eq.archived");
  const { data, error } = await query;
  if (error) throw new Error("Não foi possível carregar o histórico de contratos.");
  return ((data ?? []) as ContractRow[]).map(mapContract);
}

export async function createClientContract(draft: ContractDraft): Promise<{ contract: ClientContract; blob: Blob; warning: string | null }> {
  const validation = validateContractDraft(draft);
  if (validation) throw new Error(validation);
  const contractNumber = "MRL-" + draft.contractDate.replaceAll("-", "") + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
  const { data, error } = await supabase.from("client_contracts").insert({
    client_id: draft.clientId,
    contract_number: contractNumber,
    client_name: draft.clientName.trim(),
    cpf: draft.cpf.trim() || null,
    rg: draft.rg.trim() || null,
    email: draft.email.trim() || null,
    marital_status: draft.maritalStatus.trim() || null,
    profession: draft.profession.trim() || null,
    full_address: draft.fullAddress.trim() || null,
    contract_value: draft.contractValue,
    installments: draft.installments,
    installment_value: draft.installmentValue,
    signature_city: draft.signatureCity.trim() || "POMPÉU",
    contract_date: draft.contractDate,
    include_cashback: draft.includeCashback,
    cashback_percent: draft.cashbackPercent,
    include_roi_guarantee: draft.includeRoiGuarantee,
  }).select("*").single();
  if (error || !data) throw new Error("Não foi possível salvar o contrato antes de gerar o PDF.");

  const contract = mapContract(data as ContractRow);
  const { generateContractPdf } = await import("@/lib/contracts/generateContractPdf");
  const blob = await generateContractPdf(draft, contractNumber);
  const objectPath = draft.clientId + "/" + contract.id + ".pdf";
  const upload = await supabase.storage.from("contracts").upload(objectPath, blob, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upload.error) {
    console.error("[Contratos] PDF gerado, mas o upload falhou", upload.error);
    return { contract, blob, warning: "PDF gerado e baixado localmente, mas não foi salvo no armazenamento." };
  }

  const updated = await supabase.from("client_contracts").update({ pdf_path: objectPath }).eq("id", contract.id).select("*").single();
  if (updated.error || !updated.data) {
    console.error("[Contratos] upload concluído, mas o caminho não foi atualizado", updated.error);
    return { contract, blob, warning: "PDF salvo, mas o histórico ainda não recebeu o vínculo de download." };
  }
  return { contract: mapContract(updated.data as ContractRow), blob, warning: null };
}

export async function archiveClientContract(contractId: string): Promise<void> {
  const { error } = await supabase.from("client_contracts").update({
    status: "archived",
    archived_at: new Date().toISOString(),
  }).eq("id", contractId);
  if (error) throw new Error("Não foi possível arquivar o contrato.");
}

export async function downloadStoredContract(contract: ClientContract): Promise<Blob> {
  if (!contract.pdfPath) throw new Error("Este contrato não possui PDF salvo.");
  const signed = await supabase.storage.from("contracts").createSignedUrl(contract.pdfPath, 120);
  if (signed.error || !signed.data?.signedUrl) throw new Error("Não foi possível autorizar o download do PDF.");
  const response = await fetch(signed.data.signedUrl);
  if (!response.ok) throw new Error("Não foi possível baixar o PDF salvo.");
  return response.blob();
}
