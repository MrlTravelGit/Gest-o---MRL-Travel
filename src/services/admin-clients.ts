import { supabase } from "@/lib/supabase";
import type {
  AddExpirationLotInput,
  AdminClientPointsDetail,
  AdminClientsResult,
  RecordPointEntryInput,
  RecordPointEntryResult,
} from "@/types/admin-clients";

const SAFE_MESSAGES = [
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

function mutationError(error: unknown): Error {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
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

export async function archiveClient(clientId: string, confirmationName: string) {
  const { data, error } = await supabase.rpc("archive_client", { p_client_id: clientId, p_confirmation_name: confirmationName });
  if (error || !data) {
    const raw = error?.message ?? "";
    const safe = ["Somente gestores podem arquivar clientes.", "Digite o nome completo para confirmar.", "Cliente não encontrado."].find((message) => raw.includes(message));
    throw new Error(safe ?? "O cliente não foi arquivado.");
  }
  return data;
}

export async function getAdminClientPointsDetail(clientId: string): Promise<AdminClientPointsDetail> {
  const { data, error } = await supabase.rpc("get_admin_client_points_detail", { p_client_id: clientId });
  if (error || !data) throw new Error("Não foi possível carregar a gestão de pontos deste cliente.");
  return data as unknown as AdminClientPointsDetail;
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
