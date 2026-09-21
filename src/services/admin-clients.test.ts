import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import { deleteTestClientsStartingWithZ, getAdminClients } from "./admin-clients";

describe("getAdminClients", () => {
  beforeEach(() => rpc.mockReset());

  it("envia o contrato de quatro parametros esperado pelo PostgREST", async () => {
    rpc.mockResolvedValueOnce({
      data: { items: [], total: 0, limit: 20, offset: 0 },
      error: null,
    });

    await getAdminClients("ana", "active", 20, 40);

    expect(rpc).toHaveBeenCalledWith("get_admin_clients", {
      p_limit: 20,
      p_offset: 40,
      p_search: "ana",
      p_status: "active",
    });
  });

  it("usa all como status canonico quando nao ha filtro", async () => {
    rpc.mockResolvedValueOnce({
      data: { items: [], total: 1, limit: 50, offset: 0 },
      error: null,
    });

    await expect(getAdminClients("", "", 20, 0)).resolves.toMatchObject({ total: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_admin_clients", {
      p_limit: 20,
      p_offset: 0,
      p_search: "",
      p_status: "all",
    });
  });

  it("oculta defensivamente cadastros de teste iniciados por Z", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        items: [
          { id: "1", fullName: "  zzz", status: "ended" },
          { id: "2", fullName: "Letícia Tôrres de Souza", status: "active" },
        ],
        total: 2,
        limit: 20,
        offset: 0,
        counts: { all: 2, active: 1, leads: 0, archived: 1, contractPending: 0, cashbackEnabled: 0 },
      },
      error: null,
    });

    const result = await getAdminClients();

    expect(result.items.map((client) => client.fullName)).toEqual(["Letícia Tôrres de Souza"]);
    expect(result.total).toBe(1);
    expect(result.counts?.all).toBe(1);
  });
});

describe("deleteTestClientsStartingWithZ", () => {
  beforeEach(() => rpc.mockReset());

  it("chama a RPC protegida e devolve o relatório", async () => {
    rpc.mockResolvedValueOnce({ data: { deleted: 2, skipped: 1, errors: [] }, error: null });
    await expect(deleteTestClientsStartingWithZ()).resolves.toEqual({ deleted: 2, skipped: 1, errors: [] });
    expect(rpc).toHaveBeenCalledWith("admin_delete_test_clients_starting_with_z");
  });
});
