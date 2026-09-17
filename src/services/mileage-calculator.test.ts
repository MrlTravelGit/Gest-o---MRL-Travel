import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

import { loadMileageCalculatorAuxiliaryData } from "./mileage-calculator";

describe("dados auxiliares da calculadora de milheiro", () => {
  beforeEach(() => {
    rpc.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("mantém a calculadora disponível com fallback quando todos os RPCs falham", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("relation does not exist") });

    const result = await loadMileageCalculatorAuxiliaryData();

    expect(result.programs.map((program) => program.name)).toEqual([
      "Livelo", "Esfera", "Átomos", "Coopera", "COOPERA PJ", "Nubank", "PicPay", "Revolut", "Smiles", "Azul Fidelidade", "LATAM Pass",
    ]);
    expect(result.clients).toEqual([]);
    expect(result.simulations).toEqual([]);
    expect(result.storageAvailable).toBe(false);
    expect(result.canWrite).toBe(false);
    expect(result.warnings).toEqual(["programs", "clients", "simulations"]);
  });

  it("preserva fontes que carregaram quando apenas o histórico falha", async () => {
    rpc
      .mockResolvedValueOnce({ data: { programs: [{ id: "program-1", name: "Programa oficial" }] }, error: null })
      .mockResolvedValueOnce({ data: { clients: [{ clientId: "client-1", fullName: "Cliente" }] }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error("function does not exist") });

    const result = await loadMileageCalculatorAuxiliaryData();

    expect(result.programs[0]?.name).toBe("Programa oficial");
    expect(result.clients).toEqual([{ clientId: "client-1", fullName: "Cliente" }]);
    expect(result.simulations).toEqual([]);
    expect(result.storageAvailable).toBe(false);
    expect(result.warnings).toEqual(["simulations"]);
  });

  it("não usa o fallback quando o banco responde com catálogo vazio", async () => {
    rpc
      .mockResolvedValueOnce({ data: { programs: [] }, error: null })
      .mockResolvedValueOnce({ data: { clients: [] }, error: null })
      .mockResolvedValueOnce({ data: { canWrite: true, simulations: [] }, error: null });

    const result = await loadMileageCalculatorAuxiliaryData();

    expect(result.programs).toEqual([]);
    expect(result.usingProgramFallback).toBe(false);
    expect(result.storageAvailable).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
