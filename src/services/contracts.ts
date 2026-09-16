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
  include_courtesy_ticket: boolean;
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
    includeCourtesyTicket: row.include_courtesy_ticket ?? false,
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
