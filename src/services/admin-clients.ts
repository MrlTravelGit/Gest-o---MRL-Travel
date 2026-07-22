import { supabase } from "@/lib/supabase";
import type {
  ActivateOnboardingLeadInput,
  ActivateOnboardingLeadResult,
  AddExpirationLotInput,
  AdminClientPointsDetail,
  AdminClientsResult,
  AdminClientManagement,
  BulkReactivationResult,
  ClientNameCleanupSuggestion,
  ClientReactivationPreview,
  OnboardingLeadReview,
  RecordPointEntryInput,
  RecordPointEntryResult,
  UpdateClientContractInput,
  UpdateClientProfileInput,
} from "@/types/admin-clients";

const SAFE_MESSAGES = [
  "Ative o cliente antes de realizar esta operação.",
  "Cadastre uma vigência ativa antes de continuar.",
  "Selecione um programa.",
  "Informe uma quantidade maior que zero.",
  "A data da entrada não pode estar no futuro.",
  "A validade não pode ser anterior à entrada.",
  "Já existe um saldo inicial para este programa.",
  "A quantidade com vencimento ultrapassa o saldo disponível.",
  "Você não possui permissão para alterar este cliente.",
  "Informe a observação para o tipo Outros.",
  "A data de vencimento não pode estar no passado.",
  "O programa ainda não possui saldo para classificar.",
];

const DOMAIN_ERRORS: Record<string, string> = {
  CLIENT_NOT_ACTIVE: "Ative o cliente antes de realizar esta operação.",
  ACTIVE_CONTRACT_REQUIRED: "Cadastre uma vigência ativa antes de continuar.",
  CLIENT_NOT_FOUND: "Cliente não encontrado.",
  CLIENT_NOT_LEAD: "Este cadastro não está aguardando ativação.",
  DUPLICATE_REVIEW_REQUIRED: "Resolva a possível duplicidade antes de ativar.",
  ONBOARDING_SUBMISSION_REQUIRED: "Não encontramos a submissão de onboarding vinculada.",
  INVALID_CONTRACT_DATES: "A vigência do contrato está inválida.",
  PLAN_REQUIRED: "Informe o plano contratado.",
  ACTIVE_CONTRACT_OVERLAP: "Já existe contrato ativo no período informado.",
  FORBIDDEN: "Seu usuário não possui permissão para esta ação.",
  CONCURRENT_EDIT: "O cadastro mudou em outra tela. Recarregue antes de salvar.",
  CLIENT_NOT_ARCHIVED: "Somente clientes arquivados podem ser reativados.",
  CHANGE_REASON_REQUIRED: "Informe o motivo da alteração da vigência.",
  CONTRACT_START_REQUIRED: "Informe a data inicial do contrato.",
};

function mutationError(error: unknown): Error {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  const domain = Object.entries(DOMAIN_ERRORS).find(([code]) => raw.includes(code));
  if (domain) return new Error(domain[1]);
  const safe = SAFE_MESSAGES.find((message) => raw.includes(message));
  return new Error(safe ?? "O lançamento não foi concluído. Nenhum dado foi alterado.");
}

export async function getAdminClients(search = "", status = "", limit = 20, offset = 0): Promise<AdminClientsResult> {
  const { data, error } = await supabase.rpc("get_admin_clients", {
    p_limit: limit,
    p_offset: offset,
    p_search: search,
    p_status: status || "all",
  });
  if (error || !data) throw new Error("Não foi possível carregar os clientes.");
  return data as unknown as AdminClientsResult;
}

export async function archiveClient(clientId: string, confirmationName: string, reason?: string) {
  const { data, error } = await supabase.rpc("archive_client", { p_client_id: clientId, p_confirmation_name: confirmationName, p_reason: reason || null });
  if (error || !data) {
    const raw = error?.message ?? "";
    const safe = ["Somente gestores podem arquivar clientes.", "Digite o nome completo para confirmar.", "Cliente não encontrado."].find((message) => raw.includes(message));
    throw new Error(safe ?? "O cliente não foi arquivado.");
  }
  return data;
}

export async function getClientReactivationPreview(clientIds: string[] | null, search = ""): Promise<ClientReactivationPreview> {
  const { data, error } = await supabase.rpc("get_client_reactivation_preview", { p_client_ids: clientIds, p_search: search });
  if (error || !data) throw mutationError(error);
  return data as unknown as ClientReactivationPreview;
}

export async function reactivateClient(clientId: string, note?: string, expectedVersion?: number) {
  const { data, error } = await supabase.rpc("reactivate_client_admin", { p_client_id: clientId, p_note: note || null, p_expected_version: expectedVersion ?? null });
  if (error || !data) throw mutationError(error);
  return data;
}

export async function bulkReactivateClients(clientIds: string[], note?: string): Promise<BulkReactivationResult> {
  const { data, error } = await supabase.rpc("bulk_reactivate_clients_admin", { p_client_ids: clientIds, p_note: note || null });
  if (error || !data) throw mutationError(error);
  return data as unknown as BulkReactivationResult;
}

export async function previewClientNameCleanup(): Promise<ClientNameCleanupSuggestion[]> {
  const { data, error } = await supabase.rpc("preview_client_name_cleanup_admin");
  if (error || !data) throw mutationError(error);
  return (data as unknown as { items: ClientNameCleanupSuggestion[] }).items;
}

export async function applyClientNameCleanup(clientId: string, newName: string, expectedVersion: number, reason?: string) {
  const { data, error } = await supabase.rpc("apply_client_name_cleanup_admin", { p_client_id: clientId, p_new_name: newName, p_reason: reason || null, p_expected_version: expectedVersion });
  if (error || !data) throw mutationError(error);
  return data as unknown as { actionId?: string; rowVersion: number; fullName: string; status: string };
}

