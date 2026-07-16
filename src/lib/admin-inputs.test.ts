import { describe, expect, it } from "vitest";
import { calculateTransfer, calculateTravelSavings, parseDecimalPtBr, parseMoneyPtBr, parsePointsPtBr } from "./admin-inputs";

describe("parsers administrativos pt-BR", () => {
  it("interpreta moeda, pontos, paridade e percentual", () => {
    expect(parseMoneyPtBr("R$ 5.000,25")).toBe(5000.25);
    expect(parsePointsPtBr("20.000")).toBe(20000);
    expect(parseDecimalPtBr("0,5")).toBe(0.5);
    expect(parseDecimalPtBr("30%")).toBe(30);
  });
  it("nega entradas ambíguas ou não numéricas", () => {
    expect(() => parseMoneyPtBr("cinco mil")).toThrow();
    expect(() => parsePointsPtBr("20,5")).toThrow();
  });
});

describe("fórmulas do PATCH 003", () => {
  it.each([[5000,3200,1800],[5000,5000,0],[3200,5000,-1800]])("calcula economia inclusive negativa",(original,paid,expected)=>expect(calculateTravelSavings(original,paid)).toBe(expected));
  it("calcula paridade inteira, decimal e arredonda o bônus", () => {
    expect(calculateTransfer(20000,1,30)).toEqual({ destinationBase:20000,bonusPoints:6000,destinationTotal:26000 });
    expect(calculateTransfer(20000,.5,20)).toEqual({ destinationBase:10000,bonusPoints:2000,destinationTotal:12000 });
    expect(calculateTransfer(1001,.5,33.3)).toEqual({ destinationBase:501,bonusPoints:167,destinationTotal:668 });
  });
});
