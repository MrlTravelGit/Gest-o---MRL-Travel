export interface PointsCostResult {
  totalValue: number;
  perThousand: number;
}

function assertPoints(points: number): void {
  if (!Number.isInteger(points) || points <= 0) {
    throw new Error("Informe uma quantidade maior que zero.");
  }
}

function assertMoney(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("O valor informado não pode ser negativo.");
  }
}

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function calculateFromTotal(points: number, totalValue: number): PointsCostResult {
  assertPoints(points);
  assertMoney(totalValue);
  const roundedTotal = round(totalValue, 2);
  return {
    totalValue: roundedTotal,
    perThousand: round(roundedTotal / (points / 1000), 4),
  };
}

export function calculateFromPerThousand(points: number, perThousand: number): PointsCostResult {
  assertPoints(points);
  assertMoney(perThousand);
  const roundedPerThousand = round(perThousand, 4);
  return {
    totalValue: round((points / 1000) * roundedPerThousand, 2),
    perThousand: roundedPerThousand,
  };
}

export function calculateWeightedAverage(
  currentBalance: number,
  currentAverage: number,
  addedPoints: number,
  addedTotalValue: number,
): number {
  if (currentBalance < 0 || currentAverage < 0) throw new Error("Saldo ou custo atual inválido.");
  assertPoints(addedPoints);
  assertMoney(addedTotalValue);
  const newBalance = currentBalance + addedPoints;
  const currentTotal = (currentBalance / 1000) * currentAverage;
  return newBalance === 0 ? 0 : round((currentTotal + addedTotalValue) / (newBalance / 1000), 4);
}

export function formatBrlInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(digits) / 100);
}

export function parseBrlInput(formatted: string): number | null {
  const digits = formatted.replace(/\D/g, "");
  return digits ? Number(digits) / 100 : null;
}
