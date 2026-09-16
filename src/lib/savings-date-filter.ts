export type SavingDateLike = {
  launchedOn?: string | null;
  launched_on?: string | null;
  issued_at?: string | null;
  redeemed_at?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  date?: string | null;
};

export type SavingsSummaryItem = SavingDateLike & {
  savingsAmount?: number | null;
  savingsValue?: number | null;
  cashbackAmount?: number | null;
  status?: string | null;
  deletedAt?: string | null;
  deleted_at?: string | null;
};

export type SavingsSummaryTransaction = SavingDateLike & {
  type: string;
  amount: number;
  redemptionMode?: "usage" | "payment" | null;
};

export interface SavingsPeriodSummary {
  totalSaved: number;
  cashbackGenerated: number;
  availableBalance: number;
  usedAmount: number;
  paidAmount: number;
}

export function parseDateOnlyToStart(date: string) {
  return new Date(`${date}T00:00:00`);
}

export function parseDateOnlyToEnd(date: string) {
  return new Date(`${date}T23:59:59.999`);
}

export function getSavingDisplayDate(item: SavingDateLike) {
  return item.launchedOn
    || item.launched_on
    || item.issued_at
    || item.redeemed_at
    || item.created_at
    || item.createdAt
    || item.date
    || null;
}

function parseSavingDate(item: SavingDateLike) {
  const rawDate = getSavingDisplayDate(item);
  if (!rawDate) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);
  const parsed = new Date(dateOnly ? `${rawDate}T12:00:00` : rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isWithinSavingsDateRange(item: SavingDateLike, startDate: string, endDate: string) {
  if (!startDate && !endDate) return true;
  const itemDate = parseSavingDate(item);
  if (!itemDate) return false;
  const start = startDate ? parseDateOnlyToStart(startDate) : null;
  const end = endDate ? parseDateOnlyToEnd(endDate) : null;
  return !(start && itemDate < start) && !(end && itemDate > end);
}

export function isSavingsDateRangeInvalid(startDate: string, endDate: string) {
  return Boolean(startDate && endDate && startDate > endDate);
}

function isVisibleActiveSaving(item: SavingsSummaryItem) {
  const status = String(item.status ?? "active").toLowerCase();
  return item.deletedAt == null
    && item.deleted_at == null
    && !["deleted", "removed", "archived", "hidden", "voided", "cancelled"].includes(status);
}

export function calculateSavingsSummary(
  items: SavingsSummaryItem[],
  transactions: SavingsSummaryTransaction[] = [],
  startDate = "",
  endDate = "",
): SavingsPeriodSummary {
  const activeItems = items.filter(isVisibleActiveSaving);
  const periodTransactions = transactions.filter((transaction) => isWithinSavingsDateRange(transaction, startDate, endDate));
  const cashbackGenerated = activeItems.reduce((total, item) => total + Number(item.cashbackAmount ?? 0), 0);
  const usedAmount = periodTransactions
    .filter((transaction) => transaction.type === "redemption" && transaction.redemptionMode !== "payment")
    .reduce((total, transaction) => total + Math.abs(Number(transaction.amount || 0)), 0);
  const paidAmount = periodTransactions
    .filter((transaction) => transaction.type === "redemption" && transaction.redemptionMode === "payment")
    .reduce((total, transaction) => total + Math.abs(Number(transaction.amount || 0)), 0);
  const reversed = periodTransactions
    .filter((transaction) => transaction.type === "reversal")
    .reduce((total, transaction) => total + Math.abs(Number(transaction.amount || 0)), 0);
  const adjusted = periodTransactions
    .filter((transaction) => transaction.type === "adjustment")
    .reduce((total, transaction) => total + Number(transaction.amount || 0), 0);

  return {
    totalSaved: activeItems.reduce((total, item) => total + Number(item.savingsAmount ?? item.savingsValue ?? 0), 0),
    cashbackGenerated,
    availableBalance: cashbackGenerated + adjusted - usedAmount - paidAmount - reversed,
    usedAmount,
    paidAmount,
  };
}

export function formatSavingsPeriod(startDate: string, endDate: string) {
  const format = (date: string) => date ? date.split("-").reverse().join("/") : "sem limite";
  return `${format(startDate)} até ${format(endDate)}`;
}
