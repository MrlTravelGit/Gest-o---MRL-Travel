import { supabase } from "@/lib/supabase";
import type { TravelSalesResult } from "@/types/admin-modules";

export interface RecordTravelSaleInput {
  clientId: string; launchedOn: string; paymentMode: "cash" | "miles";
  travelType: "flight" | "hotel" | "other"; details: string;
  originalValue: number; paidValue: number; accountId?: string; pointsUsed?: number; operationId: string;
}

export async function getTravelSales(filters: { clientId?: string; startDate?: string; endDate?: string; limit?: number; offset?: number } = {}): Promise<TravelSalesResult> {
  const { data, error } = await supabase.rpc("get_travel_sales", { p_client_id: filters.clientId || null, p_start_date: filters.startDate || null, p_end_date: filters.endDate || null, p_limit: filters.limit ?? 20, p_offset: filters.offset ?? 0 });
  if (error || !data) throw new Error("Não foi possível carregar viagens e economia.");
  return data as unknown as TravelSalesResult;
}

export async function recordTravelSale(input: RecordTravelSaleInput) {
  const { data, error } = await supabase.rpc("record_travel_sale", { p_client_id: input.clientId, p_launched_on: input.launchedOn, p_payment_mode: input.paymentMode, p_travel_type: input.travelType, p_details: input.details, p_original_value: input.originalValue, p_paid_value: input.paidValue, p_account_id: input.accountId || null, p_points_used: input.pointsUsed ?? null, p_operation_id: input.operationId });
  if (error || !data) throw new Error(safeMutationMessage(error, "A viagem não foi registrada."));
  return data;
}

function safeMutationMessage(error: unknown, fallback: string) {
  const raw = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return ["Saldo insuficiente.", "A conta não pertence ao cliente.", "A data do lançamento não pode estar no futuro.", "Informe programa e pontos utilizados."].find((message) => raw.includes(message)) ?? fallback;
}
