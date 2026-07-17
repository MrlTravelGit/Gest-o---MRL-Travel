import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { PublicClientDashboard } from "@/types/dashboard";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Line: () => null,
  Bar: () => null,
  LabelList: () => null,
}));

vi.mock("@/components/routes/AdminProtectedRoute", () => ({
  AdminProtectedRoute: () => <div data-testid="admin-protected-route" />,
}));

vi.mock("@/components/routes/LoadingScreen", () => ({
  LoadingScreen: () => <div>Carregando</div>,
}));

const dashboard: PublicClientDashboard = {
  client: { displayName: "Cliente Rota", lastUpdatedAt: "2026-07-17T10:00:00Z" },
  summary: {
    totalPoints: 18500,
    estimatedPatrimony: 338.6,
    generatedSavings: 940,
    redemptionsCount: 3,
    expiringIn90Days: 0,
  },
  programs: [],
  balanceHistory: [{ month: "2026-07-01", balance: 18500 }],
  monthlyMovements: [{ month: "2026-07-01", points: 2500 }],
  cardStatements: [],
  contract: null,
};

const { getPublicClientDashboardByLink } = vi.hoisted(() => ({
  getPublicClientDashboardByLink: vi.fn(),
}));

vi.mock("@/services/dashboard", () => ({
  getAdminClientDashboardPreview: vi.fn(),
  getAdminOverview: vi.fn(),
  getPublicClientDashboardByLink,
}));

describe("rota pública do dashboard do cliente", () => {
  it("renderiza o dashboard completo em /economia/:token sem página intermediária", async () => {
    getPublicClientDashboardByLink.mockResolvedValue(dashboard);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/economia/" + "a".repeat(64)]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Cliente Rota" })).toBeInTheDocument();
    expect(getPublicClientDashboardByLink).toHaveBeenCalledWith("a".repeat(64));
    expect(screen.queryByText(/painel completo de/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/validando link seguro/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Economia MRL Travel")).not.toBeInTheDocument();
  });
});
