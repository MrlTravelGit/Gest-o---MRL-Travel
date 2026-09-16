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
    programs: Array.isArray(source.programs) ? source.programs as CardStatementOptions["programs"] : [],
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
  const { data, error } = await supabase.rpc("get_card_statement_options_v4", { p_client_id: clientId || null });
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
  const { data, error } = await supabase.rpc("get_card_statements_v4", {
    p_client_id: filters.clientId || null,
    p_card_id: filters.cardId || null,
    p_prediction_status: filters.status || "all",
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
  loyaltyProgramId?: string | null;
  pointsReceived?: number | null;
  fxRate?: number | null;
  fxRateDate?: string;
  fxSource?: string;
  notes?: string;
  importAttemptId?: string | null;
  operationId: string;
}

export async function saveCardStatement(input: SaveCardStatementInput) {
  const { data, error } = await supabase.rpc("save_card_statement_v4", {
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
    p_partner_scope: input.partnerScope || null,
    p_partner_name: input.partnerName || null,
    p_loyalty_program_id: input.loyaltyProgramId || null,
    p_points_received: input.pointsReceived ?? null,
    p_fx_rate: input.fxRate ?? null,
    p_fx_rate_date: input.fxRateDate || null,
    p_fx_source: input.fxSource || null,
    p_notes: input.notes || null,
    p_operation_id: input.operationId,
  });
  if (error || !data) throw new Error(error?.message ?? "A fatura não foi salva.");
  const saved = data as { statementId: string; predictionStatus: string; predictedPoints: number | null; estimatedPointsValue: number | null; pointsDifference: number | null; warning?: string | null };
  if (input.importAttemptId) {
    const confirmed = await supabase.rpc("confirm_invoice_import_attempt", { p_attempt_id: input.importAttemptId, p_invoice_id: saved.statementId });
    if (confirmed.error) saved.warning = "Fatura salva, mas não foi possível vincular a leitura do arquivo.";
  }
  return saved;
}

export async function recalculateCardStatement(statementId: string) {
  const { data, error } = await supabase.rpc("recalculate_card_statement_v4", { p_statement_id: statementId });
  if (error || !data) throw new Error(error?.message ?? "A previsão não foi recalculada.");
  return data;
}

export interface InvoicePrintExtraction {
  bank_name: string;
  card_name: string;
  card_last_digits: string;
  competency_month: string;
  due_date: string;
  invoice_total: number | null;
  exchange_rate: number | null;
  exchange_rate_date: string;
  loyalty_program_name: string;
  actual_received_points: number | null;
  confidence_score: number;
  warnings: string[];
}

export interface InvoicePrintExtractionResult {
  attempt_id: string;
  file_path: string;
  extracted_data: InvoicePrintExtraction;
}

const acceptedInvoiceTypes = new Set(["image/png", "image/jpeg", "application/pdf"]);
const invoiceMimeByExtension: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf" };

export async function extractInvoiceFromPrint(clientId: string, file: File): Promise<InvoicePrintExtractionResult> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const contentType = acceptedInvoiceTypes.has(file.type) ? file.type : invoiceMimeByExtension[extension];
  if (!contentType) throw new Error("Envie um arquivo PNG, JPG, JPEG ou PDF.");
  if (file.size > 15 * 1024 * 1024) throw new Error("O arquivo deve ter no máximo 15 MB.");
  const importId = crypto.randomUUID();
  const objectPath = `${clientId}/${importId}/original`;
  const uploaded = await supabase.storage.from("invoice-uploads").upload(objectPath, file, { contentType, upsert: false, cacheControl: "3600" });
  if (uploaded.error) throw new Error(uploaded.error.message || "Não foi possível enviar o arquivo.");
  const invoked = await supabase.functions.invoke<InvoicePrintExtractionResult>("extract-invoice-from-print", { body: { client_id: clientId, file_path: `invoice-uploads/${objectPath}` } });
  if (invoked.error || !invoked.data) throw new Error(invoked.error?.message || "Não foi possível ler o arquivo.");
  return invoked.data;
}

export async function discardInvoiceImportAttempt(attemptId: string): Promise<void> {
  const { error } = await supabase.rpc("discard_invoice_import_attempt", { p_attempt_id: attemptId });
  if (error) throw new Error(error.message || "Não foi possível descartar a leitura.");
}
