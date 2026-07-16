import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc },
}));

import { getAdminClients } from "./admin-clients";

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

  it("faz fallback para a assinatura antiga quando nao ha filtro de status", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "schema cache" } })
      .mockResolvedValueOnce({ data: { items: [], total: 1, limit: 20, offset: 0 }, error: null });

    await expect(getAdminClients("", "", 20, 0)).resolves.toMatchObject({ total: 1 });
    expect(rpc).toHaveBeenLastCalledWith("get_admin_clients", {
      p_search: null,
      p_limit: 20,
      p_offset: 0,
    });
  });
});
