import { describe, expect, it } from "vitest";
import {
  calculateFromPerThousand,
  calculateFromTotal,
  calculateWeightedAverage,
  formatBrlInput,
  parseBrlInput,
} from "./points-cost";

describe("cálculos de custo de pontos", () => {
  it("calcula o milheiro no modo VT", () => {
    expect(calculateFromTotal(20_000, 400)).toEqual({ totalValue: 400, perThousand: 20 });
  });

  it("calcula o total no modo VM", () => {
    expect(calculateFromPerThousand(20_000, 20)).toEqual({ totalValue: 400, perThousand: 20 });
  });

  it("calcula o custo médio ponderado", () => {
    expect(calculateWeightedAverage(100_000, 15, 20_000, 400)).toBe(15.8333);
  });

  it("aceita custo zero", () => {
    expect(calculateFromTotal(20_000, 0)).toEqual({ totalValue: 0, perThousand: 0 });
  });

  it("rejeita valores negativos", () => {
    expect(() => calculateFromTotal(20_000, -1)).toThrow("não pode ser negativo");
  });

  it("rejeita quantidade zero", () => {
    expect(() => calculateFromTotal(0, 400)).toThrow("quantidade maior que zero");
  });

  it("formata e interpreta moeda brasileira", () => {
    expect(formatBrlInput("40000")).toBe("R$ 400,00");
    expect(parseBrlInput("R$ 400,00")).toBe(400);
  });
});
