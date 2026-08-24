import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function positions(file: string, labels: string[]) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  return labels.map((label) => source.indexOf(label));
}

describe("ordem operacional dos módulos", () => {
  it("mantém nova fatura e recentes antes das etapas secundárias", () => {
    const order = positions("./AdminInvoicesPage.tsx", ["Nova fatura", "Lançamentos recentes", "Importação de faturas", "Reconciliação de cashback"]);
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("mantém lançamento e histórico antes de importação e cashback em viagens", () => {
    const order = positions("./AdminTravelEconomyPage.tsx", ["Novo lançamento", "Lançamentos recentes", "<IddasSavingsImportPanel />", "<CashbackFormulaReconciliationPanel />"]);
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
