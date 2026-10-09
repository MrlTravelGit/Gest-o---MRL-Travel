export interface BalanceHistoryPoint {
  period: string;
  points: number;
  averageCost: number | null;
}

export type PointsMovementCategory = "inflow" | "redeemed" | "expired" | "adjustment" | "ignored";

export interface PointsTransaction {
  type?: unknown;
  transactionType?: unknown;
  transaction_type?: unknown;
  category?: unknown;
  entryCategory?: unknown;
  entry_category?: unknown;
  description?: unknown;
  notes?: unknown;
  source?: unknown;
  points?: unknown;
  pointsDelta?: unknown;
  points_delta?: unknown;
}

export interface MonthlyMovementPoint {
  period: string;
  pointsIn: number;
  pointsRedeemed: number;
  pointsExpired: number;
  pointsAdjustment: number;
  netPoints: number;
  savingsGenerated: number;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? value as UnknownRecord : null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function searchable(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

/** Centraliza a leitura semântica das movimentações exibidas no dashboard. */
export function classifyPointsMovement(transaction: PointsTransaction): PointsMovementCategory {
  const type = searchable(transaction.type ?? transaction.transactionType ?? transaction.transaction_type);
  const category = searchable(transaction.category ?? transaction.entryCategory ?? transaction.entry_category);
  const description = searchable(transaction.description ?? transaction.notes);
  const source = searchable(transaction.source);
  const context = `${type} ${category} ${description} ${source}`;

  if (includesAny(context, ["expiration", "expiracao", "expirado", "vencido", "vencimento", "perda de pontos"])) return "expired";
  if (includesAny(context, ["redemption", "emissao", "resgate", "viagem", "passagem", "hospedagem", "economia", "reserva", "travel_sale"])) return "redeemed";
  if (includesAny(context, ["saldo inicial", "initial_balance", "credit", "compra", "bonus", "transfer_in", "transferencia recebida", "cartao", "ajuste positivo"])) return "inflow";
  if (includesAny(context, ["adjustment", "ajuste", "correcao", "manual_exit"])) return "adjustment";
  return "ignored";
}

export function normalizeChartPeriod(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  const isoMonth = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (isoMonth) {
    const month = Number(isoMonth[2]);
    if (month >= 1 && month <= 12) return `${isoMonth[1]}-${isoMonth[2]}-01`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function normalizeBalanceHistory(input: unknown): BalanceHistoryPoint[] {
  if (!Array.isArray(input)) return [];
  const byMonth = new Map<string, BalanceHistoryPoint>();
  input.forEach((value) => {
    const item = record(value);
    if (!item) return;
    const period = normalizeChartPeriod(item.period ?? item.month ?? item.date);
    const points = finite(item.points ?? item.balance ?? item.totalPoints);
    if (!period || points === null) return;
    const averageCost = finite(item.averageCost ?? item.averageCostPerThousand ?? item.costPerThousand);
    // O payload oficial representa um total mensal. Em duplicidade, a última
    // ocorrência é o snapshot consolidado mais recente daquele mês.
    byMonth.set(period, { period, points, averageCost });
  });
  return [...byMonth.values()].sort((a, b) => a.period.localeCompare(b.period));
}

function emptyMonthlyMovement(period: string): MonthlyMovementPoint {
  return { period, pointsIn: 0, pointsRedeemed: 0, pointsExpired: 0, pointsAdjustment: 0, netPoints: 0, savingsGenerated: 0 };
}

export function normalizeMonthlyMovements(input: unknown, savingsInput?: unknown): MonthlyMovementPoint[] {
  const byMonth = new Map<string, MonthlyMovementPoint>();
  if (Array.isArray(input)) input.forEach((value) => {
    const item = record(value);
    if (!item) return;
    const period = normalizeChartPeriod(item.period ?? item.month ?? item.date ?? item.entryDate ?? item.occurredAt);
    if (!period) return;

    const legacyNet = finite(item.points);
    const explicitIn = finite(item.pointsIn ?? item.entries);
    const explicitRedeemed = finite(item.pointsRedeemed ?? item.redeemed ?? item.pointsOut ?? item.exits);
    const explicitExpired = finite(item.pointsExpired ?? item.expired);
    const explicitAdjustment = finite(item.pointsAdjustment ?? item.adjustment);
    const explicitNet = finite(item.netPoints);
    const hasAggregateFields = [explicitIn, explicitRedeemed, explicitExpired, explicitAdjustment, explicitNet].some((entry) => entry !== null);
    const rawDelta = finite(item.pointsDelta ?? item.points_delta ?? item.amount ?? item.points);
    if (!hasAggregateFields && rawDelta === null) return;

    let pointsIn = Math.abs(explicitIn ?? 0);
    let pointsRedeemed = Math.abs(explicitRedeemed ?? 0);
    let pointsExpired = Math.abs(explicitExpired ?? 0);
    let pointsAdjustment = explicitAdjustment ?? 0;
    let netPoints = explicitNet;

    if (!hasAggregateFields && rawDelta !== null) {
      const hasClassificationContext = [item.type, item.transactionType, item.transaction_type, item.category, item.entryCategory, item.entry_category, item.description, item.notes, item.source]
        .some((entry) => entry !== null && entry !== undefined && String(entry).trim() !== "");
      const category = hasClassificationContext ? classifyPointsMovement(item as PointsTransaction) : rawDelta >= 0 ? "inflow" : "redeemed";
      if (category === "inflow") pointsIn = Math.abs(rawDelta);
      if (category === "redeemed") pointsRedeemed = Math.abs(rawDelta);
      if (category === "expired") pointsExpired = Math.abs(rawDelta);
      if (category === "adjustment") pointsAdjustment = rawDelta;
      netPoints = category === "ignored" ? 0 : rawDelta;
    }

    if (netPoints === null) netPoints = legacyNet ?? pointsIn - pointsRedeemed - pointsExpired + pointsAdjustment;
    const current = byMonth.get(period) ?? emptyMonthlyMovement(period);
    current.pointsIn += pointsIn;
    current.pointsRedeemed += pointsRedeemed;
    current.pointsExpired += pointsExpired;
    current.pointsAdjustment += pointsAdjustment;
    current.netPoints += netPoints;
    current.savingsGenerated += finite(item.savingsGenerated ?? item.generatedSavings) ?? 0;
    byMonth.set(period, current);
  });

  if (Array.isArray(savingsInput)) savingsInput.forEach((value) => {
    const item = record(value);
    if (!item || item.deletedAt || item.deleted_at || item.status === "cancelled") return;
    const period = normalizeChartPeriod(item.date ?? item.launchedOn ?? item.issuedAt);
    const savings = finite(item.savingsValue ?? item.savingsAmount ?? item.savings_amount);
    if (!period || savings === null) return;
    const current = byMonth.get(period) ?? emptyMonthlyMovement(period);
    current.savingsGenerated += savings;
    byMonth.set(period, current);
  });

  return [...byMonth.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function numericDomain(values: number[]): [number, number] {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return [0, 1];
  const minimum = Math.min(...valid, 0);
  const maximum = Math.max(...valid, 0);
  if (minimum === maximum) {
    const padding = Math.max(Math.abs(maximum) * 0.12, 1);
    return [minimum - padding, maximum + padding];
  }
  const padding = Math.max((maximum - minimum) * 0.1, 1);
  return [minimum < 0 ? minimum - padding : 0, maximum + padding];
}
