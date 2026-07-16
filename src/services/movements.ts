import { supabase } from "@/lib/supabase";
import type { PointMovementsResult } from "@/types/admin-modules";

export async function getPointMovements(filters: {
  clientId?: string;
  programId?: string;
  source?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  offset?: number;
}): Promise<PointMovementsResult> {
  const { data, error } = await supabase.rpc("get_point_movements", {
    p_client_id: filters.clientId || null,
    p_program_id: filters.programId || null,
    p_source: filters.source || "all",
    p_status: filters.status || "all",
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null,
    p_limit: 50,
    p_offset: filters.offset ?? 0,
  });
  if (error || !data) throw new Error("Não foi possível carregar movimentações.");
  return data as unknown as PointMovementsResult;
}

export async function voidPointTransaction(transactionId: string, reason: string, operationId: string) {
  const { data, error } = await supabase.rpc("void_point_transaction", {
    p_transaction_id: transactionId,
    p_reason: reason,
    p_operation_id: operationId,
  });
  if (error || !data) throw new Error(error?.message ?? "Movimentação não foi estornada.");
  return data;
}
