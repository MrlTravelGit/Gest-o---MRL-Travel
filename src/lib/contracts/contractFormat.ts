import type { ContractDraft } from "@/types/contracts";

const months = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const numberWords: Record<number, string> = {
  0: "zero", 1: "um", 2: "dois", 3: "três", 4: "quatro", 5: "cinco",
  6: "seis", 7: "sete", 8: "oito", 9: "nove", 10: "dez", 11: "onze", 12: "doze",
  13: "treze", 14: "quatorze", 15: "quinze", 16: "dezesseis", 17: "dezessete",
  18: "dezoito", 19: "dezenove", 20: "vinte", 30: "trinta", 40: "quarenta",
  50: "cinquenta", 60: "sessenta", 70: "setenta", 80: "oitenta", 90: "noventa", 100: "cem",
};

export function numberToWords(value: number): string {
  if (numberWords[value]) return numberWords[value];
  if (Number.isInteger(value) && value > 20 && value < 100) {
    const tens = Math.floor(value / 10) * 10;
    return numberWords[tens] + " e " + numberWords[value % 10];
  }
  return String(value);
}

export function formatPercentage(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value) + "%";
}

export function percentageToWords(value: number): string {
  if (Number.isInteger(value)) return numberToWords(value) + " por cento";
  const [integer, decimal = ""] = String(value).split(".");
  const decimalWords = decimal.split("").map((digit) => numberToWords(Number(digit))).join(" ");
  return numberToWords(Number(integer)) + " vírgula " + decimalWords + " por cento";
}

export function calculateInstallment(total: number, installments: number): number {
  if (!Number.isFinite(total) || total < 0) return 0;
  if (!Number.isInteger(installments) || installments < 1) return 0;
  return Math.round((total / installments) * 100) / 100;
}

export function formatContractCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatContractDateLong(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return match[3] + " de " + months[Number(match[2]) - 1] + " de " + match[1];
}

export function validateContractDraft(draft: Pick<ContractDraft, "clientName" | "contractValue">): string | null {
  if (!draft.clientName.trim()) return "Informe o nome completo do contratante.";
  if (!Number.isFinite(draft.contractValue) || draft.contractValue <= 0) return "Informe um valor total maior que zero.";
  return null;
}
