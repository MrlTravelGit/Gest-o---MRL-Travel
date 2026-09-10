import { supabase } from "@/lib/supabase";
import type { BonusTransferAdminData } from "@/types/admin-modules";

export async function confirmTransfer(input: { clientId: string; transferredOn: string; sourceAccountId: string; destinationAccountId: string; sourcePoints: number; parity: number; receivedOn: string; expiresOn?: string; bonusPercentage: number; bonusReceivedOn?: string; notes?: string; operationId: string }) {
  const { data, error } = await supabase.rpc("confirm_transfer", { p_client_id: input.clientId, p_transferred_on: input.transferredOn, p_source_account_id: input.sourceAccountId, p_destination_account_id: input.destinationAccountId, p_source_points: input.sourcePoints, p_parity: input.parity, p_received_on: input.receivedOn, p_destination_expires_on: input.expiresOn || null, p_bonus_percentage: input.bonusPercentage, p_bonus_received_on: input.bonusReceivedOn || null, p_notes: input.notes || null, p_operation_id: input.operationId });
  if (error || !data) throw new Error(message(error));
  return data;
}

export async function getBonusTransferAdmin(): Promise<BonusTransferAdminData> {
  const { data, error } = await supabase.rpc("get_bonus_transfer_admin");
  if (error || !data) throw new Error("Não foi possível carregar campanhas e programas.");
  return data as unknown as BonusTransferAdminData;
}

export async function saveBonusTransferCampaign(input: {
  campaignId?: string;
  sourceProgramId: string;
  targetProgramId: string;
  bonusPercentage: number;
  startsAt: string;
  endsAt: string;
  minimumPoints?: number;
  maximumPoints?: number;
  rulesSummary: string;
  officialUrl?: string;
  isActive: boolean;
}) {
  const { data, error } = await supabase.rpc("upsert_bonus_transfer_campaign", {
    p_campaign_id: input.campaignId ?? null,
    p_source_program_id: input.sourceProgramId,
    p_target_program_id: input.targetProgramId,
    p_bonus_percentage: input.bonusPercentage,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_minimum_points: input.minimumPoints ?? null,
    p_maximum_points: input.maximumPoints ?? null,
    p_rules_summary: input.rulesSummary,
    p_official_url: input.officialUrl ?? null,
    p_is_active: input.isActive,
  });
  if (error || !data) throw new Error("A campanha não foi salva. Revise os programas, datas e limites.");
  return data as string;
}

export async function updateFinancialProgramConversion(programId: string, conversionLabel: string) {
  const { error } = await supabase.rpc("update_financial_program_conversion", {
    p_program_id: programId,
    p_conversion_label: conversionLabel,
  });
  if (error) throw new Error("A regra de conversão não foi atualizada.");
}

function message(error: unknown) {
  const raw = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  return ["Saldo insuficiente.", "Origem e destino devem ser diferentes.", "As contas devem pertencer ao cliente.", "A validade não pode ser anterior ao recebimento."].find((item) => raw.includes(item)) ?? "A transferência não foi concluída. Nenhum saldo foi alterado.";
}
