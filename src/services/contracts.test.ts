import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

import { supabase } from "@/lib/supabase";
import { createClientContract } from "./contracts";

const invoke = vi.mocked(supabase.functions.invoke);

describe("geração de contrato no servidor", () => {
  beforeEach(() => invoke.mockReset());

  it("envia os dados à Edge Function e usa somente a URL assinada", async () => {
    invoke.mockResolvedValue({ data: { contract_id: "2af187c1-a45e-4587-88f1-5d8d87872698", pdf_path: "client/contract.pdf", signed_url: "https://signed.example/contract" }, error: null } as never);
    const result = await createClientContract({
      clientId: "3af187c1-a45e-4587-88f1-5d8d87872698", clientName: "Cliente Teste", cpf: "", rg: "", email: "cliente@example.com",
      maritalStatus: "", profession: "", fullAddress: "", contractValue: 2000, installments: 2, installmentValue: 1000,
      signatureCity: "POMPÉU", contractDate: "2026-09-16", includeCashback: true, cashbackPercent: 2, includeRoiGuarantee: false, includeCourtesyTicket: true,
    });
    expect(invoke).toHaveBeenCalledWith("generate-client-contract", expect.objectContaining({ body: expect.objectContaining({ client_id: "3af187c1-a45e-4587-88f1-5d8d87872698", contract_data: expect.objectContaining({ nome: "Cliente Teste", valor_total: 2000, incluir_cashback: true, include_courtesy_ticket: true }) }) }));
    expect(result.signedUrl).toBe("https://signed.example/contract");
  });
});