export async function revertClientNameCleanup(actionId: string, expectedVersion: number, reason?: string) {
  const { data, error } = await supabase.rpc("revert_client_name_cleanup_admin", { p_action_id: actionId, p_reason: reason || null, p_expected_version: expectedVersion });
  if (error || !data) throw mutationError(error);
  return data;
}

export async function getAdminClientManagement(clientId: string): Promise<AdminClientManagement> {
  const { data, error } = await supabase.rpc("get_admin_client_management", { p_client_id: clientId });
  if (error || !data) throw mutationError(error);
  return data as unknown as AdminClientManagement;
}

export async function updateClientProfile(input: UpdateClientProfileInput): Promise<{ clientId: string; rowVersion: number; changedFields: string[] }> {
  const { data, error } = await supabase.functions.invoke("admin-client-management", { body: { action: "update_profile", ...input } });
  if (error || !data) {
    if (error && typeof error === "object" && "context" in error) {
      const response = (error as { context?: unknown }).context;
      if (response instanceof Response) {
        const payload = await response.clone().json().catch(() => null) as { error?: unknown } | null;
        if (typeof payload?.error === "string" && payload.error.trim()) throw new Error(payload.error);
      }
    }
    throw mutationError(error);
  }
  return data as { clientId: string; rowVersion: number; changedFields: string[] };
}

export async function updateClientContract(input: UpdateClientContractInput) {
  const { data, error } = await supabase.rpc("update_client_contract_admin", {
    p_client_id: input.clientId, p_contract_id: input.contractId, p_starts_on: input.startsOn, p_ends_on: input.endsOn,
    p_plan_name: input.planName, p_contract_value: input.contractValue, p_status: input.status, p_auto_renew: input.autoRenew,
    p_notes: input.notes, p_reason: input.reason, p_expected_client_version: input.expectedClientVersion,
    p_expected_contract_updated_at: input.expectedContractUpdatedAt,
  });
  if (error || !data) throw mutationError(error);
  return data;
}

export async function getAdminClientPointsDetail(clientId: string): Promise<AdminClientPointsDetail> {
  const { data, error } = await supabase.rpc("get_admin_client_points_detail", { p_client_id: clientId });
  if (error || !data) throw new Error("Não foi possível carregar a gestão de pontos deste cliente.");
  return data as unknown as AdminClientPointsDetail;
}

export async function getOnboardingLeadReview(clientId: string): Promise<OnboardingLeadReview> {
  const { data: submission, error: submissionError } = await supabase
    .from("client_onboarding_submissions")
    .select("id,status,duplicate_reason,duplicate_candidate_client_id,full_name,email,whatsapp_e164,cpf_last4,submitted_at,lead_created_at,best_bank,pf_monthly_spend,service_expectations")
    .eq("client_id", clientId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (submissionError) throw new Error("Não foi possível carregar o onboarding vinculado.");
  if (!submission) return { submission: null, cards: [], loyaltyAccounts: [], plannedTrips: [] };

  const [cards, loyaltyAccounts, plannedTrips] = await Promise.all([
    supabase.from("client_onboarding_cards").select("card_kind,bank_name,card_brand,product_name,pays_annual_fee,annual_fee_monthly").eq("submission_id", submission.id),
    supabase.from("client_onboarding_loyalty_accounts").select("program_name,has_account,declared_points,notes").eq("submission_id", submission.id),
    supabase.from("client_onboarding_planned_trips").select("destination,approximate_date,notes").eq("submission_id", submission.id),
  ]);
  if (cards.error || loyaltyAccounts.error || plannedTrips.error) throw new Error("Não foi possível carregar as respostas do onboarding.");
  return {
    submission,
    cards: cards.data ?? [],
    loyaltyAccounts: loyaltyAccounts.data ?? [],
    plannedTrips: plannedTrips.data ?? [],
  } as OnboardingLeadReview;
}

export async function activateOnboardingLead(input: ActivateOnboardingLeadInput): Promise<ActivateOnboardingLeadResult> {
  const { data, error } = await supabase.rpc("activate_onboarding_lead", {
    p_client_id: input.clientId,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_plan_name: input.planName,
    p_notes: input.notes || null,
  });
  if (error || !data) throw mutationError(error);
  return data as unknown as ActivateOnboardingLeadResult;
}

export async function recordPointEntry(input: RecordPointEntryInput): Promise<RecordPointEntryResult> {
  const { data, error } = await supabase.rpc("record_point_entry", {
    p_client_id: input.clientId,
    p_program_id: input.programId,
    p_entry_category: input.entryCategory,
    p_entry_date: input.entryDate,
    p_points_amount: input.pointsAmount,
    p_valuation_mode: input.valuationMode,
    p_entered_value: input.enteredValue,
    p_expires_on: input.expiresOn || null,
    p_notes: input.notes || null,
    p_operation_id: input.operationId,
  });
  if (error || !data) throw mutationError(error);
  return data as unknown as RecordPointEntryResult;
}

export async function setProgramClubStatus(clientId: string, programId: string, clubActive: boolean) {
  const { data, error } = await supabase.rpc("set_program_club_status", {
    p_client_id: clientId,
    p_program_id: programId,
    p_club_active: clubActive,
  });
  if (error || !data) throw mutationError(error);
  return data;
}

export async function addExpirationLot(input: AddExpirationLotInput) {
  const { data, error } = await supabase.rpc("add_expiration_lot", {
    p_client_id: input.clientId,
    p_program_id: input.programId,
    p_points_amount: input.pointsAmount,
    p_expires_on: input.expiresOn,
    p_notes: input.notes || null,
  });
  if (error || !data) throw mutationError(error);
  return data;
}
