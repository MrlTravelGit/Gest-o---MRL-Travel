import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClientDashboardView } from "./ClientDashboardView";
import type { PublicClientDashboard } from "@/types/dashboard";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Line: () => null,
  Bar: () => null,
}));

const dashboard: PublicClientDashboard = {
  client: { displayName: "Maria Cliente", lastUpdatedAt: "2026-07-16T10:00:00Z" },
  summary: {
    totalPoints: 18500,
    estimatedPatrimony: 338.6,
    generatedSavings: 940,
    redemptionsCount: 3,
    expiringIn90Days: 1500,
  },
  programs: [
    {
      slug: "latam_pass",
      name: "LATAM Pass",
      logoUrl: null,
      balance: 10000,
      averageCostPerThousand: 18.2,
      estimatedValue: 182,
      capturedAt: "2026-07-16T10:00:00Z",
      expiringPoints: 500,
    },
  ],
  balanceHistory: [{ month: "2026-07-01", balance: 18500, averageCostPerThousand: 18.2 }],
  monthlyMovements: [{ month: "2026-07-01", points: 2500 }],
  cardStatements: [],
  contract: null,
};

describe("ClientDashboardView", () => {
  it("renderiza o dashboard completo e não a tela simplificada de economia", () => {
    render(<ClientDashboardView dashboard={dashboard} />);

    expect(screen.getByRole("heading", { name: /painel completo de maria cliente/i })).toBeInTheDocument();
    expect(screen.getByText("Saldo de Pontos/Milhas")).toBeInTheDocument();
    expect(screen.getByText("Patrimônio")).toBeInTheDocument();
    expect(screen.getByText("Economia")).toBeInTheDocument();
    expect(screen.getByText("Emissões/Economias")).toBeInTheDocument();
    expect(screen.getByText("LATAM Pass")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /saldo acumulado/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /movimentação mensal/i })).toBeInTheDocument();

    expect(screen.queryByText("Economia MRL Travel")).not.toBeInTheDocument();
    expect(screen.queryByText("Somente economia")).not.toBeInTheDocument();
    expect(screen.queryByText("Página exclusiva de economia")).not.toBeInTheDocument();
  });
});
