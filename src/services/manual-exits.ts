import { supabase } from "@/lib/supabase";

export async function recordManualExit(input: { clientId: string; accountId: string; exitDate: string; points: number; notes: string; operationId: string }) {
  const { data, error } = await supabase.rpc("record_manual_exit", { p_client_id: input.clientId, p_account_id: input.accountId, p_exit_date: input.exitDate, p_points: input.points, p_notes: input.notes, p_operation_id: input.operationId });
  if (error || !data) {
    const raw = error?.message ?? "";
    const safe = ["Saldo insuficiente.", "A observação é obrigatória.", "A conta não pertence ao cliente."].find((message) => raw.includes(message));
    throw new Error(safe ?? "A saída não foi concluída. Nenhum saldo foi alterado.");
  }
  return data;
}
