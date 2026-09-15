import { supabase } from "@/lib/supabase";
import type { MileageCalculatorAdminData } from "@/types/admin-modules";

export async function getMileageCalculatorAdmin(): Promise<MileageCalculatorAdminData> {
  const { data, error } = await supabase.rpc("get_mileage_calculator_admin");
  if (error || !data) throw new Error("Não foi possível carregar a calculadora de milheiro.");
  return data as unknown as MileageCalculatorAdminData;
}

export async function saveMileageSimulation(input: {
  clientId?: string;
  sourceProgramId: string;
  targetProgramId: string;
  totalPoints: number;
  pointsUsed: number;
  cashAmount: number;
  bonusPercent: number;
  pixDiscountPercent?: number;
  clubActive: boolean;
  notes?: string;
}) {
  const { data, error } = await supabase.rpc("save_mileage_cost_simulation", {
    p_client_id: input.clientId || null,
    p_source_program_id: input.sourceProgramId,
    p_target_program_id: input.targetProgramId,
    p_total_points: input.totalPoints,
    p_points_used: input.pointsUsed,
    p_cash_amount: input.cashAmount,
    p_bonus_percent: input.bonusPercent,
    p_pix_discount_percent: input.pixDiscountPercent ?? null,
    p_club_active: input.clubActive,
    p_notes: input.notes || null,
  });
  if (error || !data) throw new Error("A simulação não foi salva. Nenhum saldo foi alterado.");
  return data as string;
}
