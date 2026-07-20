import { describe, expect, it } from "vitest";
import { normalizeBalanceHistory, normalizeMonthlyMovements, numericDomain } from "./dashboard-chart-data";

describe("dashboard chart data", () => {
  it("normaliza, ordena e preserva zero no saldo", () => {
    expect(normalizeBalanceHistory([
      { month: "2026-07-01", balance: "5000", averageCostPerThousand: "20.37" },
      { period: "2026-06", points: 0, averageCost: null },
    ])).toEqual([
      { period: "2026-06-01", points: 0, averageCost: null },
      { period: "2026-07-01", points: 5000, averageCost: 20.37 },
    ]);
  });

  it("descarta data e números inválidos sem quebrar", () => {
    expect(normalizeBalanceHistory([{ month: "inválida", balance: 1 }, { month: "2026-01-01", balance: "NaN" }])).toEqual([]);
  });

  it("consolida movimentações do mesmo mês e adapta o contrato legado", () => {
    expect(normalizeMonthlyMovements([
      { month: "2026-07-10", points: 5000 },
      { period: "2026-07", pointsIn: 2000, pointsOut: 500, netPoints: 1500 },
      { month: "2026-06-01", points: -1000 },
    ])).toEqual([
      { period: "2026-06-01", pointsIn: 0, pointsOut: 1000, netPoints: -1000 },
      { period: "2026-07-01", pointsIn: 7000, pointsOut: 500, netPoints: 6500 },
    ]);
  });

  it("gera domínio visível para zero e um único ponto", () => {
    expect(numericDomain([0])).toEqual([-1, 1]);
    expect(numericDomain([5000])).toEqual([0, 5500]);
  });
});
