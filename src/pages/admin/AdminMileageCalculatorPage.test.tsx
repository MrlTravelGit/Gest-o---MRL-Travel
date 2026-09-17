import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { loadMileageCalculatorAuxiliaryData, mileageProgramFallback } from "@/services/mileage-calculator";
import { AdminMileageCalculatorPage } from "./AdminMileageCalculatorPage";

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/admin/AdminPage", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/services/mileage-calculator", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/mileage-calculator")>();
  return {
    ...original,
    loadMileageCalculatorAuxiliaryData: vi.fn(),
    saveMileageSimulation: vi.fn(),
  };
});

describe("AdminMileageCalculatorPage", () => {
  const unavailableAuxiliaryData = {
    programs: mileageProgramFallback,
    clients: [],
    simulations: [],
    canWrite: false,
    storageAvailable: false,
    usingProgramFallback: true,
    warnings: ["programs", "clients", "simulations"] as Array<"programs" | "clients" | "simulations">,
  };

  it("calcula sem cliente e continua renderizada quando auxiliares falham", async () => {
    vi.mocked(loadMileageCalculatorAuxiliaryData).mockResolvedValueOnce(unavailableAuxiliaryData);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MemoryRouter><AdminMileageCalculatorPage /></MemoryRouter></QueryClientProvider>);

    expect(screen.getByRole("heading", { name: "Calculadora de Milheiro" })).toBeInTheDocument();
    expect(await screen.findByText("Não foi possível carregar dados auxiliares, mas a calculadora continua disponível.")).toBeInTheDocument();
    expect(mileageProgramFallback).toHaveLength(11);

    fireEvent.change(screen.getByPlaceholderText("100.000"), { target: { value: "100000" } });
    fireEvent.change(screen.getByPlaceholderText("1.000"), { target: { value: "1000" } });
    fireEvent.change(screen.getByPlaceholderText("R$ 3.130,68"), { target: { value: "3130,68" } });
    fireEvent.change(screen.getByPlaceholderText("80"), { target: { value: "80" } });

    expect(await screen.findByText("R$ 17,57")).toBeInTheDocument();
    expect(screen.getByText("99.000")).toBeInTheDocument();
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.getByText("R$ 31,62")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salvar simulação/ })).toBeDisabled();
    expect(screen.getByText("Salvamento disponível após atualização do banco.")).toBeInTheDocument();
  });

  it("mantém programas oficiais e habilita o salvamento quando a migration está disponível", async () => {
    const officialPrograms = [
      { ...mileageProgramFallback[0], id: "11111111-1111-4111-8111-111111111111", isTransferTarget: false },
      { ...mileageProgramFallback.find((program) => program.slug === "smiles")!, id: "22222222-2222-4222-8222-222222222222" },
    ];
    vi.mocked(loadMileageCalculatorAuxiliaryData).mockResolvedValueOnce({
      programs: officialPrograms,
      clients: [],
      simulations: [],
      canWrite: true,
      storageAvailable: true,
      usingProgramFallback: false,
      warnings: [],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MemoryRouter><AdminMileageCalculatorPage /></MemoryRouter></QueryClientProvider>);

    fireEvent.change(await screen.findByLabelText("Programa de origem"), { target: { value: officialPrograms[0].id } });
    fireEvent.change(screen.getByLabelText("Programa de destino"), { target: { value: officialPrograms[1].id } });
    fireEvent.change(screen.getByPlaceholderText("100.000"), { target: { value: "100000" } });
    fireEvent.change(screen.getByPlaceholderText("1.000"), { target: { value: "1000" } });
    fireEvent.change(screen.getByPlaceholderText("R$ 3.130,68"), { target: { value: "R$ 3.130,68" } });
    fireEvent.change(screen.getByPlaceholderText("80"), { target: { value: "80" } });

    expect(await screen.findByText("R$ 17,57")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salvar simulação/ })).toBeEnabled();
    expect(screen.queryByText("Salvamento disponível após atualização do banco.")).not.toBeInTheDocument();
  });
});
