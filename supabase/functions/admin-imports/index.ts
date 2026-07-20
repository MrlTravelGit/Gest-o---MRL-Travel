import JSZip from "npm:jszip@3.10.1";
import { z } from "npm:zod@3.25.76";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders, isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { analyzeNotionFiles, extractNotionPageId, normalizeText, NOTION_ADAPTER_VERSION, summarizeAnalysis, type AnalyzedFile, type ImportIssue, type SourceFile } from "../_shared/notion-import.ts";

const MAX_UPLOAD_BYTES = Number(Deno.env.get("IMPORT_MAX_UPLOAD_BYTES") ?? 15 * 1024 * 1024);
const MAX_FILES = Number(Deno.env.get("IMPORT_MAX_FILES") ?? 250);
const MAX_EXPANDED_BYTES = Number(Deno.env.get("IMPORT_MAX_EXPANDED_BYTES") ?? 50 * 1024 * 1024);
const MAX_FILE_BYTES = Number(Deno.env.get("IMPORT_MAX_FILE_BYTES") ?? 5 * 1024 * 1024);
const MAX_COMPRESSION_RATIO = Number(Deno.env.get("IMPORT_MAX_COMPRESSION_RATIO") ?? 100);

class ImportError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_upload"), filename: z.string().min(1).max(255), size: z.number().int().positive().max(MAX_UPLOAD_BYTES), mimeType: z.string().max(120), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("analyze_batch"), batchId: z.string().uuid() }).strict(),
]);

function safeError(request: Request, requestId: string, error: unknown): Response {
  if (error instanceof Response) return new Response(JSON.stringify({ code: error.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", message: error.status === 401 ? "Não autorizado." : "Acesso não autorizado.", requestId }), { status: error.status, headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  const known = error instanceof ImportError ? error : new ImportError("INTERNAL_ERROR", "A importação não pôde ser processada.", 500);
  if (!(error instanceof ImportError)) console.error("admin-imports failed", { requestId, code: known.code });
  return jsonResponse(request, { code: known.code, message: known.message, requestId }, known.status);
}

function safeFilename(value: string): string {
  const normalized = value.normalize("NFC").replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 160) || "importacao";
}

function safeArchivePath(path: string): string {
  const normalized = path.normalize("NFC").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").some((segment) => segment === "..")) {
    throw new ImportError("INVALID_ARCHIVE", "O arquivo compactado contém um caminho inseguro.");
  }
  return normalized;
}

function mimeAllowed(file: File): boolean {
  const extension = file.name.toLowerCase().split(".").at(-1);
  if (extension === "zip") return ["application/zip", "application/x-zip-compressed", "application/octet-stream", ""].includes(file.type);
  if (extension === "csv") return ["text/csv", "application/csv", "text/plain", "application/octet-stream", ""].includes(file.type);
  return false;
}

function uploadMetadataAllowed(filename: string, mimeType: string): boolean {
  const mock = { name: filename, type: mimeType } as File;
  return mimeAllowed(mock);
}

async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", owned.buffer);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new ImportError("INVALID_ENCODING", "O CSV precisa estar em UTF-8 ou UTF-8-BOM."); }
}

function isSymlink(entry: JSZip.JSZipObject): boolean {
  const attributes = (entry as unknown as { unixPermissions?: number }).unixPermissions;
  return typeof attributes === "number" && (attributes & 0o170000) === 0o120000;
}

function entrySizes(entry: JSZip.JSZipObject): { compressed: number; expanded: number } {
  const data = (entry as unknown as { _data?: { compressedSize?: number; uncompressedSize?: number } })._data;
  return { compressed: Number(data?.compressedSize ?? 0), expanded: Number(data?.uncompressedSize ?? 0) };
}

