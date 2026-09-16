import { describe, expect, it } from "vitest";
import { calculateInvoicePoints } from "./invoice-points";

describe("calculateInvoicePoints", () => {
  it("calcula cartão por dólar e salva o snapshot esperado", () => {
    const result = calculateInvoicePoints({ invoiceTotal: 2000, exchangeRate: 5.5, cardRule: { cardName: "Sicoob Black ou Infinite", earningType: "usd", pointsPerUsd: 2 }, programName: "Livelo", programMileValue: 35 });
    expect(result).toMatchObject({ convertedUsd: 363.64, estimatedPoints: 727, estimatedPointsValue: 25.45 });
    expect(result.calculationSnapshot).toEqual({ card_name: "Sicoob Black ou Infinite", earning_type: "usd", points_per_usd: 2, points_per_brl: null, invoice_total: 2000, exchange_rate: 5.5, converted_usd: 363.64, estimated_points: 727, program_name: "Livelo", mile_value: 35, estimated_points_value: 25.45 });
  });

  it("calcula cartão por real", () => {
    expect(calculateInvoicePoints({ invoiceTotal: 2000, cardRule: { cardName: "Cartão BRL", earningType: "brl", pointsPerBrl: 1 } }).estimatedPoints).toBe(2000);
  });

  it("não calcula cartão por dólar sem cotação", () => {
    expect(calculateInvoicePoints({ invoiceTotal: 2000, cardRule: { cardName: "Cartão USD", earningType: "usd", pointsPerUsd: 2 } }).estimatedPoints).toBeNull();
  });

  it("calcula pontos sem valor de milheiro", () => {
    const result = calculateInvoicePoints({ invoiceTotal: 2000, exchangeRate: 5.5, cardRule: { cardName: "Cartão USD", earningType: "usd", pointsPerUsd: 2 } });
    expect(result.estimatedPoints).toBe(727);
    expect(result.estimatedPointsValue).toBeNull();
  });

  it("calcula a diferença entre recebido e estimado", () => {
    expect(calculateInvoicePoints({ invoiceTotal: 2000, cardRule: { cardName: "Cartão BRL", earningType: "brl", pointsPerBrl: 1 }, actualReceivedPoints: 1970 }).pointsDifference).toBe(-30);
  });
});
