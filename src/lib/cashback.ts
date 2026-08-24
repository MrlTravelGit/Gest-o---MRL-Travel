function normalizeLocalizedDecimal(value: string | number): string {
  const clean = String(value).trim().replace(/\s/g, "").replace(/R\$/gi, "").replace(/%/g, "");
  if (!clean) throw new Error("Valor vazio");

  const comma = clean.lastIndexOf(",");
  const dot = clean.lastIndexOf(".");
  if (comma > dot) return clean.replace(/\./g, "").replace(",", ".");
  if (dot > comma && comma >= 0) return clean.replace(/,/g, "");
  if (comma >= 0) return clean.replace(",", ".");
  return clean;
}

function parseScaled(value: string | number, scale: number): bigint {
  const normalized = normalizeLocalizedDecimal(value);
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("Decimal inválido");
  const fraction = match[2] ?? "";
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) throw new Error("Casas decimais excedidas");
  const padded = fraction.slice(0, scale).padEnd(scale, "0");
  return BigInt(match[1]) * 10n ** BigInt(scale) + BigInt(padded || "0");
}

function scaledToDecimal(value: bigint, scale: number): string {
  const divisor = 10n ** BigInt(scale);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(scale, "0");
  return scale ? `${whole}.${fraction}` : whole.toString();
}

export function normalizeMoneyDecimal(value: string | number): string {
  return scaledToDecimal(parseScaled(value, 2), 2);
}

export function normalizePercentageDecimal(value: string | number): string {
  return scaledToDecimal(parseScaled(value, 2), 2);
}

export function calculateSavingsPreview(originalValue: string | number, paidValue: string | number): number {
  const savingsInCents = parseScaled(originalValue, 2) - parseScaled(paidValue, 2);
  return Number(savingsInCents) / 100;
}

export function calculateCashbackPreview(paidValue: string | number, percentage: string | number): number {
  const paidInCents = parseScaled(paidValue, 2);
  const percentageInBasisPoints = parseScaled(percentage, 2);
  if (percentageInBasisPoints <= 0n || percentageInBasisPoints > 10_000n) throw new Error("Percentual inválido");

  const numerator = paidInCents * percentageInBasisPoints;
  const cashbackInCents = (numerator + 5_000n) / 10_000n;
  return Number(cashbackInCents) / 100;
}

