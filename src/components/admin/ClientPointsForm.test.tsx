import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminProgramDetail } from "@/types/admin-clients";

const { recordPointEntry } = vi.hoisted(() => ({ recordPointEntry: vi.fn() }));
vi.mock("@/services/admin-clients", () => ({ recordPointEntry }));

import { ClientPointsForm } from "./ClientPointsForm";

const program: AdminProgramDetail = {
  programId: "program-1",
  slug: "smiles",
  name: "Smiles",
  logoUrl: null,
  accountId: "account-1",
  balance: 100_000,
  averageCostPerThousand: 15,
  estimatedValue: 1_800,
  marketValuePerThousand: 18,
  clubActive: false,
  clubUpdatedAt: null,
  expiringPoints: 0,
  nextExpirationDate: null,
  lastUpdatedAt: null,
};

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ClientPointsForm clientId="client-1" publicId="public-1" clientName="Cliente Teste" programs={[program]} canWrite /></QueryClientProvider>);
}

describe("ClientPointsForm", () => {
  beforeEach(() => recordPointEntry.mockReset());

  it("calcula VT e VM ao trocar o modo", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Programa"), { target: { value: "program-1" } });
    fireEvent.change(screen.getByLabelText("Pontos ou milhas"), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText("Valor Total"), { target: { value: "40000" } });
    expect(screen.getByLabelText("Valor do Milheiro")).toHaveValue("R$ 20,00");

    fireEvent.click(screen.getByRole("button", { name: /VM/ }));
    fireEvent.change(screen.getByLabelText("Valor do Milheiro"), { target: { value: "2000" } });
    expect(screen.getByLabelText("Valor Total")).toHaveValue("R$ 400,00");
  });

  it("valida quantidade e não chama o backend", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Programa"), { target: { value: "program-1" } });
    fireEvent.submit(screen.getByRole("button", { name: "Salvar lançamento" }).closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Informe uma quantidade maior que zero.");
    expect(recordPointEntry).not.toHaveBeenCalled();
  });
});
