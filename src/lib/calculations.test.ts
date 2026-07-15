import { describe, expect, it } from "vitest";
import { calculateExpectedPoints, calculateSavings } from "@/lib/calculations";

describe("calculateExpectedPoints", () => {
  it("calcula cartões que pontuam por real", () => {
    expect(calculateExpectedPoints({
      eligibleSpend: 1000,
      basis: "brl",
      earningRate: 1.5,
    })).toBe(1500);
  });

  it("calcula cartões que pontuam por dólar", () => {
    expect(calculateExpectedPoints({
      eligibleSpend: 18500,
      basis: "usd",
      earningRate: 2.2,
      fxRate: 5.6,
    })).toBe(7267.86);
  });
});

describe("calculateSavings", () => {
  it("desconta todos os componentes do custo efetivo", () => {
    expect(calculateSavings({
      cashReference: 5000,
      taxes: 300,
      additionalCash: 200,
      attributedPointsCost: 1200,
    })).toBe(3300);
  });
});
