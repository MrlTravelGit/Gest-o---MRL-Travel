import { describe, expect, it } from "vitest";
import { calculateSavingsSummary, getSavingDisplayDate, isWithinSavingsDateRange } from "./savings-date-filter";

describe("filtro de período das economias", () => {
  it("usa a primeira data disponível na ordem canônica", () => {
    expect(getSavingDisplayDate({ launchedOn: "2026-01-08", date: "2025-01-01" })).toBe("2026-01-08");
    expect(getSavingDisplayDate({ issued_at: "2026-02-10", date: "2025-01-01" })).toBe("2026-02-10");
    expect(getSavingDisplayDate({ date: "2025-01-01" })).toBe("2025-01-01");
  });

  it("inclui integralmente os dias inicial e final", () => {
    expect(isWithinSavingsDateRange({ launchedOn: "2025-07-07" }, "2025-07-07", "2026-09-10")).toBe(true);
    expect(isWithinSavingsDateRange({ createdAt: "2026-09-10T23:59:59-03:00" }, "2025-07-07", "2026-09-10")).toBe(true);
    expect(isWithinSavingsDateRange({ launchedOn: "2025-07-06" }, "2025-07-07", "2026-09-10")).toBe(false);
    expect(isWithinSavingsDateRange({ launchedOn: "2026-09-11" }, "2025-07-07", "2026-09-10")).toBe(false);
  });

  it("aceita limites abertos e não rejeita item sem data quando não há filtro", () => {
    expect(isWithinSavingsDateRange({ date: "2026-01-01" }, "2025-07-07", "")).toBe(true);
    expect(isWithinSavingsDateRange({ date: "2025-01-01" }, "", "2025-07-07")).toBe(true);
    expect(isWithinSavingsDateRange({}, "", "")).toBe(true);
    expect(isWithinSavingsDateRange({}, "2025-07-07", "")).toBe(false);
  });

  it("calcula todos os cards somente com itens e transações visíveis do período", () => {
    const summary = calculateSavingsSummary([
      { date: "2025-07-07", savingsValue: 1000, cashbackAmount: 100 },
      { date: "2026-09-10", savingsValue: 500, cashbackAmount: 50 },
      { date: "2026-08-01", savingsValue: 999, cashbackAmount: 99, status: "voided" },
      { date: "2026-08-01", savingsValue: 999, cashbackAmount: 99, deletedAt: "2026-09-12" },
    ], [
      { createdAt: "2026-01-01T12:00:00-03:00", type: "redemption", redemptionMode: "usage", amount: 20 },
      { createdAt: "2026-02-01T12:00:00-03:00", type: "redemption", redemptionMode: "payment", amount: 10 },
      { createdAt: "2026-03-01T12:00:00-03:00", type: "adjustment", amount: 5 },
      { createdAt: "2024-01-01T12:00:00-03:00", type: "redemption", redemptionMode: "usage", amount: 500 },
    ], "2025-07-07", "2026-09-10");

    expect(summary).toEqual({ totalSaved: 1500, cashbackGenerated: 150, usedAmount: 20, paidAmount: 10, availableBalance: 125 });
  });
});
