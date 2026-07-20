export interface ImportSummary {
  adapterVersion: string;
  files: number;
  canonical: { clients: number; tasks: number; programs: number; onboardings: number; passages: number };
  taskRelations: { linked: number; needsDecision: number };
  conflicts: number;
  invalid: number;
  ignoredFilteredFiles: number;
  officialBalancesCreatedByDefault: number;
  committed?: { createdClients: number; createdTasks: number; linkedExisting: number; skipped: number };
}

export interface ImportBatchListItem {
  id: string;
  status: string;
  adapter_version: string;
  original_filename: string;
  dry_run_summary: ImportSummary;
  rollback_status: string;
  created_at: string;
  finished_at: string | null;
}

export interface ImportPreviewRow {
  rowId: string;
  rowNumber: number;
  entityType: "client" | "task" | "onboarding" | "program" | "passage";
  sourceExternalId: string | null;
  preview: { title?: string; fullName?: string; clientLabel?: string; status?: string; priority?: string; category?: string; programName?: string };
  validationStatus: "valid" | "warning" | "invalid";
  resolutionStatus: string;
  targetId: string | null;
  issues: Array<{ severity: "info" | "warning" | "error"; code: string; fieldName?: string; message: string; resolution?: Record<string, unknown> }>;
}

export interface ImportBatchDetail {
  batch: { batchId: string; status: string; sourceSystem: string; adapterVersion: string; originalFilename: string; summary: ImportSummary; createdAt: string; finishedAt: string | null; rollbackStatus: string; requestId: string };
  files: Array<{ fileId: string; logicalType: string; path: string; rowCount: number; encoding: string; delimiter: string | null; isCanonical: boolean; ignoredReason: string | null }>;
  rows: ImportPreviewRow[];
  canManage: boolean;
}
