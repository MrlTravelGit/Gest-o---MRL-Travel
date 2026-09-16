export interface SavingsMatchKeyInput {
  clientId: string;
  source?: string | null;
  sourceSystem?: string | null;
  sourceId?: string | null;
  sourceExternalKey?: string | null;
  id?: string | null;
  title?: string | null;
  details?: string | null;
  launchedOn?: string | null;
  originalAmount?: number | string | null;
  originalValue?: number | string | null;
  paidAmount?: number | string | null;
  paidValue?: number | string | null;
  savedAmount?: number | string | null;
  savingsAmount?: number | string | null;
  matchKey?: string | null;
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[$.,]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeMoney(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

export function buildSavingsMatchKey(item: SavingsMatchKeyInput) {
  if (item.matchKey?.trim()) return item.matchKey.trim().toLowerCase();
  const clientId = normalizeText(item.clientId);
  const source = normalizeText(item.source ?? item.sourceSystem ?? "redemptions") || "unknown";
  const sourceId = normalizeText(item.sourceId ?? item.sourceExternalKey ?? item.id);
  if (sourceId) return `${clientId}|${source}|${sourceId}`;

  const title = normalizeText(item.title ?? item.details) || "sem-titulo";
  const date = String(item.launchedOn ?? "").slice(0, 10) || "sem-data";
  return [
    clientId,
    source,
    "sem-id",
    title,
    date,
    normalizeMoney(item.originalAmount ?? item.originalValue),
    normalizeMoney(item.paidAmount ?? item.paidValue),
    normalizeMoney(item.savedAmount ?? item.savingsAmount),
  ].join("|");
}

export function shouldHideSavingInsteadOfDeleting(item: Pick<SavingsMatchKeyInput, "sourceSystem"> & { migrated?: boolean; paymentMode?: string; pointsUsed?: number | null }) {
  return Boolean(item.migrated || item.sourceSystem || item.paymentMode !== "cash" || item.pointsUsed != null);
}
