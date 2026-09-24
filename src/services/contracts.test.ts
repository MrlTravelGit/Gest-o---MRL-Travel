import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

vi.mock("@/services/contracts", async () => {
  const actual = await vi.importActual<typeof import("./contracts")>("./contracts");
  return {
    ...actual,
    listClientContracts: vi.fn(),
    archiveClientContract: vi.fn(),
    downloadStoredContract: vi.fn(),
    sendContractToAutentique: vi.fn(),
    syncAutentiqueDocument: vi.fn(),
  };
});

import { ClientContractsPanel } from "@/components/admin/ClientContractsPanel";
import { supabase } from "@/lib/supabase";
import { listClientContracts, sendContractToAutentique } from "@/services/contracts";
import { createClientContract } from "./contracts";

const invoke = vi.mocked(supabase.functions.invoke);
const listContractsMock = vi.mocked(listClientContracts);
const sendAutentiqueMock = vi.mocked(sendContractToAutentique);

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

describe("painel de contratos", () => {
  beforeEach(() => {
    listContractsMock.mockReset();
    sendAutentiqueMock.mockReset();
    listContractsMock.mockResolvedValue([
      {
        id: "e9066ed5-2d7e-42a0-8f41-cbb5ca2d9a32",
        clientId: "3af187c1-a45e-4587-88f1-5d8d87872698",
        contractNumber: "MRL-2026-001",
        clientName: "Cliente Teste",
        cpf: "12345678909",
        rg: "1234567",
        email: "cliente@example.com",
        maritalStatus: "solteiro",
        profession: "Analista",
        fullAddress: "Rua Teste, 123",
        contractValue: 3000,
        installments: 1,
        installmentValue: 3000,
        signatureCity: "POMPÉU",
        contractDate: "2026-09-16",
        includeCashback: false,
        cashbackPercent: 0,
        includeRoiGuarantee: false,
        includeCourtesyTicket: false,
        status: "generated",
        pdfPath: "contracts/test.pdf",
        createdAt: "2026-09-16T00:00:00Z",
        updatedAt: "2026-09-16T00:00:00Z",
        archivedAt: null,
        signatureRequest: null,
      },
    ]);
  });

  it("exibe o botão de envio para assinatura quando o contrato ainda não foi enviado", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(createElement(QueryClientProvider, { client: queryClient },
      createElement(MemoryRouter, null,
        createElement(ClientContractsPanel, { clientId: "3af187c1-a45e-4587-88f1-5d8d87872698", canManageSignatures: true }),
      ),
    ));

    expect(await screen.findByText("Enviar para assinatura")).toBeInTheDocument();
  });

  it("oculta o envio para perfis sem permissão de gestão", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(createElement(QueryClientProvider, { client: queryClient },
      createElement(MemoryRouter, null,
        createElement(ClientContractsPanel, { clientId: "3af187c1-a45e-4587-88f1-5d8d87872698" }),
      ),
    ));

    expect(await screen.findByText("Cliente Teste")).toBeInTheDocument();
    expect(screen.queryByText("Enviar para assinatura")).not.toBeInTheDocument();
  });
});