async function readZip(bytes: Uint8Array, depth = 0): Promise<SourceFile[]> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false }); }
  catch { throw new ImportError("INVALID_ARCHIVE", "O ZIP está corrompido ou não pôde ser lido."); }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_FILES) throw new ImportError("ARCHIVE_LIMIT_EXCEEDED", "O ZIP excede a quantidade máxima de arquivos.", 413);

  let expandedTotal = 0;
  const nested: JSZip.JSZipObject[] = [];
  const sources: SourceFile[] = [];
  for (const entry of entries) {
    const path = safeArchivePath(entry.name);
    if (isSymlink(entry)) throw new ImportError("INVALID_ARCHIVE", "Links simbólicos não são aceitos no ZIP.");
    const extension = path.toLowerCase().split(".").at(-1);
    if (!extension || !["csv", "md", "zip"].includes(extension)) throw new ImportError("UNSUPPORTED_FILE", "O ZIP contém um tipo de arquivo não permitido.");
    if (extension === "zip") {
      if (depth >= 1) throw new ImportError("INVALID_ARCHIVE", "A profundidade máxima de ZIP interno é um nível.");
      nested.push(entry);
      continue;
    }
    const sizes = entrySizes(entry);
    expandedTotal += sizes.expanded;
    if (sizes.expanded > MAX_FILE_BYTES || expandedTotal > MAX_EXPANDED_BYTES || (sizes.compressed > 0 && sizes.expanded / sizes.compressed > MAX_COMPRESSION_RATIO)) {
      throw new ImportError("ARCHIVE_LIMIT_EXCEEDED", "O conteúdo descompactado excede os limites de segurança.", 413);
    }
    const content = decodeUtf8(await entry.async("uint8array"));
    sources.push({ path, content });
  }
  if (nested.length > 1) throw new ImportError("INVALID_ARCHIVE", "O pacote pode conter somente um ZIP interno.");
  if (nested.length === 1) {
    const nestedBytes = await nested[0].async("uint8array");
    const inner = await readZip(nestedBytes, depth + 1);
    sources.push(...inner.map((file) => ({ ...file, path: `nested/${file.path}` })));
  }
  if (sources.length > MAX_FILES) throw new ImportError("ARCHIVE_LIMIT_EXCEEDED", "O ZIP excede a quantidade máxima de arquivos.", 413);
  return sources;
}

