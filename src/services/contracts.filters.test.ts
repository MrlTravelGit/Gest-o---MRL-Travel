import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    neq: vi.fn(),
    then: vi.fn(),
  };
  const from = vi.fn();
  return { query, from };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { from: mocks.from },
}));

import { listClientContracts } from "@/services/contracts";

describe("filtros do histórico de contratos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue(mocks.query);
    mocks.query.select.mockReturnValue(mocks.query);
    mocks.query.order.mockReturnValue(mocks.query);
    mocks.query.eq.mockReturnValue(mocks.query);
    mocks.query.is.mockReturnValue(mocks.query);
    mocks.query.not.mockReturnValue(mocks.query);
    mocks.query.in.mockReturnValue(mocks.query);
    mocks.query.or.mockReturnValue(mocks.query);
    mocks.query.neq.mockReturnValue(mocks.query);
    mocks.query.then.mockImplementation((resolve) => Promise.resolve(resolve({ data: [], error: null })));
  });

  it("carrega ativos usando somente archived_at IS NULL", async () => {
    await listClientContracts({ filter: "active" });

    expect(mocks.query.select).toHaveBeenCalledWith("*");
    expect(mocks.query.order).not.toHaveBeenCalled();
    expect(mocks.query.is).toHaveBeenCalledWith("archived_at", null);
    expect(mocks.query.neq).not.toHaveBeenCalled();
    expect(mocks.query.or).not.toHaveBeenCalled();
  });

  it("carrega arquivados usando somente archived_at IS NOT NULL", async () => {
    await listClientContracts({ filter: "archived" });

    expect(mocks.query.select).toHaveBeenCalledWith("*");
    expect(mocks.query.order).not.toHaveBeenCalled();
    expect(mocks.query.not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(mocks.query.neq).not.toHaveBeenCalled();
    expect(mocks.query.or).not.toHaveBeenCalled();
  });

  it("não adiciona filtro de arquivamento na aba todos", async () => {
    await listClientContracts({ filter: "all" });

    expect(mocks.query.select).toHaveBeenCalledWith("*");
    expect(mocks.query.order).not.toHaveBeenCalled();
    expect(mocks.query.is).not.toHaveBeenCalled();
    expect(mocks.query.not).not.toHaveBeenCalled();
    expect(mocks.query.neq).not.toHaveBeenCalled();
    expect(mocks.query.or).not.toHaveBeenCalled();
  });

  it("mantém os contratos visíveis quando a consulta de assinaturas falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.query.then
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [{
        id: "contract-1", client_id: "client-1", client_name: "Cliente", contract_value: 1000,
        installments: 1, installment_value: 1000, signature_city: "POMPÉU", contract_date: "2026-10-07",
        include_cashback: false, cashback_percent: 0, include_roi_guarantee: false,
        include_courtesy_ticket: false, archived_at: null, created_at: "2026-10-07T12:00:00Z",
        updated_at: "2026-10-07T12:00:00Z", pdf_path: null,
      }], error: null })))
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: null, error: { message: "schema mismatch" } })));

    const result = await listClientContracts({ clientId: "client-1", filter: "active" });

    expect(result).toHaveLength(1);
    expect(result[0].signaturesLoadError).toBe(true);
    expect(result[0].signatureRequest).toBeNull();
    expect(consoleError).toHaveBeenCalledWith("Falha ao carregar assinaturas do histórico de contratos:", { message: "schema mismatch" });
    consoleError.mockRestore();
  });
});
