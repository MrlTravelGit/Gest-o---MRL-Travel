import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import { ProgramsDashboardPanel } from "./ProgramsDashboardPanel";

const rows = [
  {
    program_key: "livelo", program_name: "Livelo", program_logo_url: "/assets/loyalty-programs/logo-livelo.svg",
    clients_count: 2, total_points: "150000", total_estimated_value: "3000", clients: [
      { clientId: "client-1", clientName: "Ana Lima", points: "100000", costPerThousand: "20", estimatedValue: "2000", nextExpirationDate: "2026-10-10", pointsExpiring90Days: "10000", lastUpdatedAt: "2026-09-20T12:00:00Z", clubActive: true, accountLinked: false },
      { clientId: "client-2", clientName: "Bruno Reis", points: "50000", costPerThousand: "20", estimatedValue: "1000", nextExpirationDate: null, pointsExpiring90Days: "0", lastUpdatedAt: null, clubActive: false, accountLinked: true },
    ],
  },
  {
    program_key: "smiles", program_name: "Smiles", program_logo_url: null,
    clients_count: 1, total_points: "70000", total_estimated_value: "1400", clients: [
      { clientId: "client-1", clientName: "Ana Lima", points: "70000", costPerThousand: "20", estimatedValue: "1400", nextExpirationDate: null, pointsExpiring90Days: "0", lastUpdatedAt: "2026-09-21T12:00:00Z", clubActive: false, accountLinked: false },
    ],
  },
];

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ProgramsDashboardPanel /></MemoryRouter></QueryClientProvider>);
}

describe("ProgramsDashboardPanel", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: rows, error: null });
  });

  it("consolida clientes únicos e abre o perfil pela rota administrativa", async () => {
    renderPanel();

    expect(await screen.findByText("220.000")).toBeInTheDocument();
    expect(screen.getByText("clientes únicos não arquivados").previousElementSibling).toHaveTextContent("2");
    expect(screen.getAllByRole("link", { name: /abrir cliente/i })[0]).toHaveAttribute("href", "/admin/clientes/client-1");
  });

  it("troca a lista ao selecionar outro programa", async () => {
    renderPanel();

    const smiles = await screen.findByRole("button", { name: /smiles/i });
    fireEvent.click(smiles);

    expect(smiles).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Smiles" })).toBeInTheDocument();
    expect(screen.getAllByText("70.000")).toHaveLength(3);
    expect(screen.queryByText("Bruno Reis")).not.toBeInTheDocument();
  });
});
