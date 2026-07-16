function normalizeLocalized(value: string): string {
  const clean = value.trim().replace(/\s/g, "");
  if (!clean) return "";
  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma > dot) return clean.replace(/\./g, "").replace(",", ".");
  if (dot > comma && comma >= 0) return clean.replace(/,/g, "");
  if (comma >= 0) return clean.replace(",", ".");
  return clean;
}

export function parseDecimalPtBr(value: string): number {
  const normalized = normalizeLocalized(value.replace(/R\$/gi, "").replace(/%/g, ""));
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) throw new Error("Número inválido");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) throw new Error("Número inválido");
  return parsed;
}

export function parseMoneyPtBr(value: string): number {
  return Math.round(parseDecimalPtBr(value) * 100) / 100;
}

export function parsePointsPtBr(value: string): number {
  const normalized = value.trim().replace(/[.\s]/g, "");
  if (!/^\d+$/.test(normalized)) throw new Error("Pontos inválidos");
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed)) throw new Error("Pontos inválidos");
  return parsed;
}

export function calculateTravelSavings(originalValue: number, paidValue: number): number {
  return Math.round((originalValue - paidValue) * 100) / 100;
}

export function calculateTransfer(sourcePoints: number, parity: number, bonusPercentage: number) {
  const destinationBase = Math.round(sourcePoints * parity);
  const bonusPoints = Math.round(destinationBase * bonusPercentage / 100);
  return { destinationBase, bonusPoints, destinationTotal: destinationBase + bonusPoints };
}
