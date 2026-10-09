import { describe, expect, it } from "vitest";
import { classifyPointsMovement, normalizeBalanceHistory, normalizeMonthlyMovements, numericDomain } from "./dashboard-chart-data";

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
      { period: "2026-07", pointsIn: 2000, pointsRedeemed: 500, pointsExpired: 100, netPoints: 1400 },
      { month: "2026-06-01", points: -1000 },
    ])).toEqual([
      { period: "2026-06-01", pointsIn: 0, pointsRedeemed: 1000, pointsExpired: 0, pointsAdjustment: 0, netPoints: -1000, savingsGenerated: 0 },
      { period: "2026-07-01", pointsIn: 7000, pointsRedeemed: 500, pointsExpired: 100, pointsAdjustment: 0, netPoints: 6400, savingsGenerated: 0 },
    ]);
  });

  it("separa resgates, expirações e ajustes usando a classificação central", () => {
    expect(classifyPointsMovement({ transactionType: "redemption", description: "Reserva de passagem" })).toBe("redeemed");
    expect(classifyPointsMovement({ type: "Expiração de pontos" })).toBe("expired");
    expect(classifyPointsMovement({ type: "Bônus do cartão" })).toBe("inflow");
    expect(classifyPointsMovement({ type: "Correção manual" })).toBe("adjustment");
    expect(classifyPointsMovement({ type: "transfer_out" })).toBe("ignored");

    expect(normalizeMonthlyMovements([
      { date: "2026-09-01", transactionType: "redemption", pointsDelta: -300000, description: "Uso de pontos em viagem" },
      { date: "2026-09-02", transactionType: "expiration", pointsDelta: -2500 },
      { date: "2026-09-03", transactionType: "adjustment", pointsDelta: -100 },
    ], [
      { date: "2026-09-02", savingsValue: 6562.69 },
    ])).toEqual([
      { period: "2026-09-01", pointsIn: 0, pointsRedeemed: 300000, pointsExpired: 2500, pointsAdjustment: -100, netPoints: -302600, savingsGenerated: 6562.69 },
    ]);
  });

  it("gera domínio visível para zero e um único ponto", () => {
    expect(numericDomain([0])).toEqual([-1, 1]);
    expect(numericDomain([5000])).toEqual([0, 5500]);
  });
});
