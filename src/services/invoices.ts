import { supabase } from "@/lib/supabase";
import type { CardStatementOptions, CardStatementsResult } from "@/types/admin-modules";

export async function getCardStatementOptions(): Promise<CardStatementOptions> {
  const { data, error } = await supabase.rpc("get_card_statement_options");
  if (error || !data) throw new Error("Não foi possível carregar cartões e clientes.");
  return data as unknown as CardStatementOptions;
}

export async function upsertCreditCard(input: {
  clientId: string;
  issuer: string;
  productName: string;
  brand: string;
  lastFour: string;
  programId?: string;
  basis: "brl" | "usd";
  pointsPerUnit: number;
  ruleDescription?: string;
}) {
  const { data, error } = await supabase.rpc("upsert_credit_card", {
    p_card_id: null,
    p_client_id: input.clientId,
    p_issuer: input.issuer,
    p_product_name: input.productName,
    p_brand: input.brand || null,
    p_last_four: input.lastFour,
    p_program_id: input.programId || null,
    p_basis: input.basis,
    p_points_per_unit: input.pointsPerUnit,
    p_rule_description: input.ruleDescription || null,
  });
  if (error || !data) throw new Error(error?.message ?? "Cartão não foi salvo.");
  return data;
}

export async function recordCardStatement(input: {
  cardId: string;
  statementMonth: string;
  totalSpend: number;
  eligibleSpend: number;
  receivedPoints: number;
  fxRate?: number | null;
  fxRateDate?: string;
  fxSource?: string;
  closingOn?: string;
  dueOn?: string;
  notes?: string;
  operationId: string;
}) {
  const { data, error } = await supabase.rpc("record_card_statement", {
    p_card_id: input.cardId,
    p_statement_month: `${input.statementMonth}-01`,
    p_total_spend: input.totalSpend,
    p_eligible_spend: input.eligibleSpend,
    p_received_points: input.receivedPoints,
    p_fx_rate: input.fxRate ?? null,
    p_fx_rate_date: input.fxRateDate || null,
    p_fx_source: input.fxSource || null,
    p_closing_on: input.closingOn || null,
    p_due_on: input.dueOn || null,
    p_notes: input.notes || null,
    p_operation_id: input.operationId,
  });
  if (error || !data) throw new Error(error?.message ?? "Fatura não foi registrada.");
  return data;
}

export async function getCardStatements(filters: { clientId?: string; cardId?: string; status?: string; offset?: number }): Promise<CardStatementsResult> {
  const { data, error } = await supabase.rpc("get_card_statements", {
    p_client_id: filters.clientId || null,
    p_card_id: filters.cardId || null,
    p_status: filters.status || "all",
    p_start_month: null,
    p_end_month: null,
    p_limit: 50,
    p_offset: filters.offset ?? 0,
  });
  if (error || !data) throw new Error("Não foi possível carregar faturas.");
  return data as unknown as CardStatementsResult;
}
