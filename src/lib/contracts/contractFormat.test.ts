import { describe, expect, it } from "vitest";
import { buildContractClauses } from "./contractText";
import { calculateInstallment, formatContractCurrency, validateContractDraft } from "./contractFormat";
import type { ContractDraft } from "@/types/contracts";

const draft = (overrides: Partial<ContractDraft> = {}): ContractDraft => ({
  clientId: "client-1",
  clientName: "Cliente Teste",
  cpf: "",
  rg: "",
  email: "",
  maritalStatus: "",
  profession: "",
  fullAddress: "",
  contractValue: 5_000,
  paymentMode: "calculated",
  installments: 4,
  installmentValue: 1_250,
  signatureCity: "POMPÉU",
  contractDate: "2026-09-16",
  includeCashback: false,
  cashbackPercent: 2,
  includeRoiGuarantee: false,
  includeCourtesyTicket: false,
  ...overrides,
});

describe("contratos", () => {
  it("calcula o valor da parcela", () => {
    expect(calculateInstallment(5_000, 4)).toBe(1_250);
    expect(calculateInstallment(100, 3)).toBe(33.33);
  });

  it("formata moeda brasileira", () => {
    expect(formatContractCurrency(3130.68)).toBe("3.130,68");
  });

  it("mantém oito cláusulas sem opcionais", () => {
    expect(buildContractClauses(draft())).toHaveLength(8);
  });

  it("usa o texto de até 12x com taxas sem exibir valor de parcela", () => {
    const payment = buildContractClauses(draft({ paymentMode: "up_to_12_with_fees", installmentValue: 166.67 }))[1].blocks[0].text;
    expect(payment).toBe("A CONTRATANTE pagará à CONTRATADA o valor de R$ 5.000,00, por meio de Pix ou cartão de crédito, em até 12 (doze) parcelas acrescidas de taxas no link de pagamento.");
    expect(payment).not.toContain("166,67");
  });

  it("mantém o texto de parcela calculada disponível", () => {
    const payment = buildContractClauses(draft({ contractValue: 2_000, installments: 1, installmentValue: 2_000 }))[1].blocks[0].text;
    expect(payment).toContain("em parcelas até 1 (um) vezes de R$ 2.000,00 via link de pagamento.");
  });

  it("acrescenta cashback, garantia ou ambos com numeração contínua", () => {
    expect(buildContractClauses(draft({ includeCashback: true }))).toHaveLength(9);
    expect(buildContractClauses(draft({ includeRoiGuarantee: true }))).toHaveLength(9);
    const both = buildContractClauses(draft({ includeCashback: true, includeRoiGuarantee: true }));
    expect(both).toHaveLength(10);
    expect(both.map((clause) => clause.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("inclui a passagem cortesia somente quando marcada", () => {
    const withoutTicket = buildContractClauses(draft())[0].blocks.map((block) => block.text).join(" ");
    const withTicket = buildContractClauses(draft({ includeCourtesyTicket: true }))[0].blocks.map((block) => block.text).join(" ");
    expect(withoutTicket).not.toMatch(/Passagem cortesia/);
    expect(withTicket).toContain("1 Passagem cortesia para qualquer destino do Brasil IDA e VOLTA");
  });

  it("bloqueia contrato sem nome ou sem valor", () => {
    expect(validateContractDraft(draft({ clientName: "" }))).toMatch(/nome/i);
    expect(validateContractDraft(draft({ contractValue: 0 }))).toMatch(/valor/i);
    expect(validateContractDraft(draft())).toBeNull();
  });
});
