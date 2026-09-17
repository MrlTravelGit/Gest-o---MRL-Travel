export interface ParsedInvoiceOcrData {
  bankName: string | null;
  cardName: string | null;
  cardLastDigits: string | null;
  competencyMonth: string | null;
  dueDate: string | null;
  invoiceTotal: number | null;
  exchangeRate: number | null;
  exchangeRateDate: string | null;
  loyaltyProgramName: string | null;
  actualReceivedPoints: number | null;
  warnings: string[];
}

const BANKS = ["Banco do Brasil", "Bradesco", "Caixa", "Itaú", "Santander", "Nubank", "Inter", "C6", "BTG", "Sicredi", "Sicoob", "XP", "Porto Bank"];
const PROGRAMS = ["LATAM Pass", "TudoAzul", "Azul Fidelidade", "UAU Caixa", "Smiles", "Livelo", "Esfera", "Átomos", "Coopera", "Sicredi", "LATAM", "Azul", "Nubank", "PicPay", "Revolut"];
const MONTHS: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const parsePtBrNumber = (value: string): number | null => {
  const cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const isoDate = (day: string, month: string, year: string) => `${year.length === 2 ? `20${year}` : year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

function findNamedValue(text: string, values: string[]): string | null {
  const normalized = normalize(text);
  return values.find((value) => normalized.includes(normalize(value))) || null;
}

function findAmountNearLabel(text: string, labels: RegExp): number | null {
  for (const line of text.split(/\r?\n/)) {
    if (!labels.test(normalize(line))) continue;
    labels.lastIndex = 0;
    const matches = [...line.matchAll(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+[.,]\d{2})/g)];
    if (matches.length) return parsePtBrNumber(matches.at(-1)?.[1] || "");
  }
  return null;
}

function findDateNearLabel(text: string, labels: RegExp): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (!labels.test(normalize(line))) continue;
    labels.lastIndex = 0;
    const match = line.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (match) return isoDate(match[1], match[2], match[3]);
  }
  return null;
}

function findCompetency(text: string): string | null {
  const normalized = normalize(text);
  const numeric = normalized.match(/(?:competencia|referencia|fatura\s+de|mes\s+da\s+fatura)[^\d]{0,20}(0?[1-9]|1[0-2])[\/.-](20\d{2}|\d{2})/);
  if (numeric) return `${numeric[2].length === 2 ? `20${numeric[2]}` : numeric[2]}-${numeric[1].padStart(2, "0")}`;
  const named = normalized.match(/(?:competencia|referencia|fatura\s+de|mes\s+da\s+fatura)[^a-z]{0,20}(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)[^\d]{0,10}(20\d{2})/);
  return named ? `${named[2]}-${String(MONTHS[named[1]]).padStart(2, "0")}` : null;
}

export function parseInvoiceOcrText(rawText: string): ParsedInvoiceOcrData {
  const normalized = normalize(rawText);
  const bankName = findNamedValue(rawText, BANKS);
  const loyaltyProgramName = findNamedValue(rawText, PROGRAMS);
  const lastDigits = normalized.match(/(?:final|finais|terminado\s+em|cartao)[^\d]{0,18}(\d{4})(?!\d)/) || normalized.match(/(?:\*|x){2,}\s*(\d{4})(?!\d)/);
  const cardLine = rawText.split(/\r?\n/).find((line) => /cart[aã]o/i.test(line) && !/(vencimento|pagamento|melhor dia)/i.test(line));
  const pointsLine = rawText.split(/\r?\n/).find((line) => /(pontos recebidos|credito de pontos|pontos creditados)/i.test(normalize(line)));
  const pointsMatch = pointsLine?.match(/(\d{1,3}(?:\.\d{3})+|\d{3,})/);
  const invoiceTotal = findAmountNearLabel(rawText, /(total da fatura|valor total|total a pagar|pagamento total|saldo total|saldo desta fatura|valor da fatura|total deste mes)/);
  const exchangeRate = findAmountNearLabel(rawText, /(cotacao|dolar|usd|ptax|taxa de conversao|taxa dolar)/);
  const warnings: string[] = [];
  if (invoiceTotal == null) warnings.push("Valor total da fatura não identificado.");
  if (exchangeRate != null && (exchangeRate < 3 || exchangeRate > 10)) warnings.push("A cotação identificada parece fora do padrão.");
  if (!bankName && !lastDigits && invoiceTotal == null) warnings.push("Não foi possível identificar banco, cartão ou valor total.");

  return {
    bankName,
    cardName: cardLine?.replace(/.*?cart[aã]o\s*:?[\s-]*/i, "").trim() || null,
    cardLastDigits: lastDigits?.[1] || null,
    competencyMonth: findCompetency(rawText),
    dueDate: findDateNearLabel(rawText, /(vencimento|vence em)/),
    invoiceTotal,
    exchangeRate,
    exchangeRateDate: findDateNearLabel(rawText, /(data da cotacao|cotacao em|dolar em|ptax em)/),
    loyaltyProgramName,
    actualReceivedPoints: pointsMatch ? Number(pointsMatch[1].replace(/\./g, "")) : null,
    warnings,
  };
}
