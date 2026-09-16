import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, rpc } = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke }, rpc },
}));

import { getAdminClientDashboardPreview, getPublicClientDashboardByLink } from "./dashboard";

const dashboardPayload = {
  client: { displayName: "Cliente Teste", lastUpdatedAt: "2026-07-16T12:00:00Z" },
  summary: {
    totalPoints: 18500,
    estimatedPatrimony: 338.6,
    generatedSavings: 1200,
    redemptionsCount: 2,
    expiringIn90Days: 3000,
  },
  programs: [],
  balanceHistory: [],
  monthlyMovements: [],
  cardStatements: [],
  contract: null,
};

describe("dashboard services", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
  });

  it("usa a Edge Function de dashboard completo no acesso público por token", async () => {
    invoke.mockResolvedValueOnce({ data: dashboardPayload, error: null });

    await expect(getPublicClientDashboardByLink("a".repeat(64))).resolves.toMatchObject({
      summary: { totalPoints: 18500, estimatedPatrimony: 338.6 },
    });

    expect(invoke).toHaveBeenCalledWith("get-client-dashboard-by-link", { body: { token: "a".repeat(64) } });
    expect(invoke).not.toHaveBeenCalledWith("get-client-economy-by-link", expect.anything());
  });

  it("usa a prévia administrativa com o mesmo contrato completo", async () => {
    rpc.mockResolvedValueOnce({ data: dashboardPayload, error: null });

    await getAdminClientDashboardPreview("client-id");

    expect(rpc).toHaveBeenCalledWith("get_admin_client_dashboard_preview", { p_client_id: "client-id" });
  });
  it("adapta o saldo consolidado legado para availableBalance sem recalcular no cliente", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ...dashboardPayload,
        cashback: {
          enabled: true,
          notice: null,
          summary: { generated: 40, used: 5.86, reversed: 0, adjusted: 0, available: 34.14 },
          transactions: [],
        },
      },
      error: null,
    });

    await expect(getPublicClientDashboardByLink("a".repeat(64))).resolves.toMatchObject({
      cashback: { enabled: true, availableBalance: 34.14 },
    });
  });

  it("remove economias excluídas e protege os totais mesmo se o backend vazar o registro", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ...dashboardPayload,
        summary: { ...dashboardPayload.summary, generatedSavings: 1460.13, redemptionsCount: 2 },
        savingsHistory: [
          { id: "visible", savingsValue: 1200, cashbackAmount: 120, deletedAt: null },
          { id: "deleted", savingsValue: 260.13, cashbackAmount: 26.01, deletedAt: "2026-09-16T12:00:00Z" },
        ],
        cashback: {
          enabled: true,
          availableBalance: 146.01,
          notice: null,
          summary: { generated: 146.01, used: 0, paid: 0, reversed: 0, adjusted: 0, available: 146.01 },
          transactions: [
            { id: "tx-visible", type: "earning", amount: 120, description: "Visível", redemptionId: "visible", createdAt: "2026-09-15T12:00:00Z" },
            { id: "tx-deleted", type: "earning", amount: 26.01, description: "Excluída", redemptionId: "deleted", createdAt: "2026-09-16T12:00:00Z" },
          ],
        },
      },
      error: null,
    });

    const result = await getPublicClientDashboardByLink("a".repeat(64));

    expect(result.savingsHistory?.map((saving) => saving.id)).toEqual(["visible"]);
    expect(result.summary).toMatchObject({ generatedSavings: 1200, redemptionsCount: 1 });
    expect(result.cashback).toMatchObject({
      availableBalance: 120,
      summary: { generated: 120, available: 120 },
      transactions: [{ id: "tx-visible" }],
    });
  });
});
