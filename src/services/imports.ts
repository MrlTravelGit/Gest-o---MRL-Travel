import { supabase } from "@/lib/supabase";
import type { ImportBatchDetail, ImportBatchListItem, ImportSummary } from "@/types/imports";

const IMPORT_ERRORS: Record<string, string> = {
  UNSUPPORTED_FILE: "Envie um ZIP do Notion ou um CSV UTF-8.", INVALID_ARCHIVE: "O ZIP é inválido ou contém caminhos inseguros.",
  ARCHIVE_LIMIT_EXCEEDED: "O arquivo excede os limites seguros de importação.", UNKNOWN_CSV_SCHEMA: "Nenhuma base conhecida foi identificada pelos cabeçalhos.",
  INVALID_ENCODING: "O CSV precisa estar em UTF-8 ou UTF-8-BOM.", INVALID_ROW: "A linha possui dados inválidos.", AMBIGUOUS_CLIENT: "A correspondência de cliente precisa de revisão.",
  AMBIGUOUS_NUMBER: "Um valor numérico é ambíguo e precisa de revisão.", UNRESOLVED_RELATION: "Resolva as relações pendentes antes de confirmar.",
  BATCH_NOT_REVIEWED: "Resolva todos os conflitos bloqueantes antes de confirmar.", BATCH_ALREADY_COMMITTED: "Este lote já foi confirmado.",
  ROLLBACK_CONFLICT: "O lote possui edições posteriores e não pode ser desfeito integralmente.", FORBIDDEN: "Seu perfil não possui permissão para gerenciar importações.",
};

function importError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "";
  const match = Object.entries(IMPORT_ERRORS).find(([code]) => raw.includes(code));
  return new Error(match?.[1] ?? "A operação de importação não foi concluída.");
}

export async function listImportBatches(): Promise<ImportBatchListItem[]> {
  const { data, error } = await supabase.from("import_batches").select("id,status,adapter_version,original_filename,dry_run_summary,rollback_status,created_at,finished_at").order("created_at", { ascending: false }).limit(30);
  if (error) throw importError(error);
  return (data ?? []) as unknown as ImportBatchListItem[];
}

export async function uploadImport(file: File): Promise<{ batchId: string; status: string; summary: ImportSummary; duplicate: boolean; requestId: string }> {
  const body = new FormData(); body.append("file", file);
  const { data, error } = await supabase.functions.invoke("admin-imports", { body });
  if (error) {
    let raw: unknown = error;
    if ("context" in error && error.context instanceof Response) { try { raw = await error.context.clone().json(); } catch { /* resposta sem JSON */ } }
    throw importError(raw);
  }
  return data;
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
