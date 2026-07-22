const PROGRAM_ALIASES: Record<string, string> = {
  livelo: "livelo",
  esfera: "esfera",
  smiles: "smiles",
  latampass: "latam_pass",
  "latam pass": "latam_pass",
  "azul fidelidade": "azul_fidelidade",
  tudoazul: "azul_fidelidade",
  azul: "azul_fidelidade",
  coopera: "coopera",
};

export function parseBrazilianPoints(value: string): number {
  const normalized = value.trim().replace(/\./g, "").replace(/\s/g, "");
  if (!/^\d+$/.test(normalized)) throw new Error("INVALID_POINTS");
  const points = Number(normalized);
  if (!Number.isSafeInteger(points)) throw new Error("INVALID_POINTS");
  return points;
}

export function parseBrazilianMoney(value: string): number {
  const normalized = value.trim().replace(/^R\$\s*/, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("INVALID_MONEY");
  return Number(normalized);
}

export function normalizeIddasProgram(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
  const slug = PROGRAM_ALIASES[normalized];
  if (!slug) throw new Error("UNKNOWN_PROGRAM");
  return slug;
}

export function iddasIdempotencyKey(legacyPersonId: number | string, program: string): string {
  const id = String(legacyPersonId).trim();
  if (!/^\d+$/.test(id)) throw new Error("INVALID_LEGACY_PERSON_ID");
  return `iddas_html_saldos_20260721_v1:${id}:${normalizeIddasProgram(program)}`;
}

export function resolveUniqueExactClient<T extends { fullName: string }>(clients: T[], targetName: string): T | null {
  const key = targetName.trim().toLocaleLowerCase("pt-BR");
  const matches = clients.filter((client) => client.fullName.trim().toLocaleLowerCase("pt-BR") === key);
  if (matches.length > 1) throw new Error("AMBIGUOUS_CLIENT");
  return matches[0] ?? null;
}
