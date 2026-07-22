import { describe, expect, it } from "vitest";
import { clientStatusLabel, contractDatesAreValid, leadActivationCopy, requiresContractChangeReason } from "./client-admin";

describe("administração do cliente", () => {
  it("mantém nome e estado em elementos textuais separados", () => {
    const copy = leadActivationCopy("Leonardo Lima");
    expect(copy.title).toBe("Aguardando ativação");
    expect(copy.title).not.toContain("Leonardo Lima");
    expect(copy.support).toContain("Leonardo Lima");
  });

  it("traduz o enum legado ended sem alterar o valor do banco", () => {
    expect(clientStatusLabel("ended")).toBe("Arquivado");
    expect(clientStatusLabel("lead")).toBe("Aguardando ativação");
  });

  it("aceita prazo indeterminado e bloqueia término anterior", () => {
    expect(contractDatesAreValid("2026-07-21", "")).toBe(true);
    expect(contractDatesAreValid("2026-07-21", "2026-07-20")).toBe(false);
  });

  it("exige motivo somente quando a vigência existente muda", () => {
    expect(requiresContractChangeReason({ startsOn: "2026-01-01", endsOn: null }, { startsOn: "2026-01-01", endsOn: null })).toBe(false);
    expect(requiresContractChangeReason({ startsOn: "2026-01-01", endsOn: null }, { startsOn: "2026-02-01", endsOn: null })).toBe(true);
  });
});
