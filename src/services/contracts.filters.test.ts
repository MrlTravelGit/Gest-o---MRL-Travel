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
    expect(mocks.query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mocks.query.is).toHaveBeenCalledWith("archived_at", null);
    expect(mocks.query.neq).not.toHaveBeenCalled();
    expect(mocks.query.or).not.toHaveBeenCalled();
  });

  it("carrega arquivados usando somente archived_at IS NOT NULL", async () => {
    await listClientContracts({ filter: "archived" });

    expect(mocks.query.select).toHaveBeenCalledWith("*");
    expect(mocks.query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mocks.query.not).toHaveBeenCalledWith("archived_at", "is", null);
    expect(mocks.query.neq).not.toHaveBeenCalled();
    expect(mocks.query.or).not.toHaveBeenCalled();
  });

  it("não adiciona filtro de arquivamento na aba todos", async () => {
    await listClientContracts({ filter: "all" });

    expect(mocks.query.select).toHaveBeenCalledWith("*");
    expect(mocks.query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mocks.query.is).not.toHaveBeenCalled();
    expect(mocks.query.not).not.toHaveBeenCalled();
    expect(mocks.query.neq).not.toHaveBeenCalled();
    expect(mocks.query.or).not.toHaveBeenCalled();
  });
});
