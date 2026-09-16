import { describe, expect, it } from "vitest";
import { excludeDeletedTravelSales, removeTravelSaleFromResult } from "./travel-economy";
import type { TravelSale, TravelSalesResult } from "@/types/admin-modules";

function sale(overrides: Partial<TravelSale>): TravelSale {
  return {
    id: "active-1", clientId: "client-1", clientName: "Cliente", launchedOn: "2026-09-16",
    paymentMode: "cash", travelType: "flight", details: "Emissão CNF - GRU", originalValue: 1000,
    paidValue: 739.87, savingsAmount: 260.13, programName: null, pointsUsed: null, sourceSystem: null,
    sourceBatchKey: null, migrated: false, updatedAt: "2026-09-16T10:00:00Z", cashbackPercentage: 10,
    cashbackAmount: 73.99, cashbackBaseType: "paid_amount", cashbackBaseAmount: 739.87,
    cashbackCalculationVersion: "paid_amount_v1", hasEvidence: false, status: "active", voidedAt: null,
    voidedBy: null, voidReason: null, operationGroupId: "group-1", ...overrides,
  };
}

function result(items: TravelSale[]): TravelSalesResult {
  return {
    items, total: items.length, totalSavings: 360.13, totalCashback: 83.99, limit: 100, offset: 0,
    ranking: [{ position: 1, clientId: "client-1", clientName: "Cliente", totalSavings: 360.13, records: 2 }],
    pendingReconciliation: 0, canWrite: true, selectedClientCashback: null,
  };
}

describe("proteção de economias excluídas", () => {
  it("remove excluídas da resposta e dos totais mesmo se a API vazar o item", () => {
    const deleted = sale({ id: "deleted-1", deletedAt: "2026-09-16T11:00:00Z" });
    const active = sale({ id: "active-2", savingsAmount: 100, cashbackAmount: 10 });
    const filtered = excludeDeletedTravelSales(result([deleted, active]));
    expect(filtered.items.map((item) => item.id)).toEqual(["active-2"]);
    expect(filtered.total).toBe(1);
    expect(filtered.totalSavings).toBe(100);
    expect(filtered.totalCashback).toBe(10);
  });

  it("faz a remoção otimista e recalcula totais", () => {
    const removed = sale({ id: "remove-me" });
    const other = sale({ id: "keep-me", savingsAmount: 100, cashbackAmount: 10 });
    const updated = removeTravelSaleFromResult(result([removed, other]), removed.id);
    expect(updated.items.map((item) => item.id)).toEqual(["keep-me"]);
    expect(updated.total).toBe(1);
    expect(updated.totalSavings).toBe(100);
    expect(updated.totalCashback).toBe(10);
    expect(updated.ranking[0]).toMatchObject({ records: 1, totalSavings: 100 });
  });

  it("remove um item cuja chave esteja na lista persistida de ocultações", () => {
    const hidden = sale({ id: "legacy-id", sourceSystem: "iddas", sourceExternalKey: "iddas-row-14", migrated: true });
    const visible = sale({ id: "visible", savingsAmount: 100, cashbackAmount: 10 });
    const filtered = excludeDeletedTravelSales({
      ...result([hidden, visible]),
      hiddenKeys: ["client-1|iddas|iddas-row-14"],
    });
    expect(filtered.items.map((item) => item.id)).toEqual(["visible"]);
    expect(filtered.totalSavings).toBe(100);
    expect(filtered.totalCashback).toBe(10);
  });
});
