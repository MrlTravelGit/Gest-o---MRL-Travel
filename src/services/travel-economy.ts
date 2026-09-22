import { supabase } from "@/lib/supabase";
import { getFriendlyErrorMessage } from "@/lib/friendly-errors";
import { buildSavingsMatchKey } from "@/lib/savings-match-key";
import type { CashbackFormulaReconciliationPreview, CashbackFormulaReconciliationResult, ClientCashbackState, IddasSavingsImportState, TravelSalesResult } from "@/types/admin-modules";

export interface RecordTravelSaleInput {
  clientId: string; launchedOn: string; paymentMode: "cash" | "miles";
  travelType: "flight" | "hotel" | "other"; details: string;
  originalValue: string; paidValue: string; accountId?: string; pointsUsed?: number; operationId: string;
  cashbackPercentage?: string | null;
  programName?: string | null; availablePoints?: number | null; clientName?: string | null;
}

export async function getTravelSales(filters: { clientId?: string; startDate?: string; endDate?: string; travelType?: "flight" | "hotel" | "other"; hasCashback?: boolean; status?: "active" | "voided" | "all"; limit?: number; offset?: number } = {}): Promise<TravelSalesResult> {
  const { data, error } = await supabase.rpc("get_travel_sales_v2", { p_client_id: filters.clientId || null, p_start_date: filters.startDate || null, p_end_date: filters.endDate || null, p_limit: filters.limit ?? 20, p_offset: filters.offset ?? 0, p_travel_type: filters.travelType || null, p_has_cashback: filters.hasCashback ?? null, p_status: filters.status ?? "active" });
  if (error || !data) throw new Error("Não foi possível carregar viagens e economia.");
  return excludeDeletedTravelSales(data as unknown as TravelSalesResult);
}

export function excludeDeletedTravelSales(result: TravelSalesResult): TravelSalesResult {
  const hiddenKeys = new Set(result.hiddenKeys ?? []);
  const items = result.items.filter((item) => item.deletedAt == null
    && !["deleted", "removed", "archived"].includes(String(item.status).toLowerCase())
    && !hiddenKeys.has(buildSavingsMatchKey(item)));
  if (items.length === result.items.length) return result;
  const activeItems = items.filter((item) => item.status === "active");
  return {
    ...result,
    items,
    total: Math.max(0, result.total - (result.items.length - items.length)),
    totalSavings: activeItems.reduce((sum, item) => sum + Number(item.savingsAmount || 0), 0),
    totalCashback: activeItems.reduce((sum, item) => sum + Number(item.cashbackAmount || 0), 0),
  };
}

export function removeTravelSaleFromResult(result: TravelSalesResult, redemptionId: string): TravelSalesResult {
  const removed = result.items.find((item) => item.id === redemptionId);
  if (!removed) return result;
  return {
    ...result,
    items: result.items.filter((item) => item.id !== redemptionId),
    total: Math.max(0, result.total - 1),
    totalSavings: removed.status === "active" ? result.totalSavings - Number(removed.savingsAmount || 0) : result.totalSavings,
    totalCashback: removed.status === "active" ? result.totalCashback - Number(removed.cashbackAmount || 0) : result.totalCashback,
    ranking: result.ranking.map((entry) => entry.clientId === removed.clientId && removed.status === "active"
      ? { ...entry, totalSavings: entry.totalSavings - Number(removed.savingsAmount || 0), records: Math.max(0, entry.records - 1) }
      : entry).filter((entry) => entry.records > 0),
  };
}

export async function recordTravelSale(input: RecordTravelSaleInput) {
  const { data, error } = await supabase.rpc("record_travel_sale", { p_client_id: input.clientId, p_launched_on: input.launchedOn, p_payment_mode: input.paymentMode, p_travel_type: input.travelType, p_details: input.details, p_original_value: input.originalValue, p_paid_value: input.paidValue, p_account_id: input.accountId || null, p_points_used: input.pointsUsed ?? null, p_operation_id: input.operationId, p_cashback_percentage: input.cashbackPercentage ?? null });
  if (error || !data) {
    console.error("[economy] failed to register trip", error ?? new Error("Empty record_travel_sale response"));
    throw new Error(getFriendlyErrorMessage(error, {
      action: "registrar viagem",
      programName: input.programName,
      availablePoints: input.availablePoints,
      requestedPoints: input.pointsUsed,
      clientName: input.clientName,
    }));
  }
  return data;
}

