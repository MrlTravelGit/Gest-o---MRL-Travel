export interface BalanceHistoryPoint {
  period: string;
  points: number;
  averageCost: number | null;
}

export interface MonthlyMovementPoint {
  period: string;
  pointsIn: number;
  pointsOut: number;
  netPoints: number;
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

export function normalizeMonthlyMovements(input: unknown): MonthlyMovementPoint[] {
  if (!Array.isArray(input)) return [];
  const byMonth = new Map<string, MonthlyMovementPoint>();
  input.forEach((value) => {
    const item = record(value);
    if (!item) return;
    const period = normalizeChartPeriod(item.period ?? item.month ?? item.date);
    if (!period) return;
    const legacyNet = finite(item.points);
    const explicitIn = finite(item.pointsIn ?? item.entries);
    const explicitOut = finite(item.pointsOut ?? item.exits);
    if (legacyNet === null && explicitIn === null && explicitOut === null && finite(item.netPoints) === null) return;
    const pointsIn = explicitIn ?? (legacyNet !== null && legacyNet > 0 ? legacyNet : 0);
    const pointsOut = Math.abs(explicitOut ?? (legacyNet !== null && legacyNet < 0 ? legacyNet : 0));
    const netPoints = finite(item.netPoints) ?? legacyNet ?? pointsIn - pointsOut;
    const current = byMonth.get(period) ?? { period, pointsIn: 0, pointsOut: 0, netPoints: 0 };
    current.pointsIn += pointsIn;
    current.pointsOut += pointsOut;
    current.netPoints += netPoints;
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
