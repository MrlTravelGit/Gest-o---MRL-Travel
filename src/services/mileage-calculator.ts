import { supabase } from "@/lib/supabase";
import { isOperationalClientName } from "@/lib/operational-client";
import type { MileageCalculatorAdminData, MileageSimulation, TransferProgram } from "@/types/admin-modules";

const fallbackProgramDefinitions = [
  ["livelo", "Livelo", true, true],
  ["esfera", "Esfera", true, true],
  ["atomos", "Átomos", true, false],
  ["coopera", "Coopera", true, false],
  ["coopera-pj", "COOPERA PJ", true, false],
  ["nubank", "Nubank", true, false],
  ["picpay", "PicPay", true, false],
  ["revolut", "Revolut", true, false],
  ["smiles", "Smiles", false, true],
  ["azul_fidelidade", "Azul Fidelidade", false, true],
  ["latam_pass", "LATAM Pass", false, true],
] as const;

export const mileageProgramFallback: TransferProgram[] = fallbackProgramDefinitions.map(([slug, name, isTransferSource, isTransferTarget]) => ({
  id: `fallback-${slug}`,
  slug,
  name,
  category: isTransferSource ? "bancos" : "programas_aereos",
  programType: isTransferSource ? "financial_points_program" : "loyalty_program",
  logoUrl: null,
  conversionLabel: null,
  supportsPointsLaunch: false,
  supportsBonusTransfer: true,
  isTransferSource,
  isTransferTarget,
  isActive: true,
}));

export interface MileageAuxiliaryData extends MileageCalculatorAdminData {
  storageAvailable: boolean;
  usingProgramFallback: boolean;
  warnings: Array<"programs" | "clients" | "simulations">;
}

async function getPrograms(): Promise<TransferProgram[]> {
  const { data, error } = await supabase.rpc("get_bonus_transfer_admin");
  if (error || !data) throw error ?? new Error("Resposta vazia ao carregar programas.");
  return (data as unknown as { programs?: TransferProgram[] }).programs ?? [];
}

async function getClients(): Promise<MileageCalculatorAdminData["clients"]> {
  const { data, error } = await supabase.rpc("get_admin_form_options");
  if (error || !data) throw error ?? new Error("Resposta vazia ao carregar clientes.");
  return ((data as unknown as { clients?: Array<{ clientId: string; fullName: string }> }).clients ?? [])
    .filter((client) => isOperationalClientName(client.fullName))
    .map(({ clientId, fullName }) => ({ clientId, fullName }));
}

async function getSimulationStorage(): Promise<{ canWrite: boolean; simulations: MileageSimulation[] }> {
  const { data, error } = await supabase.rpc("get_mileage_calculator_admin");
  if (error || !data) throw error ?? new Error("Resposta vazia ao carregar simulações.");
  const payload = data as unknown as { canWrite?: boolean; simulations?: MileageSimulation[] };
  return { canWrite: Boolean(payload.canWrite), simulations: payload.simulations ?? [] };
}

export async function loadMileageCalculatorAuxiliaryData(): Promise<MileageAuxiliaryData> {
  const [programsResult, clientsResult, simulationsResult] = await Promise.allSettled([
    getPrograms(),
    getClients(),
    getSimulationStorage(),
  ]);
  const warnings: MileageAuxiliaryData["warnings"] = [];

  if (programsResult.status === "rejected") {
    warnings.push("programs");
    console.error("[Calculadora de Milheiro] erro ao carregar", { source: "programas", error: programsResult.reason });
  }
  if (clientsResult.status === "rejected") {
    warnings.push("clients");
    console.error("[Calculadora de Milheiro] erro ao carregar", { source: "clientes", error: clientsResult.reason });
  }
  if (simulationsResult.status === "rejected") {
    warnings.push("simulations");
    console.error("[Calculadora de Milheiro] erro ao carregar", { source: "simulações", error: simulationsResult.reason });
  }

  return {
    programs: programsResult.status === "fulfilled" ? programsResult.value : mileageProgramFallback,
    clients: clientsResult.status === "fulfilled" ? clientsResult.value : [],
    simulations: simulationsResult.status === "fulfilled" ? simulationsResult.value.simulations : [],
    canWrite: simulationsResult.status === "fulfilled" && simulationsResult.value.canWrite,
    storageAvailable: simulationsResult.status === "fulfilled",
    usingProgramFallback: programsResult.status === "rejected",
    warnings,
  };
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
  if (error || !data) {
    console.error("[Calculadora de Milheiro] erro ao salvar simulação", error);
    throw new Error("A simulação não foi salva. Nenhum saldo foi alterado.");
  }
  return data as string;
}
