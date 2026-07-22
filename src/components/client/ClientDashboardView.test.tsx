import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClientDashboardView } from "./ClientDashboardView";
import type { PublicClientDashboard } from "@/types/dashboard";

const lineChartSpy = vi.fn();
const barChartSpy = vi.fn();

vi.mock("recharts", () => ({
  LineChart: ({ children, data, height, width }: { children: ReactNode; data: unknown[]; height: number; width: number }) => {
    lineChartSpy(data);
    return <div data-testid="line-chart" data-height={height} data-width={width}>{children}</div>;
  },
  ComposedChart: ({ children, data, height, width }: { children: ReactNode; data: unknown[]; height: number; width: number }) => {
    barChartSpy(data);
    return <div data-testid="bar-chart" data-height={height} data-width={width}>{children}</div>;
  },
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Line: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const balanceHistory = [
  { month: "2026-07-01", balance: 18500, averageCostPerThousand: 18.2 },
  { month: "2026-06-01", balance: 16000, averageCostPerThousand: 17.8 },
];
const monthlyMovements = [
  { month: "2026-07-01", points: 2500 },
  { month: "2026-06-01", points: 1000 },
];

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
      slug: "atomos",
      name: "Átomos",
      logoUrl: null,
      balance: 6500,
      averageCostPerThousand: 10.77,
      estimatedValue: 143,
      capturedAt: "2026-07-16T10:00:00Z",
      expiringPoints: 0,
    },
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
  balanceHistory,
  monthlyMovements,
  cardStatements: [],
  contract: { startsOn: "2026-07-01", endsOn: "2026-12-31", status: "active", planName: "Gestão MRL", daysRemaining: 120 },
};

describe("ClientDashboardView", () => {
  it("renderiza a nova hierarquia pública sem hero antigo nem textos de autenticação", () => {
    render(<ClientDashboardView dashboard={dashboard} />);

    expect(screen.getByRole("heading", { name: "Maria Cliente" })).toBeInTheDocument();
    expect(screen.queryByText(/painel completo de/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/acesso exclusivo por link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/painel protegido/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/login|otp|authenticator|validando link seguro/i)).not.toBeInTheDocument();
    expect(screen.queryByText("ClientEconomyPage")).not.toBeInTheDocument();

    expect(screen.getAllByText("Saldo de Pontos/Milhas")).toHaveLength(1);
    expect(screen.getAllByText("Patrimônio")).toHaveLength(1);
    expect(screen.getAllByText("Economia")).toHaveLength(1);
    expect(screen.getAllByText("Emissões/Economias")).toHaveLength(1);

    expect(screen.getByRole("heading", { name: /milhas por programa/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /saldo acumulado/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /movimentação mensal/i })).toBeInTheDocument();
    expect(screen.getAllByAltText("MRL Travel").length).toBeGreaterThanOrEqual(2);
  });

  it("resolve logo local para programa conhecido e usa fallback quando o asset está ausente", () => {
    render(<ClientDashboardView dashboard={dashboard} />);

    const atomosLogo = screen.getByAltText("Logo Átomos");
    expect(atomosLogo).toHaveAttribute("src", "/assets/loyalty-programs/%C3%A1tomos.svg");

    fireEvent.error(atomosLogo);

    expect(screen.getByLabelText("Logo indisponível para Átomos")).toBeInTheDocument();
    expect(screen.getByText("ÁT")).toBeInTheDocument();
  });

  it("programa desconhecido usa fallback elegante e não quebra", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, programs: [{ ...dashboard.programs[0], slug: "xpto", name: "Programa X" }] }} />);

    expect(screen.getByLabelText("Logo indisponível para Programa X")).toBeInTheDocument();
    expect(screen.getByText("PX")).toBeInTheDocument();
  });

  it("entrega os dados reais aos dois gráficos sem mutar os arrays de origem", () => {
    const originalBalance = [...balanceHistory];
    const originalMovements = [...monthlyMovements];

    render(<ClientDashboardView dashboard={dashboard} />);

    expect(lineChartSpy).toHaveBeenCalledWith([
      { period: "2026-06-01", points: 16000, averageCost: 17.8 },
      { period: "2026-07-01", points: 18500, averageCost: 18.2 },
    ]);
    expect(barChartSpy).toHaveBeenCalledWith([
      { period: "2026-06-01", pointsIn: 1000, pointsOut: 0, netPoints: 1000 },
      { period: "2026-07-01", pointsIn: 2500, pointsOut: 0, netPoints: 2500 },
    ]);
    expect(balanceHistory).toEqual(originalBalance);
    expect(monthlyMovements).toEqual(originalMovements);
  });

  it("mostra empty state compacto quando não há série válida", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, balanceHistory: [], monthlyMovements: [] }} />);
    expect(screen.getAllByText("O histórico aparecerá após os primeiros lançamentos.")).toHaveLength(2);
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("renderiza um único saldo e uma única movimentação, inclusive com zero", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, balanceHistory: [{ month: "2026-07-01", balance: 0, averageCostPerThousand: 0 }], monthlyMovements: [{ month: "2026-07-01", points: 5000 }] }} />);
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(lineChartSpy).toHaveBeenLastCalledWith([{ period: "2026-07-01", points: 0, averageCost: 0 }]);
    expect(barChartSpy).toHaveBeenLastCalledWith([{ period: "2026-07-01", pointsIn: 5000, pointsOut: 0, netPoints: 5000 }]);
  });

  it("fornece dimensões numéricas aos gráficos sem depender da medição interna do Recharts", () => {
    render(<ClientDashboardView dashboard={dashboard} />);
    expect(screen.getByTestId("line-chart")).toHaveAttribute("data-width", "640");
    expect(screen.getByTestId("line-chart")).toHaveAttribute("data-height", "360");
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-width", "640");
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-height", "340");
  });
});