async function readUpload(file: File): Promise<SourceFile[]> {
  if (!mimeAllowed(file)) throw new ImportError("UNSUPPORTED_FILE", "Envie um ZIP do Notion ou um CSV UTF-8.");
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new ImportError("ARCHIVE_LIMIT_EXCEEDED", "O arquivo excede o limite de upload.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".csv")) return [{ path: safeFilename(file.name), content: decodeUtf8(bytes) }];
  return readZip(bytes);
}

async function removeTemporaryUpload(admin: ReturnType<typeof adminClient>, storagePath: string): Promise<void> {
  // A falha de limpeza não altera o resultado do dry-run. O objeto permanece
  // privado e pode ser removido depois sem registrar seu caminho nos logs.
  try { await admin.storage.from("admin-imports").remove([storagePath]); } catch { /* limpeza oportunista */ }
}

function hasValidMagic(filename: string, bytes: Uint8Array): boolean {
  if (filename.toLowerCase().endsWith(".zip")) return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [[0x03,0x04],[0x05,0x06],[0x07,0x08]].some(([third,fourth]) => bytes[2] === third && bytes[3] === fourth);
  return filename.toLowerCase().endsWith(".csv") && !bytes.slice(0, Math.min(bytes.length, 1024)).includes(0);
}

async function reconcileRows(admin: ReturnType<typeof adminClient>, files: AnalyzedFile[]) {
  const rows = files.flatMap((file) => file.rows);
  const clientRows = rows.filter((row) => row.entityType === "client");
  const taskRows = rows.filter((row) => row.entityType === "task");
  const pageIds = [...new Set(rows.map((row) => row.sourceExternalId).filter(Boolean))] as string[];
  const { data: mappings } = pageIds.length
    ? await admin.from("external_source_map").select("source_page_id,entity_type,local_entity_id").eq("source_system", "notion").in("source_page_id", pageIds)
    : { data: [] as Array<{ source_page_id: string; entity_type: string; local_entity_id: string }> };
  const external = new Map((mappings ?? []).map((mapping) => [`${mapping.entity_type}:${mapping.source_page_id}`, mapping.local_entity_id]));

  const emails = [...new Set(clientRows.map((row) => String(row.normalizedPayload.email ?? "")).filter(Boolean))];
  const phones = [...new Set(clientRows.map((row) => String(row.normalizedPayload.phoneE164 ?? "")).filter(Boolean))];
  const candidates: Array<{ id: string; email: string | null; phone_e164: string | null }> = [];
  if (emails.length) { const { data } = await admin.from("clients").select("id,email,phone_e164").in("email", emails); candidates.push(...(data ?? [])); }
  if (phones.length) { const { data } = await admin.from("clients").select("id,email,phone_e164").in("phone_e164", phones); candidates.push(...(data ?? [])); }

  for (const row of clientRows) {
    const mapped = row.sourceExternalId ? external.get(`client:${row.sourceExternalId}`) : null;
    const exact = [...new Map(candidates.filter((candidate) =>
      (row.normalizedPayload.email && candidate.email?.toLowerCase() === String(row.normalizedPayload.email).toLowerCase()) ||
      (row.normalizedPayload.phoneE164 && candidate.phone_e164 === row.normalizedPayload.phoneE164)
    ).map((candidate) => [candidate.id, candidate])).values()];
    if (mapped) { row.resolutionStatus = "skip"; (row as unknown as { targetId?: string }).targetId = mapped; row.issues.push({ severity: "info", code: "UNCHANGED", message: "Page ID já está vinculado a um cliente existente." }); }
    else if (exact.length === 1) { row.resolutionStatus = "pending"; (row as unknown as { targetId?: string }).targetId = exact[0].id; row.issues.push({ severity: "warning", code: "MATCH_REVIEW_REQUIRED", message: "Correspondência exata encontrada; confirme o vínculo sem sobrescrever o cliente." }); }
    else if (exact.length > 1) { row.resolutionStatus = "pending"; row.validationStatus = "warning"; row.issues.push({ severity: "warning", code: "AMBIGUOUS_CLIENT", message: "Mais de um cliente corresponde aos identificadores exatos." }); }
  }

  const batchClientPageIds = new Set(clientRows.map((row) => row.sourceExternalId).filter(Boolean));
  for (const row of taskRows) {
    if (row.sourceExternalId && external.has(`task:${row.sourceExternalId}`)) {
      row.resolutionStatus = "skip";
      row.issues.push({ severity: "info", code: "UNCHANGED", message: "A demanda já foi importada anteriormente." });
      continue;
    }
    const clientExternalId = String(row.normalizedPayload.clientExternalId ?? "");
    const mappedClient = clientExternalId ? external.get(`client:${clientExternalId}`) : null;
    if (mappedClient) (row as unknown as { targetId?: string }).targetId = mappedClient;
    if (clientExternalId && !mappedClient && !batchClientPageIds.has(clientExternalId)) {
      row.resolutionStatus = "pending";
      row.issues.push({ severity: "error", code: "UNRESOLVED_RELATION", fieldName: "Cliente", message: "O Page ID do cliente não existe no lote nem no mapa externo." });
      row.validationStatus = "invalid";
    }
  }

  const { data: staffRows } = await admin.from("staff_members").select("user_id,profiles!inner(full_name)").eq("active", true);
  for (const row of taskRows) {
    const legacy = normalizeText(String(row.normalizedPayload.assignedLegacy ?? ""));
    if (!legacy) continue;
    const matches = (staffRows ?? []).filter((item) => {
      const profile = item.profiles as unknown as { full_name: string };
      return normalizeText(profile.full_name) === legacy;
    });
    if (matches.length === 1) row.normalizedPayload.assignedStaffId = matches[0].user_id;
    else row.issues.push({ severity: "warning", code: "UNRESOLVED_ASSIGNEE", fieldName: "Responsável", message: "Responsável legado precisa de mapeamento manual." });
  }
}

async function persistAnalysis(admin: ReturnType<typeof adminClient>, batchId: string, analyzed: AnalyzedFile[], sources: SourceFile[]) {
  const contentByPath = new Map(sources.map((source) => [source.path.normalize("NFC"), source.content]));
  const fileRows = await Promise.all(analyzed.map(async (file) => ({
    batch_id: batchId, logical_type: file.logicalType, path: file.path, checksum_sha256: await sha256Hex(contentByPath.get(file.path) ?? file.path), row_count: file.rowCount,
    detected_encoding: "utf-8", delimiter: file.delimiter, is_canonical: file.isCanonical, ignored_reason: file.ignoredReason,
  })));
  const { data: insertedFiles, error: filesError } = await admin.from("import_files").insert(fileRows).select("id,path");
  if (filesError) throw filesError;
  const fileIds = new Map((insertedFiles ?? []).map((file) => [file.path, file.id]));
  const staged = [];
  for (const file of analyzed) for (const row of file.rows) staged.push({ file, row });

  for (let offset = 0; offset < staged.length; offset += 100) {
    const chunk = staged.slice(offset, offset + 100);
    const payload = await Promise.all(chunk.map(async ({ file, row }) => ({
      batch_id: batchId, file_id: fileIds.get(file.path), row_number: row.rowNumber, entity_type: row.entityType, source_external_id: row.sourceExternalId,
      raw_payload: row.rawPayload, normalized_payload: row.normalizedPayload, validation_status: row.validationStatus, resolution_status: row.resolutionStatus,
      target_id: (row as unknown as { targetId?: string }).targetId ?? null, row_hash: await sha256Hex(JSON.stringify(row.rawPayload)),
    })));
    const { data: inserted, error } = await admin.from("import_staging_rows").insert(payload).select("id,row_number,file_id");
    if (error) throw error;
    const ids = new Map((inserted ?? []).map((row) => [`${row.file_id}:${row.row_number}`, row.id]));
    const issuePayload: Array<{ staging_row_id: string; severity: string; stable_code: string; field_name: string | null; safe_message: string; resolution: Record<string, unknown> }> = [];
    chunk.forEach(({ file, row }) => row.issues.forEach((issue: ImportIssue) => issuePayload.push({
      staging_row_id: ids.get(`${fileIds.get(file.path)}:${row.rowNumber}`)!, severity: issue.severity, stable_code: issue.code,
      field_name: issue.fieldName ?? null, safe_message: issue.message, resolution: issue.resolution ?? {},
    })));
    if (issuePayload.length) { const { error: issueError } = await admin.from("import_row_issues").insert(issuePayload); if (issueError) throw issueError; }
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  const requestId = crypto.randomUUID();
  if (request.method !== "POST") return jsonResponse(request, { code: "METHOD_NOT_ALLOWED", message: "Método não permitido.", requestId }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { code: "FORBIDDEN", message: "Origem não autorizada.", requestId }, 403);
  try {
    const actor = await requireAdmin(request, ["super_admin", "manager"]);
    let body: unknown;
    try { body = await request.json(); } catch { throw new ImportError("INVALID_REQUEST", "A requisição de importação é inválida."); }
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) throw new ImportError("INVALID_REQUEST", "A requisição de importação é inválida.");
    const admin = adminClient();

    if (parsed.data.action === "create_upload") {
      if (!uploadMetadataAllowed(parsed.data.filename, parsed.data.mimeType)) throw new ImportError("UNSUPPORTED_FILE", "Envie um ZIP do Notion ou um CSV UTF-8.");
      const { data: duplicate, error: duplicateError } = await admin.from("import_batches").select("id,status,dry_run_summary").eq("checksum_sha256", parsed.data.checksum).eq("adapter_version", NOTION_ADAPTER_VERSION).in("status", ["review", "committed"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (duplicateError && duplicateError.code === "42P01") throw new ImportError("SCHEMA_NOT_READY", "As estruturas de importação ainda não foram publicadas.", 503);
      if (duplicateError) throw duplicateError;
      if (duplicate) return jsonResponse(request, { batchId: duplicate.id, status: duplicate.status, summary: duplicate.dry_run_summary, duplicate: true, requestId });
      const batchId = crypto.randomUUID();
      const storagePath = `${actor.userId}/${batchId}/${safeFilename(parsed.data.filename)}`;
      const { error: batchError } = await admin.from("import_batches").insert({
        id: batchId, status: "uploaded", source_system: "notion", adapter_version: NOTION_ADAPTER_VERSION,
        original_filename: safeFilename(parsed.data.filename), upload_size_bytes: parsed.data.size, mime_type: parsed.data.mimeType || (parsed.data.filename.toLowerCase().endsWith(".zip") ? "application/zip" : "text/csv"),
        storage_path: storagePath, checksum_sha256: parsed.data.checksum, created_by: actor.userId, request_id: requestId,
      });
      if (batchError?.code === "42P01") throw new ImportError("SCHEMA_NOT_READY", "As estruturas de importação ainda não foram publicadas.", 503);
      if (batchError) throw batchError;
      const { data: signed, error: signedError } = await admin.storage.from("admin-imports").createSignedUploadUrl(storagePath);
      if (signedError || !signed) {
        await admin.from("import_batches").update({ status: "failed", error_code: "UPLOAD_FAILED", finished_at: new Date().toISOString() }).eq("id", batchId);
        throw new ImportError("UPLOAD_FAILED", "Não foi possível preparar o upload privado.", 500);
      }
      return jsonResponse(request, { batchId, status: "uploaded", path: signed.path, token: signed.token, duplicate: false, requestId });
    }

    const batchId = parsed.data.batchId;
    const { data: batch, error: batchReadError } = await admin.from("import_batches").select("*").eq("id", batchId).maybeSingle();
    if (batchReadError?.code === "42P01") throw new ImportError("SCHEMA_NOT_READY", "As estruturas de importação ainda não foram publicadas.", 503);
    if (batchReadError) throw batchReadError;
    if (!batch) throw new ImportError("BATCH_NOT_FOUND", "Lote de importação não encontrado.", 404);
    if (batch.status === "parsing") throw new ImportError("BATCH_ALREADY_PROCESSING", "Este lote já está em análise.", 409);
    if (["review", "committed"].includes(batch.status)) return jsonResponse(request, { batchId, status: batch.status, summary: batch.dry_run_summary, duplicate: true, requestId });
    if (batch.status !== "uploaded") throw new ImportError("ANALYSIS_FAILED", "Este lote não está pronto para análise.", 409);
    const { data: claimed, error: claimError } = await admin.from("import_batches")
      .update({ status: "parsing", started_at: new Date().toISOString(), uploaded_at: new Date().toISOString(), request_id: requestId })
      .eq("id", batchId)
      .eq("status", "uploaded")
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new ImportError("BATCH_ALREADY_PROCESSING", "Este lote já está em análise.", 409);
    try {
      const { data: stored, error: downloadError } = await admin.storage.from("admin-imports").download(batch.storage_path);
      if (downloadError || !stored) throw new ImportError("UPLOAD_FAILED", "O arquivo enviado não foi encontrado no armazenamento privado.", 404);
      const bytes = new Uint8Array(await stored.arrayBuffer());
      if (bytes.length !== Number(batch.upload_size_bytes) || bytes.length > MAX_UPLOAD_BYTES) throw new ImportError("FILE_TOO_LARGE", "O tamanho do arquivo não corresponde ao lote criado.", 413);
      if (!hasValidMagic(batch.original_filename, bytes)) throw new ImportError("UNSUPPORTED_FILE", "O conteúdo do arquivo não corresponde à extensão informada.");
      if (await sha256Hex(bytes) !== batch.checksum_sha256) throw new ImportError("UPLOAD_FAILED", "O checksum do arquivo enviado não confere.", 409);
      const file = new File([bytes], batch.original_filename, { type: batch.mime_type });
      const sources = await readUpload(file);
      const analyzed = analyzeNotionFiles(sources);
      const recognized = analyzed.filter((item) => item.logicalType !== "unknown" && item.logicalType !== "markdown" && !item.ignoredReason);
      if (!recognized.length) throw new ImportError("UNKNOWN_CSV_SCHEMA", "Nenhuma base conhecida foi identificada pelos cabeçalhos.");
      await reconcileRows(admin, analyzed);
      await persistAnalysis(admin, batchId, analyzed, sources);
      const summary = summarizeAnalysis(analyzed);
      await admin.from("import_batches").update({ status: "review", dry_run_summary: summary, finished_at: new Date().toISOString() }).eq("id", batchId);
      await admin.from("audit_logs").insert({ actor_user_id: actor.userId, action: "parse_import_batch", table_name: "import_batches", record_id: batchId, request_id: requestId, new_data: { adapterVersion: NOTION_ADAPTER_VERSION, canonical: summary.canonical, taskRelations: summary.taskRelations, officialBalancesCreatedByDefault: 0 } });
      await removeTemporaryUpload(admin, batch.storage_path);
      return jsonResponse(request, { batchId, status: "review", summary, duplicate: false, requestId });
    } catch (error) {
      const code = error instanceof ImportError ? error.code : "ANALYSIS_FAILED";
      await admin.from("import_batches").update({ status: "failed", error_code: code, finished_at: new Date().toISOString() }).eq("id", batchId);
      await removeTemporaryUpload(admin, batch.storage_path);
      throw error;
    }
  } catch (error) { return safeError(request, requestId, error); }
});
