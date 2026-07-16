import { supabase } from "@/lib/supabase";

export async function confirmTransfer(input: { clientId: string; transferredOn: string; sourceAccountId: string; destinationAccountId: string; sourcePoints: number; parity: number; receivedOn: string; expiresOn?: string; bonusPercentage: number; bonusReceivedOn?: string; notes?: string; operationId: string }) {
  const { data, error } = await supabase.rpc("confirm_transfer", { p_client_id: input.clientId, p_transferred_on: input.transferredOn, p_source_account_id: input.sourceAccountId, p_destination_account_id: input.destinationAccountId, p_source_points: input.sourcePoints, p_parity: input.parity, p_received_on: input.receivedOn, p_destination_expires_on: input.expiresOn || null, p_bonus_percentage: input.bonusPercentage, p_bonus_received_on: input.bonusReceivedOn || null, p_notes: input.notes || null, p_operation_id: input.operationId });
  if (error || !data) throw new Error(message(error));
  return data;
}

function message(error: unknown) {
  const raw = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return ["Saldo insuficiente.", "Origem e destino devem ser diferentes.", "As contas devem pertencer ao cliente.", "A validade não pode ser anterior ao recebimento."].find((item) => raw.includes(item)) ?? "A transferência não foi concluída. Nenhum saldo foi alterado.";
}
