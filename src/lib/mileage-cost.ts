export interface MileageCostInput {
  totalPoints: number;
  pointsUsed: number;
  cashAmount: number;
  bonusPercent: number;
  pixDiscountPercent?: number;
}

export type MileageCostRating = "excellent" | "good" | "attention" | "expensive";

export interface MileageCostResult {
  cashPurchasedPoints: number;
  cashPurchasedThousands: number;
  baseCostPerThousand: number;
  bonusFactor: number;
  finalPointsWithBonus: number;
  finalCostPerThousand: number;
  finalCostPerThousandWithPix?: number;
  rating: MileageCostRating;
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateMileageCost(input: MileageCostInput): MileageCostResult {
  const { totalPoints, pointsUsed, cashAmount, bonusPercent, pixDiscountPercent } = input;

  if (!Number.isFinite(totalPoints) || totalPoints <= 0) throw new Error("O total de pontos precisa ser maior que zero.");
  if (!Number.isFinite(pointsUsed) || pointsUsed < 0) throw new Error("Os pontos usados não podem ser negativos.");
  if (pointsUsed >= totalPoints) throw new Error("Os pontos usados devem ser menores que o total de pontos.");
  if (!Number.isFinite(cashAmount) || cashAmount <= 0) throw new Error("O valor em dinheiro precisa ser maior que zero.");
  if (!Number.isFinite(bonusPercent) || bonusPercent < 0) throw new Error("O percentual de bônus não pode ser negativo.");
  if (pixDiscountPercent !== undefined && (!Number.isFinite(pixDiscountPercent) || pixDiscountPercent < 0 || pixDiscountPercent > 100)) {
    throw new Error("O desconto no Pix deve estar entre 0% e 100%.");
  }

  const cashPurchasedPoints = totalPoints - pointsUsed;
  const cashPurchasedThousands = cashPurchasedPoints / 1000;
  const baseCostPerThousand = roundMoney(cashAmount / cashPurchasedThousands);
  const bonusFactor = 1 + bonusPercent / 100;
  const finalPointsWithBonus = Math.round(totalPoints * bonusFactor);
  const finalCostPerThousand = roundMoney(baseCostPerThousand / bonusFactor);
  const finalCostPerThousandWithPix = pixDiscountPercent === undefined
    ? undefined
    : roundMoney(finalCostPerThousand * (1 - pixDiscountPercent / 100));
  const ratedCost = finalCostPerThousandWithPix ?? finalCostPerThousand;
  const rating: MileageCostRating = ratedCost <= 18
    ? "excellent"
    : ratedCost <= 22
      ? "good"
      : ratedCost <= 27
        ? "attention"
        : "expensive";

  return {
    cashPurchasedPoints,
    cashPurchasedThousands,
    baseCostPerThousand,
    bonusFactor,
    finalPointsWithBonus,
    finalCostPerThousand,
    ...(finalCostPerThousandWithPix === undefined ? {} : { finalCostPerThousandWithPix }),
    rating,
  };
}
