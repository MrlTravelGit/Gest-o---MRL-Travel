import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

import { normalizeCardStatementOptions, normalizeCardStatements } from "./invoices";

describe("normalização das respostas de faturas", () => {
  it("aceita o contrato esperado das opções", () => {
    expect(normalizeCardStatementOptions({ clients: [], institutions: [], cards: [] })).toEqual({ clients: [], institutions: [], cards: [] });
  });

  it("normaliza listas ausentes antes que a tela execute map ou find", () => {
    expect(normalizeCardStatementOptions({ clients: null })).toEqual({ clients: [], institutions: [], cards: [] });
  });

  it("aceita uma lista vazia e completa os metadados ausentes", () => {
    expect(normalizeCardStatements({ items: [] })).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it("normaliza uma resposta sem items antes que a tela acesse length", () => {
    expect(normalizeCardStatements({ total: 0 })).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });
});