export async function getIddasSavingsImport(): Promise<IddasSavingsImportState> {
  const { data, error } = await supabase.rpc("get_admin_iddas_savings_import");
  if (error || !data) throw new Error("Não foi possível carregar a conciliação das economias Iddas.");
  return data as unknown as IddasSavingsImportState;
}

export async function prepareIddasSavingsImport() {
  const { data, error } = await supabase.rpc("admin_prepare_iddas_savings_import");
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível preparar o lote de economias."));
  return data;
}

export async function resolveIddasSavingsRow(rowId: string, clientId: string, reason: string) {
  const { data, error } = await supabase.rpc("admin_resolve_iddas_savings_row", { p_row_id: rowId, p_client_id: clientId, p_reason: reason });
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível conciliar esta linha."));
  return data;
}

export async function commitIddasSavingsImport(batchId: string) {
  const { data, error } = await supabase.rpc("admin_commit_iddas_savings_import", { p_batch_id: batchId, p_confirmation: "iddas_economias_20260722_v1" });
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível aplicar as economias conciliadas."));
  return data as unknown as { batchId: string; applied: number; newRecords: number; alreadyExisting: number; pending: number; conflicts: number; totals: { originalValue: number; paidValue: number; savingsValue: number } };
}

export async function updateTravelSaving(input: { redemptionId: string; launchedOn: string; travelType: "flight" | "hotel" | "other"; details: string; originalValue: string; paidValue: string; cashbackPercentage?: string | null; reason: string; expectedUpdatedAt?: string | null }) {
  const { data, error } = await supabase.rpc("admin_update_travel_saving", { p_redemption_id: input.redemptionId, p_launched_on: input.launchedOn, p_travel_type: input.travelType, p_details: input.details, p_original_value: input.originalValue, p_paid_value: input.paidValue, p_cashback_percentage: input.cashbackPercentage ?? null, p_reason: input.reason, p_expected_updated_at: input.expectedUpdatedAt || null });
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível editar esta economia."));
  return data;
}

export async function getClientCashback(clientId: string): Promise<ClientCashbackState> {
  const { data, error } = await supabase.rpc("get_admin_client_cashback", { p_client_id: clientId });
  if (error || !data) throw new Error("Não foi possível carregar o cashback deste cliente.");
  return data as unknown as ClientCashbackState;
}

export async function previewCashbackPaidAmountReconciliation(): Promise<CashbackFormulaReconciliationPreview> {
  const { data, error } = await supabase.rpc("admin_preview_cashback_paid_amount_reconciliation");
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível preparar a prévia da reconciliação."));
  return data as unknown as CashbackFormulaReconciliationPreview;
}

export async function applyCashbackPaidAmountReconciliation(confirmationKey: string): Promise<CashbackFormulaReconciliationResult> {
  const { data, error } = await supabase.rpc("admin_apply_cashback_paid_amount_reconciliation", { p_confirmation: confirmationKey });
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível aplicar a reconciliação do cashback."));
  return data as unknown as CashbackFormulaReconciliationResult;
}

export async function updateClientCashbackConfig(input: { clientId: string; enabled: boolean; defaultPercentage: string | null; reason: string }) {
  const { data, error } = await supabase.rpc("update_client_cashback_config", { p_client_id: input.clientId, p_enabled: input.enabled, p_default_percentage: input.defaultPercentage, p_reason: input.reason });
  if (error || !data) throw new Error(safeMutationMessage(error, "A configuração de cashback não foi alterada."));
  return data;
}

export async function recordCashbackRedemption(input: { clientId: string; amount: string; description: string; operationId: string; mode: "usage" | "payment" }) {
  const { data, error } = await supabase.rpc("record_cashback_redemption_v2", { p_client_id: input.clientId, p_amount: input.amount, p_description: input.description, p_operation_id: input.operationId, p_mode: input.mode });
  if (error || !data) throw new Error(safeMutationMessage(error, "A utilização do cashback não foi registrada."));
  return data;
}

export const SAVINGS_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
const EVIDENCE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadSavingEvidence(redemptionId: string, file: File) {
  if (!EVIDENCE_MIMES.has(file.type)) throw new Error("Envie uma imagem PNG, JPEG ou WebP.");
  if (!file.size || file.size > SAVINGS_EVIDENCE_MAX_BYTES) throw new Error("O comprovante deve ter no máximo 10 MB.");
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const checksum = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  const created = await invokeEvidence<{ evidenceId: string; path: string; token: string }>({ action: "create_upload", redemptionId, filename: file.name, mimeType: file.type, size: file.size, sha256: checksum });
  const { error: uploadError } = await supabase.storage.from("savings-evidence").uploadToSignedUrl(created.path, created.token, file, { contentType: file.type });
  if (uploadError) throw new Error("Falha no upload. A economia permanece sem comprovante.");
  return invokeEvidence({ action: "confirm_upload", evidenceId: created.evidenceId });
}

