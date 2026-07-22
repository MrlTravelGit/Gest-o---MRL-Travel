import { describe, expect, it } from "vitest";
import { iddasIdempotencyKey, normalizeIddasProgram, parseBrazilianMoney, parseBrazilianPoints, resolveUniqueExactClient } from "./iddas-backfill";

describe("lote contábil Iddas", () => {
  it("converte pontos brasileiros sem tratar o ponto como decimal", () => {
    expect(parseBrazilianPoints("153.583")).toBe(153583);
  });

  it("converte moeda brasileira", () => {
    expect(parseBrazilianMoney("R$ 60.189,72")).toBe(60189.72);
  });

  it("normaliza somente aliases conhecidos para o catálogo canônico", () => {
    expect(normalizeIddasProgram("LatamPass")).toBe("latam_pass");
    expect(normalizeIddasProgram("Azul Fidelidade")).toBe("azul_fidelidade");
    expect(() => normalizeIddasProgram("Programa inventado")).toThrow("UNKNOWN_PROGRAM");
  });

  it("gera a chave idempotente oficial", () => {
    expect(iddasIdempotencyKey(14829, "Livelo")).toBe("iddas_html_saldos_20260721_v1:14829:livelo");
  });

  it("bloqueia correspondência exata ambígua e não usa aproximação", () => {
    const clients = [{ id: "a", fullName: "Alessandra Martins" }, { id: "b", fullName: "Alessandra Martins" }];
    expect(() => resolveUniqueExactClient(clients, "Alessandra Martins")).toThrow("AMBIGUOUS_CLIENT");
    expect(resolveUniqueExactClient(clients, "Alessandra Antigo")).toBeNull();
  });
});
