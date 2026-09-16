import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc, storage: { from: vi.fn(() => ({ upload: mocks.upload })) }, functions: { invoke: mocks.invoke } },
}));

import { extractInvoiceFromPrint, normalizeCardStatementOptions, normalizeCardStatements, saveCardStatement } from "./invoices";

describe("normalização das respostas de faturas", () => {
  beforeEach(() => { mocks.rpc.mockReset(); mocks.upload.mockReset(); mocks.invoke.mockReset(); });
  it("aceita o contrato esperado das opções", () => {
    expect(normalizeCardStatementOptions({ clients: [], institutions: [], cards: [], programs: [] })).toEqual({ clients: [], institutions: [], cards: [], programs: [] });
  });

  it("normaliza listas ausentes antes que a tela execute map ou find", () => {
    expect(normalizeCardStatementOptions({ clients: null })).toEqual({ clients: [], institutions: [], cards: [], programs: [] });
  });

  it("aceita uma lista vazia e completa os metadados ausentes", () => {
    expect(normalizeCardStatements({ items: [] })).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it("normaliza uma resposta sem items antes que a tela acesse length", () => {
    expect(normalizeCardStatements({ total: 0 })).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it("envia o print ao bucket privado antes de chamar a extração", async () => {
    mocks.upload.mockResolvedValue({ data: { path: "ok" }, error: null });
    mocks.invoke.mockResolvedValue({ data: { attempt_id: "35fdbef6-19a0-49ee-a335-d3c15deba8ab", file_path: "invoice-uploads/client/import/original", extracted_data: { bank_name: "Banco", card_name: "Cartão", card_last_digits: "1234", competency_month: "2026-09", due_date: "", invoice_total: 2000, exchange_rate: 5.5, exchange_rate_date: "2026-09-01", loyalty_program_name: "Livelo", actual_received_points: null, confidence_score: 90, warnings: [] } }, error: null });
    const file = new File(["imagem"], "fatura.png", { type: "image/png" });

    await extractInvoiceFromPrint("50d9a9f0-f204-4a36-b675-c18cd7a8fcbe", file);

    expect(mocks.upload).toHaveBeenCalledWith(expect.stringMatching(/^50d9a9f0-f204-4a36-b675-c18cd7a8fcbe\/[0-9a-f-]+\/original$/), file, expect.objectContaining({ contentType: "image/png", upsert: false }));
    expect(mocks.invoke).toHaveBeenCalledWith("extract-invoice-from-print", { body: expect.objectContaining({ client_id: "50d9a9f0-f204-4a36-b675-c18cd7a8fcbe", file_path: expect.stringMatching(/^invoice-uploads\//) }) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("bloqueia formatos não permitidos antes do upload", async () => {
    await expect(extractInvoiceFromPrint("50d9a9f0-f204-4a36-b675-c18cd7a8fcbe", new File(["texto"], "fatura.txt", { type: "text/plain" }))).rejects.toThrow("PNG, JPG, JPEG ou PDF");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("confirma a tentativa somente depois que a fatura foi salva", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { statementId: "33a9943c-1117-4ce8-bcf3-fe643990758a", predictionStatus: "calculated", predictedPoints: 7273, estimatedPointsValue: 254.55, pointsDifference: null }, error: null });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });

    await saveCardStatement({ clientId: "50d9a9f0-f204-4a36-b675-c18cd7a8fcbe", financialInstitutionId: "51d9a9f0-f204-4a36-b675-c18cd7a8fcbe", accountPersonType: "PF", cardId: "52d9a9f0-f204-4a36-b675-c18cd7a8fcbe", statementMonth: "2026-09", totalAmount: 20000, loyaltyProgramId: "53d9a9f0-f204-4a36-b675-c18cd7a8fcbe", fxRate: 5.5, fxRateDate: "2026-09-16", importAttemptId: "54d9a9f0-f204-4a36-b675-c18cd7a8fcbe", operationId: "55d9a9f0-f204-4a36-b675-c18cd7a8fcbe" });

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "save_card_statement_v4", expect.any(Object));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "confirm_invoice_import_attempt", { p_attempt_id: "54d9a9f0-f204-4a36-b675-c18cd7a8fcbe", p_invoice_id: "33a9943c-1117-4ce8-bcf3-fe643990758a" });
  });
});
