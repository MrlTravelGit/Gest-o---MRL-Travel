export const NOTION_ADAPTER_VERSION = "notion_mrl_v1";

export type ImportEntity = "client" | "task" | "onboarding" | "program" | "passage";

export interface SourceFile {
  path: string;
  content: string;
}

export interface ImportIssue {
  severity: "info" | "warning" | "error";
  code: string;
  fieldName?: string;
  message: string;
  resolution?: Record<string, unknown>;
}

export interface AnalyzedRow {
  rowNumber: number;
  entityType: ImportEntity;
  sourceExternalId: string | null;
  rawPayload: Record<string, string>;
  normalizedPayload: Record<string, unknown>;
  validationStatus: "valid" | "warning" | "invalid";
  resolutionStatus: "create_new_lead" | "create_new" | "pending" | "declared_pending" | "skip";
  issues: ImportIssue[];
}

export interface AnalyzedFile {
  path: string;
  logicalType: ImportEntity | "markdown" | "unknown";
  rows: AnalyzedRow[];
  rowCount: number;
  delimiter: "," | ";" | null;
  isCanonical: boolean;
  ignoredReason: string | null;
}

const schemas: Array<{ entity: ImportEntity; required: string[] }> = [
  { entity: "task", required: ["titulo", "cliente", "comentarios", "concluido em", "prazo", "status", "urgencia"] },
  { entity: "program", required: ["programa", "cliente", "saldo atual", "pontos a expirar", "custo milheiro"] },
  { entity: "passage", required: ["nome do trecho", "cliente", "companhia", "pontos utilizados", "valor companhia"] },
  { entity: "onboarding", required: ["nome completo", "cpf", "cliente", "o que voce espera do nosso servico liste exatamente todas as suas expectativas"] },
  { entity: "client", required: ["nome completo", "cpf", "demandas", "e mail", "whatsapp"] },
];

// O export do Notion inclui, além das bases `_all.csv`, visões relacionais
// filtradas com menos colunas. Elas precisam ser reconhecidas para que possam
// ser ignoradas quando a base canônica equivalente estiver presente, mas nunca
// devem substituir o contrato mais estrito usado para identificar a canônica.
const filteredViewSchemas: Array<{ entity: ImportEntity; required: string[] }> = [
  { entity: "task", required: ["titulo", "prazo", "responsavel", "status", "tipo", "urgencia"] },
  { entity: "program", required: ["programa", "saldo atual", "pontos a expirar", "clube ativo", "ultima edicao"] },
  {
    entity: "onboarding",
    required: ["nome completo", "cpf", "rg", "whatsapp", "e mail", "o que voce espera do nosso servico liste exatamente todas as suas expectativas"],
  },
  { entity: "passage", required: ["nome do trecho", "iata origem", "iata destino", "companhia", "programa", "pontos utilizados"] },
  { entity: "client", required: ["nome completo", "cpf", "data de nascimento", "e mail", "whatsapp"] },
];

export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function extractNotionPageId(value: string): string | null {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* mantém o valor original */ }
  const compact = decoded.replace(/-/g, "").toLowerCase();
  const matches = [...compact.matchAll(/([a-f0-9]{32})(?=[^a-f0-9]|$)/g)];
  return matches.at(-1)?.[1] ?? null;
}

export function detectDelimiter(content: string): "," | ";" {
  const firstRecord = recordPrefix(content.replace(/^\uFEFF/, ""));
  const comma = countOutsideQuotes(firstRecord, ",");
  const semicolon = countOutsideQuotes(firstRecord, ";");
  return semicolon > comma ? ";" : ",";
}

function recordPrefix(content: string): string {
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') index += 1;
      else quoted = !quoted;
    }
    if (!quoted && (char === "\n" || char === "\r")) return content.slice(0, index);
  }
  return content;
}

function countOutsideQuotes(value: string, expected: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') {
      if (quoted && value[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && value[index] === expected) count += 1;
  }
  return count;
}

export function parseCsv(content: string, delimiter = detectDelimiter(content)): { headers: string[]; rows: Record<string, string>[] } {
  const source = content.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) { record.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      record.push(field); field = "";
      if (record.some((item) => item.length > 0)) records.push(record);
      record = [];
    } else field += char;
  }
  if (field.length || record.length) { record.push(field); if (record.some((item) => item.length > 0)) records.push(record); }
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map((item) => item.trim().normalize("NFC"));
  return {
    headers,
    rows: records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))),
  };
}

