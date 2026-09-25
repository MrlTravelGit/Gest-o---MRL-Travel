import { parseDefaultWitnesses, type WitnessConfig } from "./autentique-rules.ts";

export type DefaultWitness = WitnessConfig;

export function autentiqueMonthlyLimit(): number {
  const parsed = Number.parseInt(Deno.env.get("AUTENTIQUE_MONTHLY_FREE_LIMIT") ?? "20", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

export function productionMonthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function defaultAutentiqueWitnesses(): DefaultWitness[] {
  const raw = Deno.env.get("AUTENTIQUE_DEFAULT_WITNESSES")?.trim();
  const witnesses = parseDefaultWitnesses(raw);
  if (raw && witnesses.length === 0) console.error("AUTENTIQUE_DEFAULT_WITNESSES não possui testemunhas válidas.");
  return witnesses;
}
