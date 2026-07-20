import { supabase } from "@/lib/supabase";
import type { ImportBatchDetail, ImportBatchListItem, ImportSummary } from "@/types/imports";

const IMPORT_ERRORS: Record<string, string> = {
  IMPORT_FUNCTION_UNAVAILABLE: "O serviço de importação ainda não está disponível. Tente novamente após a publicação do backend.",
  UNAUTHORIZED: "Sua sessão expirou. Entre novamente no painel administrativo.", FORBIDDEN: "Seu perfil não possui permissão para gerenciar importações.",
  UNSUPPORTED_FILE: "Envie um ZIP do Notion ou um CSV UTF-8.", FILE_TOO_LARGE: "O arquivo excede o limite de 15 MB.", INVALID_ARCHIVE: "O ZIP é inválido ou contém caminhos inseguros.",
  ARCHIVE_LIMIT_EXCEEDED: "O conteúdo do ZIP excede os limites seguros de importação.", UNKNOWN_CSV_SCHEMA: "Nenhuma base conhecida foi identificada pelos cabeçalhos.",
  SCHEMA_NOT_READY: "As tabelas e RPCs de importação ainda não foram publicadas no Supabase.", UPLOAD_FAILED: "O upload privado falhou ou o checksum não confere.", ANALYSIS_FAILED: "O arquivo foi enviado, mas a análise não foi concluída.",
  BATCH_NOT_FOUND: "O lote de importação não foi encontrado.", BATCH_ALREADY_PROCESSING: "Este lote já está sendo analisado.", INTERNAL_ERROR: "O serviço encontrou um erro interno. Use o request ID ao solicitar suporte.",
  INVALID_ENCODING: "O CSV precisa estar em UTF-8 ou UTF-8-BOM.", INVALID_ROW: "A linha possui dados inválidos.", AMBIGUOUS_CLIENT: "A correspondência de cliente precisa de revisão.",
  AMBIGUOUS_NUMBER: "Um valor numérico é ambíguo e precisa de revisão.", UNRESOLVED_RELATION: "Resolva as relações pendentes antes de confirmar.",
  BATCH_NOT_REVIEWED: "Resolva todos os conflitos bloqueantes antes de confirmar.", BATCH_ALREADY_COMMITTED: "Este lote já foi confirmado.",
  ROLLBACK_CONFLICT: "O lote possui edições posteriores e não pode ser desfeito integralmente.",
};

function importError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error ? JSON.stringify(error) : "";
  const match = Object.entries(IMPORT_ERRORS).find(([code]) => raw.includes(code));
  return new Error(match?.[1] ?? "Não foi possível concluir esta etapa da importação. Tente novamente com segurança.");
}

export async function listImportBatches(): Promise<ImportBatchListItem[]> {
  const { data, error } = await supabase.from("import_batches").select("id,status,adapter_version,original_filename,dry_run_summary,rollback_status,created_at,finished_at").order("created_at", { ascending: false }).limit(30);
  if (error) throw importError(error);
  return (data ?? []) as unknown as ImportBatchListItem[];
}

export type ImportUploadStage = "checksum" | "creating" | "uploading" | "analyzing";

async function invokeImport<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-imports", { body });
  if (error) {
    let raw: unknown = error;
    if ("context" in error && error.context instanceof Response) { try { raw = await error.context.clone().json(); } catch { raw = { code: "IMPORT_FUNCTION_UNAVAILABLE" }; } }
    throw importError(raw);
  }
  return data as T;
}

async function checksum(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function uploadImport(file: File, onStage?: (stage: ImportUploadStage) => void): Promise<{ batchId: string; status: string; summary: ImportSummary; duplicate: boolean; requestId: string }> {
  const extension = file.name.toLowerCase().split(".").at(-1);
  if (!extension || !["zip", "csv"].includes(extension)) throw importError({ code: "UNSUPPORTED_FILE" });
  if (file.size <= 0 || file.size > 15 * 1024 * 1024) throw importError({ code: "FILE_TOO_LARGE" });
  onStage?.("checksum"); const fileChecksum = await checksum(file);
  onStage?.("creating");
  const created = await invokeImport<{ batchId: string; status: string; summary?: ImportSummary; duplicate: boolean; requestId: string; path?: string; token?: string }>({ action: "create_upload", filename: file.name, size: file.size, mimeType: file.type || (extension === "zip" ? "application/zip" : "text/csv"), checksum: fileChecksum });
  if (created.duplicate) return created as { batchId: string; status: string; summary: ImportSummary; duplicate: boolean; requestId: string };
  if (!created.path || !created.token) throw importError({ code: "UPLOAD_FAILED" });
  onStage?.("uploading");
  const { error: uploadError } = await supabase.storage.from("admin-imports").uploadToSignedUrl(created.path, created.token, file, { contentType: file.type || (extension === "zip" ? "application/zip" : "text/csv") });
  if (uploadError) throw importError({ code: "UPLOAD_FAILED", message: uploadError.message });
  onStage?.("analyzing");
  return invokeImport({ action: "analyze_batch", batchId: created.batchId });
}

export async function getImportBatch(batchId: string): Promise<ImportBatchDetail> {
  const { data, error } = await supabase.rpc("get_admin_import_batch", { p_batch_id: batchId });
  if (error || !data) throw importError(error);
  return data as unknown as ImportBatchDetail;
}

export async function resolveImportRow(rowId: string, resolution: string, targetId?: string) {
  const { data, error } = await supabase.rpc("admin_resolve_import_row", { p_row_id: rowId, p_resolution: resolution, p_target_id: targetId || null, p_normalized_patch: {} });
  if (error || !data) throw importError(error);
  return data;
}

export async function commitImportBatch(batchId: string) {
  const { data, error } = await supabase.rpc("admin_commit_import_batch", { p_batch_id: batchId });
  if (error || !data) throw importError(error);
  return data;
}

export async function rollbackImportBatch(batchId: string, reason: string) {
  const { data, error } = await supabase.rpc("admin_rollback_import_batch", { p_batch_id: batchId, p_reason: reason });
  if (error || !data) throw importError(error);
  return data;
}
