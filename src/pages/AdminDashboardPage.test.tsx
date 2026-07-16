import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      activeClients: 12,
      managedPoints: 200000,
      generatedSavings: 1800,
      expiringIn30Days: 10000,
      contractsEndingIn30Days: 2,
      openTasks: 3,
      openInterests: 4,
      transfersCount: 5,
      operatorName: "Marcos",
      role: "manager",
      canWrite: true,
      canArchive: true,
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/components/effects/Aurora", () => ({ Aurora: () => <div data-testid="aurora" /> }));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/services/dashboard", () => ({ getAdminOverview: vi.fn() }));

import { AdminDashboardPage } from "./AdminDashboardPage";

describe("AdminDashboardPage", () => {
  it("mantém o hero como visão geral e não renderiza o bento de navegação", () => {
    render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: /gestão de milhas/i })).toBeInTheDocument();
    expect(screen.getByTestId("aurora")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /módulos de gestão/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll("a.bento-card")).toHaveLength(0);
  });
});
