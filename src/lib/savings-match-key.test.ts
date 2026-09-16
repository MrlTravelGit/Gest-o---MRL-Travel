import { describe, expect, it } from "vitest";
import { buildSavingsMatchKey, shouldHideSavingInsteadOfDeleting } from "./savings-match-key";

describe("buildSavingsMatchKey", () => {
  it("normaliza acentos, espaços, data e valores quando não há id de origem", () => {
    expect(buildSavingsMatchKey({
      clientId: "CLIENT-ID",
      source: " Migrated ",
      title: " Emissão de Passagem Aérea (CNF - GRU) - Fábio R$260,13 (TAXA DE EMBARQUE) ",
      launchedOn: "2026-01-08T12:00:00Z",
      originalAmount: 2206.97,
      paidAmount: 260.13,
      savedAmount: 1946.84,
    })).toBe("client-id|migrated|sem-id|emissao-de-passagem-aerea-cnf-gru-fabio-r26013-taxa-de-embarque|2026-01-08|2206.97|260.13|1946.84");
  });

  it("prefere a chave persistida ou o id externo estável", () => {
    expect(buildSavingsMatchKey({ clientId: "CLIENT", sourceSystem: "Iddas", sourceExternalKey: "ROW 14" }))
      .toBe("client|iddas|row-14");
    expect(buildSavingsMatchKey({ clientId: "ignored", matchKey: "CLIENT|IDDAS|ROW-14" }))
      .toBe("client|iddas|row-14");
  });

  it("direciona migrados e operações não editáveis para ocultação", () => {
    expect(shouldHideSavingInsteadOfDeleting({ migrated: true, sourceSystem: "iddas", paymentMode: "cash", pointsUsed: null })).toBe(true);
    expect(shouldHideSavingInsteadOfDeleting({ migrated: false, sourceSystem: null, paymentMode: "cash", pointsUsed: null })).toBe(false);
    expect(shouldHideSavingInsteadOfDeleting({ migrated: false, sourceSystem: null, paymentMode: "miles", pointsUsed: 10_000 })).toBe(true);
  });
});
