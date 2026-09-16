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
  installments: 4,
  installmentValue: 1_250,
  signatureCity: "POMPÉU",
  contractDate: "2026-09-16",
  includeCashback: false,
  cashbackPercent: 2,
  includeRoiGuarantee: false,
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

  it("acrescenta cashback, garantia ou ambos com numeração contínua", () => {
    expect(buildContractClauses(draft({ includeCashback: true }))).toHaveLength(9);
    expect(buildContractClauses(draft({ includeRoiGuarantee: true }))).toHaveLength(9);
    const both = buildContractClauses(draft({ includeCashback: true, includeRoiGuarantee: true }));
    expect(both).toHaveLength(10);
    expect(both.map((clause) => clause.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("bloqueia contrato sem nome ou sem valor", () => {
    expect(validateContractDraft(draft({ clientName: "" }))).toMatch(/nome/i);
    expect(validateContractDraft(draft({ contractValue: 0 }))).toMatch(/valor/i);
    expect(validateContractDraft(draft())).toBeNull();
  });
});
