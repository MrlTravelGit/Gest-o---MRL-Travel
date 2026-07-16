import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { activeClients: 12, managedPoints: 200000, generatedSavings: 1800, expiringIn30Days: 10000, contractsEndingIn30Days: 2, openTasks: 3, openInterests: 4, transfersCount: 5, operatorName: "Marcos", role: "manager", canWrite: true, canArchive: true }, isLoading: false, isError: false }),
}));
vi.mock("@/components/effects/Aurora", () => ({ Aurora: () => <div data-testid="aurora" /> }));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/services/dashboard", () => ({ getAdminOverview: vi.fn() }));
import { AdminDashboardPage } from "./AdminDashboardPage";

describe("AdminDashboardPage", () => {
  it("renderiza Hero e exatamente os oito módulos sem ações falsas", () => {
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /gestão de milhas/i })).toBeInTheDocument();
    expect(screen.getByTestId("aurora")).toBeInTheDocument();
    const modules = screen.getByRole("region", { name: "Módulos de gestão" }).querySelectorAll("a.bento-card");
    expect(modules).toHaveLength(8);
    expect(screen.getByRole("link", { name: /clientes carteiras/i })).toHaveAttribute("href", "/admin/clientes");
    expect(screen.getByRole("link", { name: /formulários entrada/i })).toHaveAttribute("href", "/admin/formularios");
  });

  it("mantém os cards focáveis por teclado", () => {
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);
    const link = screen.getByRole("link", { name: /transferência mova/i });
    link.focus();
    fireEvent.keyDown(link, { key: "Enter" });
    expect(link).toHaveFocus();
  });
});
