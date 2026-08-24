import { describe, expect, it } from "vitest";
import { calculateCashbackPreview, calculateSavingsPreview, normalizeMoneyDecimal, normalizePercentageDecimal } from "./cashback";

describe("cashback paid_amount_v1 com decimal exato", () => {
  it.each([
    ["1.706,90", "2", 34.14],
    ["500,00", "10", 50],
    ["1.100,25", "7,5", 82.52],
    ["0", "2", 0],
  ])("calcula %s a %s%%", (paid, percentage, expected) => {
    expect(calculateCashbackPreview(paid, percentage)).toBe(expected);
  });

  it("não usa a economia de Rafael como base", () => {
    expect(calculateSavingsPreview("1.884,04", "1.706,90")).toBe(177.14);
    expect(calculateCashbackPreview("177,14", "2")).toBe(3.54);
    expect(calculateCashbackPreview("1.706,90", "2")).toBe(34.14);
  });

  it("normaliza dinheiro e percentual para strings decimais exatas enviadas ao backend", () => {
    expect(normalizeMoneyDecimal("1.706,90")).toBe("1706.90");
    expect(normalizePercentageDecimal("7,5")).toBe("7.50");
  });

  it("não trunca fração de centavo", () => {
    expect(calculateCashbackPreview("1.706,90", "2")).not.toBe(34.13);
  });
});
