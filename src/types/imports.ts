export interface ImportSummary {
  adapterVersion: string;
  files: number;
  canonical: { clients: number; tasks: number; programs: number; onboardings: number; passages: number };
  taskRelations: { linked: number; needsDecision: number };
  conflicts: number;
  invalid: number;
  ignoredFilteredFiles: number;
  officialBalancesCreatedByDefault: number;
  blockingRows?: number;
  byState?: Record<string, number>;
  balancePreview?: { initialBalances: number; equalBalances: number; divergences: number; zeroWallets: number; ledgerPoints: number; patrimony: number };
  committed?: { createdClients: number; createdTasks: number; walletsReconciled: number; ledgerEntries: number; importedPoints: number; importedPatrimony: number };
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
  blocksCommit: boolean;
  suggestedAction: string | null;
  chosenAction: string | null;
  targetId: string | null;
  issues: Array<{ severity: "info" | "warning" | "error" | "fatal"; code: string; fieldName?: string; message: string; resolution?: Record<string, unknown> }>;
}

export interface ImportBalanceReconciliation {
  reconciliationId: string; rowId: string; clientId: string | null; clientSourceSuffix: string | null; programId: string | null;
  currentPoints: number; importedPoints: number; differencePoints: number; costPerThousand: number; estimatedValue: number;
  expiringPoints: number; expiresOn: string | null; suggestedAction: string; chosenAction: string | null; decisionReason: string | null; status: string;
}

export interface ImportBatchDetail {
  batch: { batchId: string; status: string; sourceSystem: string; adapterVersion: string; originalFilename: string; summary: ImportSummary; createdAt: string; finishedAt: string | null; rollbackStatus: string; requestId: string };
  files: Array<{ fileId: string; logicalType: string; path: string; rowCount: number; encoding: string; delimiter: string | null; isCanonical: boolean; ignoredReason: string | null }>;
  rows: ImportPreviewRow[];
  balances: ImportBalanceReconciliation[];
  canManage: boolean;
}

export type IddasBackfillAction = "insert" | "already_conciliated" | "conflict" | "client_not_found" | "ambiguous_client" | "program_not_found";

export interface IddasBackfillPreview {
  sourceKey: "iddas_html_saldos_20260721_v1";
  batchId: string;
  status: string;
  canCommit: boolean;
  canRollback: boolean;
  summary: {
    expectedClients: number; matchedClients: number; expectedAccounts: number; accounts: number;
    points: number; bookValue: number; toInsert: number; alreadyConciliated: number;
    conflicts: number; notFound: number; currentPoints: number;
  };
  clients: Array<{
    legacyPersonId: number; targetName: string; clientId: string | null; systemName: string | null;
    status: string | null; accounts: number; points: number; bookValue: number; hasBlocker: boolean;
  }>;
  rows: Array<{
    idempotencyKey: string; legacyPersonId: number; targetName: string; legacyName: string;
    clientId: string | null; systemName: string | null; clientStatus: string | null;
    programSlug: string; programName: string | null; accountId: string | null;
    currentPoints: number; sourcePoints: number; costPerThousand: number; bookValue: number;
    action: IddasBackfillAction;
  }>;
  expectedByProgram: Array<{ programSlug: string; programName: string; accounts: number; points: number; bookValue: number }>;
  idempotentReplay?: boolean;
  newTransactions?: number;
  succeededClients?: number;
  failedClients?: number;
  failures?: Array<{ legacyPersonId: number; code: string }>;
}