export async function getAdminSavingEvidenceUrl(redemptionId: string) {
  return invokeEvidence<{ url: string; filename: string; mimeType: string }>({ action: "admin_view", redemptionId });
}

export async function getPublicSavingEvidenceUrl(redemptionId: string, token: string) {
  return invokeEvidence<{ url: string; filename: string; mimeType: string }>({ action: "public_view", redemptionId, token });
}

export async function removeSavingEvidence(redemptionId: string, reason: string) {
  return invokeEvidence({ action: "remove", redemptionId, reason });
}

async function invokeEvidence<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("savings-evidence", { body });
  if (error || !data) throw new Error("A operação do comprovante não foi concluída.");
  return data;
}

export async function cancelTravelSaving(redemptionId: string, reason: string, expectedUpdatedAt?: string | null) {
  const { data, error } = await supabase.rpc("admin_void_travel_saving", { p_redemption_id: redemptionId, p_reason: reason, p_expected_updated_at: expectedUpdatedAt || null });
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível anular esta economia."));
  return data;
}

export async function deleteTravelSaving(redemptionId: string, reason: string, expectedUpdatedAt?: string | null) {
  const { data, error } = await supabase.rpc("admin_delete_travel_saving", { p_redemption_id: redemptionId, p_reason: reason, p_expected_updated_at: expectedUpdatedAt || null });
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível excluir esta economia."));
  return data as unknown as { redemptionId: string; status: "deleted"; idempotentReplay: boolean; summary: import("@/types/admin-modules").CashbackSummary };
}

export async function hideTravelSaving(redemptionId: string, reason: string, expectedUpdatedAt?: string | null) {
  const { data, error } = await supabase.rpc("admin_hide_travel_saving", { p_redemption_id: redemptionId, p_reason: reason, p_expected_updated_at: expectedUpdatedAt || null });
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível ocultar esta economia migrada."));
  return data as unknown as { redemptionId: string; status: "hidden"; matchKey: string; idempotentReplay: boolean; summary: import("@/types/admin-modules").CashbackSummary };
}

export async function previewTravelSavingVoid(redemptionId: string) {
  const { data, error } = await supabase.rpc("admin_preview_travel_saving_void", { p_redemption_id: redemptionId });
  if (error || !data) throw new Error(safeMutationMessage(error, "Não foi possível calcular o impacto da anulação."));
  return data as unknown as { redemptionId: string; status: string; operationGroupId: string; generated: number; used: number; paid: number; allocated: number; available: number; blocked: boolean; requiresRegularization: boolean };
}

function safeMutationMessage(error: unknown, fallback: string) {
  const raw = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const domain: Record<string, string> = {
    FORBIDDEN: "Seu perfil não possui permissão para esta operação.",
    DECISION_REASON_REQUIRED: "Informe uma justificativa com pelo menos cinco caracteres.",
    CHANGE_REASON_REQUIRED: "Informe o motivo da alteração.",
    CANCEL_REASON_REQUIRED: "Informe o motivo da anulação.",
    VOID_REASON_REQUIRED: "Informe o motivo da anulação.",
    DELETE_REASON_REQUIRED: "Informe o motivo da exclusão.",
    HIDE_REASON_REQUIRED: "Informe o motivo da remoção.",
    CONCURRENT_EDIT: "O registro foi alterado por outra pessoa. Atualize a página e tente novamente.",
    CONFIRMATION_REQUIRED: "A confirmação do lote não confere.",
    ROW_NOT_PENDING: "Esta linha já foi conciliada ou está em conflito.",
    INVALID_CASHBACK_PERCENTAGE: "Informe um percentual maior que zero e de até 100%.",
    INSUFFICIENT_CASHBACK_BALANCE: "O valor supera o saldo disponível de cashback.",
    CASHBACK_ALREADY_USED: "Este cashback já foi utilizado. Faça uma correção por ajuste auditado.",
    CASHBACK_REGULARIZATION_REQUIRED: "Parte deste cashback já foi utilizada ou paga. Regularize o saldo antes de anular a economia.",
  };
  const code = Object.keys(domain).find((key) => raw.includes(key));
  return code ? domain[code] : ["Saldo insuficiente.", "A conta não pertence ao cliente.", "A data do lançamento não pode estar no futuro.", "Informe programa e pontos utilizados."].find((message) => raw.includes(message)) ?? fallback;
}
