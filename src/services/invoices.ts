import { supabase } from "@/lib/supabase";
import type { CardStatementOptions, CardStatementsResult } from "@/types/admin-modules";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCardStatementOptions(data: unknown): CardStatementOptions {
  const source = isRecord(data) ? data : {};
  return {
    clients: Array.isArray(source.clients) ? source.clients as CardStatementOptions["clients"] : [],
    institutions: Array.isArray(source.institutions) ? source.institutions as CardStatementOptions["institutions"] : [],
    cards: Array.isArray(source.cards) ? source.cards as CardStatementOptions["cards"] : [],
  };
}

export function normalizeCardStatements(data: unknown): CardStatementsResult {
  const source = isRecord(data) ? data : {};
  const items = Array.isArray(source.items) ? source.items : [];

  return {
    items: items as CardStatementsResult["items"],
    total: typeof source.total === "number" ? source.total : items.length,
    limit: typeof source.limit === "number" ? source.limit : 50,
    offset: typeof source.offset === "number" ? source.offset : 0,
  };
}

export async function getCardStatementOptions(clientId?: string): Promise<CardStatementOptions> {
  const { data, error } = await supabase.rpc("get_card_statement_options_v3", { p_client_id: clientId || null });
  if (error || !data) throw new Error(`get_card_statement_options: ${error?.message ?? "Não foi possível carregar cartões e clientes."}`);
  return normalizeCardStatementOptions(data);
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

export async function recordCatalogCardStatement(input: {
  cardId: string;
  statementMonth: string;
  totalSpend: number;
  receivedPoints: number;
  fxRate?: number | null;
  fxRateDate?: string;
  fxSource?: string;
  notes?: string;
  operationId: string;
  spendSegments: Array<{
    amountBrl: number;
    spendLocation: "domestic" | "international";
    merchantScope: "any" | "airline" | "program_partner" | "streaming" | "custom";
    merchantName?: string;
  }>;
}) {
  const { data, error } = await supabase.rpc("record_catalog_card_statement", {
    p_card_id: input.cardId,
    p_statement_month: `${input.statementMonth}-01`,
    p_spend_segments: input.spendSegments,
    p_total_spend: input.totalSpend,
    p_received_points: input.receivedPoints,
    p_fx_rate: input.fxRate ?? null,
    p_fx_rate_date: input.fxRateDate || null,
    p_fx_source: input.fxSource || null,
    p_notes: input.notes || null,
    p_operation_id: input.operationId,
  });
  if (error || !data) throw new Error(error?.message ?? "A fatura não foi calculada.");
  return data;
}

export async function getCardStatements(filters: { clientId?: string; cardId?: string; status?: string; offset?: number }): Promise<CardStatementsResult> {
  const { data, error } = await supabase.rpc("get_card_statements_v3", {
    p_client_id: filters.clientId || null,
    p_financial_institution_id: null,
    p_account_person_type: null,
    p_card_id: filters.cardId || null,
    p_prediction_status: filters.status || "all",
    p_start_month: null,
    p_end_month: null,
    p_limit: 50,
    p_offset: filters.offset ?? 0,
  });
  if (error || !data) throw new Error(`get_card_statements: ${error?.message ?? "Não foi possível carregar faturas."}`);
  return normalizeCardStatements(data);
}

export interface SaveCardStatementInput {
  statementId?: string | null;
  clientId: string;
  financialInstitutionId: string;
  accountPersonType: "PF" | "PJ";
  cardId?: string | null;
  statementMonth: string;
  totalAmount: number;
  domesticAmount?: number | null;
  internationalAmount?: number | null;
  partnerAmount?: number | null;
  partnerScope?: "program_partner" | "airline" | "streaming" | "custom";
  partnerName?: string;
  pointsReceived?: number | null;
  fxRate?: number | null;
  fxRateDate?: string;
  fxSource?: string;
  notes?: string;
  operationId: string;
}

export async function saveCardStatement(input: SaveCardStatementInput) {
  const { data, error } = await supabase.rpc("save_card_statement_v3", {
    p_statement_id: input.statementId || null,
    p_client_id: input.clientId,
    p_financial_institution_id: input.financialInstitutionId,
    p_account_person_type: input.accountPersonType,
    p_card_id: input.cardId || null,
    p_statement_month: `${input.statementMonth}-01`,
    p_total_amount: input.totalAmount,
    p_domestic_amount: input.domesticAmount ?? null,
    p_international_amount: input.internationalAmount ?? null,
    p_partner_amount: input.partnerAmount ?? null,
    p_partner_scope: input.partnerScope || "program_partner",
    p_partner_name: input.partnerName || null,
    p_points_received: input.pointsReceived ?? null,
    p_fx_rate: input.fxRate ?? null,
    p_fx_rate_date: input.fxRateDate || null,
    p_fx_source: input.fxSource || null,
    p_notes: input.notes || null,
    p_operation_id: input.operationId,
  });
  if (error || !data) throw new Error(error?.message ?? "A fatura não foi salva.");
  return data as { statementId: string; predictionStatus: string; predictedPoints: number | null; warning?: string | null };
}

export async function recalculateCardStatement(statementId: string) {
  const { data, error } = await supabase.rpc("recalculate_card_statement_v3", { p_statement_id: statementId });
  if (error || !data) throw new Error(error?.message ?? "A previsão não foi recalculada.");
  return data;
}
