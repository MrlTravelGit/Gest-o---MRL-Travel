import { describe, expect, it } from "vitest";
import { parseMoneyPtBr } from "./admin-inputs";
import { calculateMileageCost } from "./mileage-cost";

describe("calculateMileageCost", () => {
  it("calcula compra parcial com bônus de 80%", () => {
    expect(calculateMileageCost({ totalPoints: 100_000, pointsUsed: 1_000, cashAmount: 3_130.68, bonusPercent: 80 })).toMatchObject({
      cashPurchasedPoints: 99_000,
      cashPurchasedThousands: 99,
      baseCostPerThousand: 31.62,
      bonusFactor: 1.8,
      finalPointsWithBonus: 180_000,
      finalCostPerThousand: 17.57,
      rating: "excellent",
    });
  });

  it("calcula o mesmo caso com bônus de 50%", () => {
    expect(calculateMileageCost({ totalPoints: 100_000, pointsUsed: 1_000, cashAmount: 3_130.68, bonusPercent: 50 }).finalCostPerThousand).toBe(21.08);
  });

  it("aceita zero pontos usados e aplica desconto Pix", () => {
    expect(calculateMileageCost({ totalPoints: 100_000, pointsUsed: 0, cashAmount: 3_000, bonusPercent: 0, pixDiscountPercent: 2 })).toMatchObject({
      cashPurchasedPoints: 100_000,
      baseCostPerThousand: 30,
      finalCostPerThousandWithPix: 29.4,
    });
  });

  it("bloqueia pontos usados maiores ou iguais ao total", () => {
    expect(() => calculateMileageCost({ totalPoints: 100_000, pointsUsed: 100_001, cashAmount: 1, bonusPercent: 0 })).toThrow("menores que o total");
  });

  it("aceita dinheiro no formato brasileiro pelo parser oficial", () => {
    const cashAmount = parseMoneyPtBr("R$ 3.130,68");
    expect(calculateMileageCost({ totalPoints: 100_000, pointsUsed: 1_000, cashAmount, bonusPercent: 80 }).finalCostPerThousand).toBe(17.57);
  });
});
