export type EarningBasis = "brl" | "usd";

export function calculateExpectedPoints(input: {
  eligibleSpend: number;
  basis: EarningBasis;
  earningRate: number;
  fxRate?: number | null;
}): number {
  const { eligibleSpend, basis, earningRate, fxRate } = input;
  if (eligibleSpend < 0 || earningRate <= 0) {
    throw new Error("Valores de pontuação inválidos");
  }

  if (basis === "usd") {
    if (!fxRate || fxRate <= 0) throw new Error("Cotação do dólar obrigatória");
    return Math.round(((eligibleSpend / fxRate) * earningRate) * 100) / 100;
  }

  return Math.round((eligibleSpend * earningRate) * 100) / 100;
}

export function calculateSavings(input: {
  cashReference: number;
  taxes: number;
  additionalCash: number;
  attributedPointsCost: number;
}): number {
  const values = Object.values(input);
  if (values.some((value) => value < 0)) throw new Error("Valores negativos não são permitidos");

  return Math.round((
    input.cashReference
    - input.taxes
    - input.additionalCash
    - input.attributedPointsCost
  ) * 100) / 100;
}
