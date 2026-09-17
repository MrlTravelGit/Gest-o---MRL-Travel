import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

import { deleteCardStatement, normalizeCardStatementOptions, normalizeCardStatements, saveCardStatement } from "./invoices";

describe("serviço de faturas", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("normaliza opções e listas ausentes", () => {
    expect(normalizeCardStatementOptions({ clients: null })).toEqual({ clients: [], institutions: [], cards: [], programs: [] });
    expect(normalizeCardStatements({ items: [] })).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it("salva a fatura sem tentar confirmar importação externa", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { statementId: "33a9943c-1117-4ce8-bcf3-fe643990758a", predictionStatus: "calculated", predictedPoints: 7273, estimatedPointsValue: 254.55, pointsDifference: null }, error: null });
    await saveCardStatement({ clientId: "50d9a9f0-f204-4a36-b675-c18cd7a8fcbe", financialInstitutionId: "51d9a9f0-f204-4a36-b675-c18cd7a8fcbe", accountPersonType: "PF", cardId: "52d9a9f0-f204-4a36-b675-c18cd7a8fcbe", statementMonth: "2026-09", totalAmount: 20000, loyaltyProgramId: "53d9a9f0-f204-4a36-b675-c18cd7a8fcbe", fxRate: 5.5, fxRateDate: "2026-09-16", operationId: "55d9a9f0-f204-4a36-b675-c18cd7a8fcbe" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("save_card_statement_v4", expect.any(Object));
  });

  it("usa soft delete por RPC", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { deleted: true }, error: null });
    await deleteCardStatement("33a9943c-1117-4ce8-bcf3-fe643990758a");
    expect(mocks.rpc).toHaveBeenCalledWith("delete_card_statement_v1", { p_statement_id: "33a9943c-1117-4ce8-bcf3-fe643990758a" });
  });
});
