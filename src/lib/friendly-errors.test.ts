import { describe, expect, it } from "vitest";
import { buildInsufficientPointsMessage, getFriendlyErrorMessage, toFriendlyNumber } from "./friendly-errors";

describe("friendly errors", () => {
  it("explica saldo insuficiente com programa, saldo e tentativa", () => {
    expect(buildInsufficientPointsMessage({ programName: "Azul Fidelidade", availablePoints: 64_180, requestedPoints: "72.000" }))
      .toBe("Saldo insuficiente em Azul Fidelidade. O cliente tem 64.180 pontos disponíveis, mas você tentou usar 72.000 pontos. Ajuste os pontos utilizados para até 64.180 ou atualize o saldo do programa antes de registrar a viagem.");
  });

  it("normaliza números no padrão brasileiro", () => {
    expect(toFriendlyNumber("64.180 pontos")).toBe(64_180);
    expect(toFriendlyNumber("1.234,50")).toBe(1234.5);
  });

  it("traduz a resposta estruturada de saldo do Supabase", () => {
    const message = getFriendlyErrorMessage(
      { code: "23514", message: "INSUFFICIENT_POINTS", details: '{"program_name":"Azul Fidelidade","available_points":64180,"requested_points":72000}' },
      { programName: "Saldo desatualizado", availablePoints: 99_999, requestedPoints: 72_000 },
    );
    expect(message).toContain("Saldo insuficiente em Azul Fidelidade");
    expect(message).toContain("O cliente tem 64.180 pontos disponíveis");
    expect(message).toContain("tentou usar 72.000 pontos");
  });

  it.each([
    [{ code: "23505", message: "duplicate key value" }, "Este registro já existe"],
    [{ status: 401, message: "JWT expired" }, "Sua sessão expirou"],
    [new Error("Failed to fetch"), "Verifique a internet"],
  ])("traduz erros técnicos comuns", (error, expected) => {
    expect(getFriendlyErrorMessage(error)).toContain(expected);
  });

  it("usa ação contextual sem expor mensagem técnica desconhecida", () => {
    expect(getFriendlyErrorMessage(new Error("internal relation x failed"), { action: "registrar viagem" }))
      .toBe("Não foi possível concluir a operação: registrar viagem. Tente novamente ou revise os dados informados.");
  });
});
