import { describe, expect, it } from "vitest";
import { parseInvoiceOcrText } from "./parseInvoiceOcrText";

describe("parseInvoiceOcrText", () => {
  it("extrai os campos essenciais sem inventar dados", () => {
    const result = parseInvoiceOcrText(`ITAÚ\nCartão Personnalité final 1234\nCompetência setembro 2026\nVencimento 25/09/2026\nValor total R$ 20.000,00\nCotação do dólar 5,50 em 15/09/2026\nLATAM Pass\nPontos creditados 7.273`);
    expect(result).toMatchObject({ bankName: "Itaú", cardLastDigits: "1234", competencyMonth: "2026-09", dueDate: "2026-09-25", invoiceTotal: 20000, exchangeRate: 5.5, loyaltyProgramName: "LATAM Pass", actualReceivedPoints: 7273 });
  });

  it("avisa quando os dados centrais não aparecem", () => {
    const result = parseInvoiceOcrText("imagem pouco legível");
    expect(result.invoiceTotal).toBeNull();
    expect(result.warnings).toContain("Valor total da fatura não identificado.");
    expect(result.warnings).toContain("Não foi possível identificar banco, cartão ou valor total.");
  });

  it("sinaliza cotação fora do padrão", () => {
    expect(parseInvoiceOcrText("Valor total R$ 1.000,00\nCotação do dólar 15,90").warnings).toContain("A cotação identificada parece fora do padrão.");
  });
});
