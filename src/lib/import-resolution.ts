import type { ImportPreviewRow } from "@/types/imports";

export const BLOCKING_IMPORT_STATES = new Set(["pending_decision", "blocked_invalid"]);

export function isImportRowBlocking(row: Pick<ImportPreviewRow, "resolutionStatus" | "blocksCommit">): boolean {
  return row.blocksCommit || BLOCKING_IMPORT_STATES.has(row.resolutionStatus);
}

export function countBlockingImportRows(rows: Array<Pick<ImportPreviewRow, "rowId" | "resolutionStatus" | "blocksCommit">>): number {
  return new Set(rows.filter(isImportRowBlocking).map((row) => row.rowId)).size;
}

export function filterImportConflicts<T extends Pick<ImportPreviewRow, "resolutionStatus" | "blocksCommit">>(rows: T[], onlyConflicts: boolean): T[] {
  return onlyConflicts ? rows.filter(isImportRowBlocking) : rows;
}
