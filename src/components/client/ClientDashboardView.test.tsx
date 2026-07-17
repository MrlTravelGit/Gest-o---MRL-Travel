import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClientDashboardView } from "./ClientDashboardView";
import type { PublicClientDashboard } from "@/types/dashboard";

const lineChartSpy = vi.fn();
const barChartSpy = vi.fn();

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => {
    lineChartSpy(data);
    return <div data-testid="line-chart">{children}</div>;
  },
  BarChart: ({ children, data }: { children: ReactNode; data: unknown[] }) => {
    barChartSpy(data);
    return <div data-testid="bar-chart">{children}</div>;
  },
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Line: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  LabelList: () => null,
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
    expect(screen.getByText("MRL Travel")).toBeInTheDocument();
  });

  it("resolve logo local para programa conhecido e usa fallback quando o asset está ausente", () => {
    render(<ClientDashboardView dashboard={dashboard} />);

    const atomosLogo = screen.getByAltText("Logo Átomos");
    expect(atomosLogo).toHaveAttribute("src", "/assets/loyalty-programs/atomos.svg");

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
      { month: "2026-06-01", balance: 16000, averageCostPerThousand: 17.8 },
      { month: "2026-07-01", balance: 18500, averageCostPerThousand: 18.2 },
    ]);
    expect(barChartSpy).toHaveBeenCalledWith([
      { month: "2026-06-01", points: 1000 },
      { month: "2026-07-01", points: 2500 },
    ]);
    expect(balanceHistory).toEqual(originalBalance);
    expect(monthlyMovements).toEqual(originalMovements);
  });
});
