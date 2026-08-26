import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

describe("integração das vigências", () => {
  beforeEach(() => { rpc.mockReset(); vi.resetModules(); });

  it("envia exatamente os 17 parâmetros canônicos", async () => {
    rpc.mockResolvedValue({ data: { summary: { active: 0, expiring: 0, ended: 0, noTerm: 0, totalSavings: 0, totalCashback: 0 }, items: [], total: 0, limit: 25, offset: 0, canVaultAccess: false }, error: null });
    const { getManagementTerms, MANAGEMENT_TERMS_RPC_ARGUMENTS } = await import("./management-terms");
    await getManagementTerms({ search: "Ana", cashbackMin: 10, limit: 25, offset: 0 });
    expect(Object.keys(rpc.mock.calls[0][1])).toEqual(MANAGEMENT_TERMS_RPC_ARGUMENTS);
    expect(rpc).toHaveBeenCalledWith("get_client_management_terms_v1", expect.objectContaining({ p_search: "Ana", p_cashback_min: 10, p_term_status: "all" }));
  });

  it("normaliza listas ausentes da RPC", async () => {
    rpc.mockResolvedValue({ data: { total: 0 }, error: null });
    const { getManagementTerms } = await import("./management-terms");
    const result = await getManagementTerms({ limit: 25, offset: 0 });
    expect(result.items).toEqual([]);
    expect(result.summary.totalSavings).toBe(0);
  });

  it("não expõe detalhes técnicos quando a função não está no cache", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.get_client_management_terms_v1(...) in the schema cache" } });
    const { getManagementTerms } = await import("./management-terms");
    await expect(getManagementTerms({})).rejects.toMatchObject({ kind: "unavailable", message: "O painel de vigências está temporariamente indisponível. Tente novamente em instantes." });
  });

  it("traduz bloqueio de autorização sem vazar o erro do banco", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "FORBIDDEN" } });
    const { getManagementTerms } = await import("./management-terms");
    await expect(getManagementTerms({})).rejects.toMatchObject({ kind: "forbidden", message: "Você não possui permissão administrativa para acessar este painel." });
  });

  it("abre o cofre somente com client_id", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://mrlvault.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value_long_enough");
    vi.stubEnv("VITE_LOCAL_VAULT_URL", "http://192.168.0.25:7443");
    const { buildVaultClientUrl } = await import("./management-terms");
    const built = buildVaultClientUrl("123e4567-e89b-12d3-a456-426614174000");
    expect(built).not.toBeNull();
    const url = new URL(built!);
    expect(url.origin).toBe("http://192.168.0.25:7443");
    expect(url.pathname).toBe("/clients/123e4567-e89b-12d3-a456-426614174000");
    expect(url.search).toBe("");
  });
});