export function detectEntity(headers: string[]): ImportEntity | null {
  const normalized = new Set(headers.map(normalizeText));
  const canonical = schemas.find((schema) => schema.required.every((field) => normalized.has(field)));
  if (canonical) return canonical.entity;
  return filteredViewSchemas.find((schema) => schema.required.every((field) => normalized.has(field)))?.entity ?? null;
}

function valueOf(row: Record<string, string>, normalizedHeader: string): string {
  const entry = Object.entries(row).find(([header]) => normalizeText(header) === normalizedHeader);
  return entry?.[1]?.trim() ?? "";
}

export function parsePtBrDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour = "12", minute = "00"] = match;
  const date = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parsePtBrCurrency(value: string): number | null {
  const normalized = value.replace(/R\$|\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!normalized || !/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parsePointQuantity(value: string): { value: number | null; ambiguous: boolean } {
  const compact = value.replace(/\s/g, "");
  if (!compact) return { value: null, ambiguous: false };
  if (/^\d+$/.test(compact)) return { value: Number(compact), ambiguous: false };
  if (/^\d{1,3}(?:[.]\d{3})+$/.test(compact) || /^\d{1,3}(?:,\d{3})+$/.test(compact)) {
    return { value: Number(compact.replace(/[.,]/g, "")), ambiguous: false };
  }
  return { value: null, ambiguous: true };
}

export function sanitizeMarkdown(value: string): { text: string; checklist: string[] } {
  const checklist: string[] = [];
  const text = value
    .replace(/\u0000/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s*[-*]\s+\[[ xX]\]\s+(.+)$/gm, (_line, item: string) => { const safeItem = item.replace(/<[^>]*>/g, "").trim().slice(0, 500); checklist.push(safeItem); return safeItem; })
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[`*_~]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20_000);
  return { text, checklist };
}

function pageIndex(markdownFiles: SourceFile[]): Map<string, Array<{ id: string; body: string; checklist: string[] }>> {
  const index = new Map<string, Array<{ id: string; body: string; checklist: string[] }>>();
  for (const file of markdownFiles) {
    const id = extractNotionPageId(file.path);
    if (!id) continue;
    const filename = file.path.split("/").at(-1)?.replace(/\.md$/i, "") ?? "";
    const name = normalizeText(filename.replace(/[a-f0-9]{32}$/i, ""));
    const safe = sanitizeMarkdown(file.content);
    const values = index.get(name) ?? [];
    values.push({ id, body: safe.text, checklist: safe.checklist });
    index.set(name, values);
  }
  return index;
}

function indexedPage(index: Map<string, Array<{ id: string; body: string; checklist: string[] }>>, name: string) {
  const values = index.get(normalizeText(name)) ?? [];
  return values.length === 1 ? values[0] : null;
}

function validation(issues: ImportIssue[]): "valid" | "warning" | "invalid" {
  if (issues.some((issue) => issue.severity === "error")) return "invalid";
  if (issues.some((issue) => issue.severity === "warning")) return "warning";
  return "valid";
}

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length >= 12 && digits.length <= 15) return `+${digits}`;
  return null;
}

function mapClient(row: Record<string, string>, rowNumber: number, index: ReturnType<typeof pageIndex>): AnalyzedRow {
  const fullName = valueOf(row, "nome completo");
  const email = valueOf(row, "e mail").toLowerCase();
  const rawPhone = valueOf(row, "whatsapp");
  const phoneE164 = normalizePhone(rawPhone);
  const page = indexedPage(index, fullName.replace(/\//g, " "));
  const issues: ImportIssue[] = [];
  if (!fullName) issues.push({ severity: "error", code: "INVALID_ROW", fieldName: "Nome completo", message: "Nome obrigatório ausente." });
  if (!email && !phoneE164) issues.push({ severity: "error", code: "INVALID_ROW", fieldName: "Contato", message: "E-mail ou telefone válido é obrigatório para criar um lead." });
  if (rawPhone && !phoneE164) issues.push({ severity: "warning", code: "INVALID_PHONE", fieldName: "WhatsApp", message: "Telefone não pôde ser normalizado para E.164." });
  if (!page) issues.push({ severity: "warning", code: "UNRESOLVED_SOURCE_ID", fieldName: "Nome completo", message: "Page ID do cliente exige revisão." });
  return {
    rowNumber, entityType: "client", sourceExternalId: page?.id ?? null, rawPayload: row,
    normalizedPayload: { fullName, email: email || null, phoneE164, sourceUpdatedAt: parsePtBrDate(valueOf(row, "ultima edicao")) },
    validationStatus: validation(issues), resolutionStatus: issues.some((issue) => issue.severity === "error") ? "pending" : "create_new_lead", issues,
  };
}

const statusMap: Record<string, string> = { concluido: "completed", "nao iniciada": "open", standby: "on_hold" };
const categoryMap: Record<string, string> = {
  onboarding: "onboarding", "cotacao passagens": "flight_quote", "remarcacao ou cancelamento": "reschedule_or_cancel",
  "cotacao hospedagens": "hotel_quote", "outra cotacoes": "other", outros: "other",
};
const priorityMap: Record<string, number> = { alta: 3, medio: 2, baixa: 1 };

function parseMinutes(value: string): number | null {
  if (!value.trim()) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const hours = value.match(/(\d+(?:[.,]\d+)?)\s*h/i)?.[1];
  const minutes = value.match(/(\d+)\s*m/i)?.[1];
  if (!hours && !minutes) return null;
  return Math.round(Number((hours ?? "0").replace(",", ".")) * 60 + Number(minutes ?? 0));
}

function mapTask(row: Record<string, string>, rowNumber: number, index: ReturnType<typeof pageIndex>): AnalyzedRow {
  const title = valueOf(row, "titulo");
  const clientRelation = valueOf(row, "cliente");
  const clientExternalId = extractNotionPageId(clientRelation);
  const page = indexedPage(index, title);
  const rawPriority = normalizeText(valueOf(row, "urgencia"));
  const rawStatus = normalizeText(valueOf(row, "status"));
  const rawCategory = normalizeText(valueOf(row, "tipo"));
  const rawDescription = valueOf(row, "comentarios");
  const issues: ImportIssue[] = [];
  if (!title) issues.push({ severity: "error", code: "INVALID_ROW", fieldName: "Título", message: "Título obrigatório ausente." });
  if (!clientExternalId) issues.push({ severity: "warning", code: "UNRESOLVED_RELATION", fieldName: "Cliente", message: "Escolha um cliente, importe como demanda interna ou ignore.", resolution: { options: ["select_client", "import_internal", "skip"] } });
  if (!rawPriority) issues.push({ severity: "warning", code: "DEFAULT_APPLIED", fieldName: "Urgência", message: "Urgência ausente; prioridade média sugerida." });
  if (!statusMap[rawStatus]) issues.push({ severity: "error", code: "INVALID_ROW", fieldName: "Status", message: "Status legado não reconhecido." });
  if (rawCategory && !categoryMap[rawCategory]) issues.push({ severity: "warning", code: "DEFAULT_APPLIED", fieldName: "Tipo", message: "Categoria não reconhecida; Outros sugerido." });
  if (!page) issues.push({ severity: "warning", code: "UNRESOLVED_SOURCE_ID", fieldName: "Título", message: "Page ID da demanda exige revisão." });
  const timeValue = valueOf(row, "tempo gasto");
  const timeSpentMinutes = parseMinutes(timeValue);
  if (timeValue && timeSpentMinutes === null) issues.push({ severity: "warning", code: "AMBIGUOUS_NUMBER", fieldName: "Tempo gasto", message: "Tempo gasto precisa de revisão manual." });
  const pageDescription = !rawDescription && page?.body ? page.body : "";
  return {
    rowNumber, entityType: "task", sourceExternalId: page?.id ?? null, rawPayload: row,
    normalizedPayload: {
      title, clientLabel: clientRelation.replace(/\s*\([^)]*\)\s*$/, ""), clientExternalId,
      description: rawDescription || pageDescription, checklist: page?.checklist ?? [], status: statusMap[rawStatus] ?? "open",
      priority: priorityMap[rawPriority] ?? 2, category: categoryMap[rawCategory] ?? "other", assignedLegacy: valueOf(row, "responsavel") || null,
      dueAt: parsePtBrDate(valueOf(row, "prazo")), completedAt: parsePtBrDate(valueOf(row, "concluido em")),
      sourceCreatedAt: parsePtBrDate(valueOf(row, "criado em")), sourceUpdatedAt: parsePtBrDate(valueOf(row, "ultima edicao")), timeSpentMinutes,
    },
    validationStatus: validation(issues), resolutionStatus: issues.some((issue) => issue.severity === "error") || !clientExternalId ? "pending" : "create_new", issues,
  };
}

function mapPreviewEntity(entityType: "onboarding" | "program" | "passage", row: Record<string, string>, rowNumber: number): AnalyzedRow {
  const issues: ImportIssue[] = [{ severity: "info", code: "DECLARED_PENDING", message: "Registro será mantido como declarado e não cria saldo ou viagem oficial automaticamente." }];
  const clientRelation = valueOf(row, "cliente");
  if (!extractNotionPageId(clientRelation)) issues.push({ severity: "warning", code: "UNRESOLVED_RELATION", fieldName: "Cliente", message: "Relação com cliente precisa de revisão." });
  const normalized: Record<string, unknown> = { clientLabel: clientRelation.replace(/\s*\([^)]*\)\s*$/, ""), clientExternalId: extractNotionPageId(clientRelation) };
  if (entityType === "onboarding") normalized.fullName = valueOf(row, "nome completo");
  if (entityType === "program") {
    normalized.programName = valueOf(row, "programa");
    const points = parsePointQuantity(valueOf(row, "saldo atual"));
    normalized.declaredPoints = points.value;
    if (points.ambiguous) issues.push({ severity: "error", code: "AMBIGUOUS_NUMBER", fieldName: "Saldo atual", message: "Quantidade de pontos ambígua; nenhuma movimentação será criada." });
    normalized.declaredCostPerThousand = parsePtBrCurrency(valueOf(row, "custo milheiro"));
  }
  if (entityType === "passage") normalized.title = valueOf(row, "nome do trecho");
  return { rowNumber, entityType, sourceExternalId: null, rawPayload: row, normalizedPayload: normalized, validationStatus: validation(issues), resolutionStatus: "declared_pending", issues };
}

export function analyzeNotionFiles(files: SourceFile[]): AnalyzedFile[] {
  const markdown = files.filter((file) => file.path.toLowerCase().endsWith(".md"));
  const index = pageIndex(markdown);
  const csvInputs = files.filter((file) => file.path.toLowerCase().endsWith(".csv"));
  const parsed = csvInputs.map((file) => {
    const delimiter = detectDelimiter(file.content);
    const csv = parseCsv(file.content, delimiter);
    return { file, delimiter, csv, entity: detectEntity(csv.headers), isCanonical: /_all\.csv$/i.test(file.path.normalize("NFC")) };
  });
  const canonicalEntities = new Set(parsed.filter((file) => file.isCanonical && file.entity).map((file) => file.entity));

  const analyzed = parsed.map(({ file, delimiter, csv, entity, isCanonical }): AnalyzedFile => {
    if (!entity) return { path: file.path.normalize("NFC"), logicalType: "unknown", rows: [], rowCount: csv.rows.length, delimiter, isCanonical, ignoredReason: "UNKNOWN_CSV_SCHEMA" };
    if (!isCanonical && canonicalEntities.has(entity)) return { path: file.path.normalize("NFC"), logicalType: entity, rows: [], rowCount: csv.rows.length, delimiter, isCanonical: false, ignoredReason: "FILTERED_RELATIONAL_VIEW" };
    const rows = csv.rows.map((row, indexValue) => {
      const rowNumber = indexValue + 2;
      if (entity === "client") return mapClient(row, rowNumber, index);
      if (entity === "task") return mapTask(row, rowNumber, index);
      return mapPreviewEntity(entity, row, rowNumber);
    });
    return { path: file.path.normalize("NFC"), logicalType: entity, rows, rowCount: rows.length, delimiter, isCanonical, ignoredReason: null };
  });

  analyzed.push(...markdown.map((file) => ({ path: file.path.normalize("NFC"), logicalType: "markdown" as const, rows: [], rowCount: file.content.split(/\r?\n/).length, delimiter: null, isCanonical: false, ignoredReason: "CONTEXT_ONLY" })));
  return analyzed;
}

export function summarizeAnalysis(files: AnalyzedFile[]) {
  const rows = files.flatMap((file) => file.rows);
  const count = (entity: ImportEntity) => rows.filter((row) => row.entityType === entity).length;
  return {
    adapterVersion: NOTION_ADAPTER_VERSION,
    files: files.length,
    canonical: { clients: count("client"), tasks: count("task"), programs: count("program"), onboardings: count("onboarding"), passages: count("passage") },
    taskRelations: {
      linked: rows.filter((row) => row.entityType === "task" && Boolean(row.normalizedPayload.clientExternalId)).length,
      needsDecision: rows.filter((row) => row.entityType === "task" && !row.normalizedPayload.clientExternalId).length,
    },
    conflicts: rows.filter((row) => row.resolutionStatus === "pending").length,
    invalid: rows.filter((row) => row.validationStatus === "invalid").length,
    ignoredFilteredFiles: files.filter((file) => file.ignoredReason === "FILTERED_RELATIONAL_VIEW").length,
    officialBalancesCreatedByDefault: 0,
  };
}
