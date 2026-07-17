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
});
