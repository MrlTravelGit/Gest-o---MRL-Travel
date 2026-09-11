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

function cashback(availableBalance: number, enabled = true): NonNullable<PublicClientDashboard["cashback"]> {
  return {
    enabled,
    availableBalance,
    notice: null,
    summary: { generated: availableBalance, used: 0, reversed: 0, adjusted: 0, available: availableBalance },
    transactions: [],
  };
}

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

  it("mostra somente o contrato público dos interesses e não renderiza observação interna", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, travelInterests: [{ id:"interest-1", destination:"Porto de Galinhas", startDate:"2026-12-08", endDate:"2026-12-12", status:"in_progress", statusLabel:"Em andamento", publicNote:"Estamos avaliando as melhores opções.", updatedAt:"2026-08-10T12:00:00Z", internalNote:"NÃO PODE APARECER" } as never] }} />);
    expect(screen.getByRole("heading", { name:"Meus interesses" })).toBeInTheDocument();
    expect(screen.getByText("Porto de Galinhas")).toBeInTheDocument();
    expect(screen.getByText("Estamos avaliando as melhores opções.")).toBeInTheDocument();
    expect(screen.queryByText("NÃO PODE APARECER")).not.toBeInTheDocument();
  });

  it("programa desconhecido usa fallback elegante e não quebra", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, programs: [{ ...dashboard.programs[0], slug: "xpto", name: "Programa X" }] }} />);

    expect(screen.getByLabelText("Logo indisponível para Programa X")).toBeInTheDocument();
    expect(screen.getByText("PX")).toBeInTheDocument();
  });

  it("oculta programa sem relação e mostra o estado vazio orientativo", () => {
    const zeroBalanceProgram = { ...dashboard.programs[0], slug: "nubank-croma", name: "Nubank Croma", balance: 0, averageCostPerThousand: 0, estimatedValue: 0, capturedAt: null, expiringPoints: 0, catalogActive: true, hasMovements: false };
    render(<ClientDashboardView dashboard={{ ...dashboard, programs: [zeroBalanceProgram] }} />);
    expect(screen.queryByRole("heading", { name: "Nubank Croma" })).not.toBeInTheDocument();
    expect(screen.getByText("Nenhum programa vinculado ainda.")).toBeInTheDocument();
    expect(screen.getByText("Use Lançar pontos ou ative um clube para adicionar este cliente a um programa.")).toBeInTheDocument();
  });

  it("mantém programa com clube ativo mesmo quando o saldo está zerado", () => {
    const clubProgram = { ...dashboard.programs[0], slug: "azul_fidelidade", name: "Azul Fidelidade", balance: 0, clubActive: true };
    render(<ClientDashboardView dashboard={{ ...dashboard, programs: [clubProgram] }} />);
    expect(screen.getByRole("heading", { name: "Azul Fidelidade" })).toBeInTheDocument();
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

  it("exibe somente o histórico de economias recebido no payload isolado do cliente", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, savingsHistory: [{ id: "saving-1", date: "2025-07-18", description: "Emissão CNF - VIX", originalValue: 2723.32, paidValue: 1029.32, savingsValue: 1694, travelType: "flight", migrated: true, cashbackPercentage: null, cashbackAmount: 0, cashbackBaseType: null, cashbackBaseAmount: null, cashbackCalculationVersion: null, hasEvidence: false }] }} />);
    expect(screen.getByRole("heading", { name: "Histórico de Economias" })).toBeInTheDocument();
    expect(screen.getByText("Emissão CNF - VIX")).toBeInTheDocument();
    expect(screen.getByText("Histórico migrado")).toBeInTheDocument();
    expect(screen.getByText("R$ 1.694,00")).toBeInTheDocument();
  });

  it("apresenta cashback como percentual do valor pago, separado da economia", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, cashback: cashback(34.14), savingsHistory: [{ id: "rafael", date: "2026-07-23", description: "Reserva Rafael Weck", originalValue: 1884.04, paidValue: 1706.90, savingsValue: 177.14, travelType: "flight", migrated: false, cashbackPercentage: 2, cashbackAmount: 34.14, cashbackBaseType: "paid_amount", cashbackBaseAmount: 1706.90, cashbackCalculationVersion: "paid_amount_v1", hasEvidence: false }] }} />);
    expect(screen.getByText("R$ 177,14")).toBeInTheDocument();
    expect(screen.getByText("Cashback de 2% sobre R$ 1.706,90")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 34,14").length).toBeGreaterThanOrEqual(2);
  });
  it("mostra a etiqueta de cashback positivo somente abaixo do valor de Economia", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, cashback: cashback(34.14) }} />);

    const badge = screen.getByLabelText("Cashback: R$ 34,14");
    const economyCard = screen.getByText("Economia").closest("article");

    expect(badge).toHaveClass("summary-cashback-badge");
    expect(economyCard).toContainElement(badge);
    expect(economyCard).toHaveTextContent("R$ 940,00");
    expect(badge.previousElementSibling).toHaveTextContent("R$ 940,00");
    expect(screen.getByLabelText("Resumo do painel").querySelectorAll(".summary-cashback-badge")).toHaveLength(1);
  });

  it("mantem a etiqueta visivel com saldo zero quando o cashback esta habilitado", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, cashback: cashback(0) }} />);

    expect(screen.getByLabelText("Cashback: R$ 0,00")).toBeInTheDocument();
  });

  it("nao reserva espaco nem exibe cashback quando esta desabilitado", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, cashback: cashback(34.14, false) }} />);

    expect(screen.queryByLabelText(/Cashback:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cashback MRL Travel" })).not.toBeInTheDocument();
  });

  it.each([
    ["ausente", undefined],
    ["nulo", null],
  ])("nao exibe etiqueta com cashback %s e preserva os graficos", (_scenario, value) => {
    render(<ClientDashboardView dashboard={{ ...dashboard, cashback: value }} />);

    expect(screen.queryByLabelText(/Cashback:/)).not.toBeInTheDocument();
    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("mantem quatro KPIs e estrutura compacta compativel com 320px", () => {
    render(<ClientDashboardView dashboard={{ ...dashboard, cashback: cashback(123456.78) }} />);

    const summary = screen.getByLabelText("Resumo do painel");
    const badge = screen.getByLabelText("Cashback: R$ 123.456,78");

    expect(summary.children).toHaveLength(4);
    expect(badge).toHaveClass("summary-cashback-badge");
    expect(badge).toHaveTextContent("CashbackR$ 123.456,78");
  });
});
