import { describe, expect, it } from "vitest";
import { shouldShowClientProgram } from "./client-program-wallet";

describe("shouldShowClientProgram", () => {
  const today = "2026-09-11";

  it("oculta programa sem saldo, clube ou vínculo explícito", () => {
    expect(shouldShowClientProgram({ balance: 0, clubActive: false, linkedAccount: false }, today)).toBe(false);
  });

  it("mostra programa com saldo positivo", () => {
    expect(shouldShowClientProgram({ balance: 1 }, today)).toBe(true);
  });

  it("mostra programa com clube ativo ou vencimento futuro", () => {
    expect(shouldShowClientProgram({ balance: 0, clubActive: true }, today)).toBe(true);
    expect(shouldShowClientProgram({ balance: 0, clubExpiresAt: "2026-09-12" }, today)).toBe(true);
    expect(shouldShowClientProgram({ balance: 0, clubExpiresAt: "2026-09-10" }, today)).toBe(false);
  });

  it("mostra somente conta explicitamente vinculada", () => {
    expect(shouldShowClientProgram({ balance: 0, linkedAccount: true }, today)).toBe(true);
    expect(shouldShowClientProgram({ balance: 0, accountStatus: "linked" }, today)).toBe(true);
  });
});
