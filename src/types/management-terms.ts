export type ManagementTermStatus = "active" | "expiring" | "ended" | "no_term" | "archived";

export interface ManagementTermItem {
  clientId: string;
  clientName: string;
  clientStatus: string;
  contractId: string | null;
  contractStatus: string | null;
  termStatus: ManagementTermStatus;
  startsOn: string | null;
  endsOn: string | null;
  totalDays: number | null;
  elapsedDays: number | null;
  remainingDays: number | null;
  progressPercent: number;
  savings: number;
  cashback: number;
  historicalSavings: number;
  historicalCashback: number;
  lastActivity: string | null;
}

export interface ManagementTermsResult {
  summary: { active: number; expiring: number; ended: number; noTerm: number; totalSavings: number; totalCashback: number };
  items: ManagementTermItem[];
  total: number;
  limit: number;
  offset: number;
  canVaultAccess: boolean;
}

export interface ManagementTermFilters {
  search?: string; termStatus?: string; clientStatus?: string; startFrom?: string; startTo?: string; endFrom?: string; endTo?: string;
  hasSavings?: boolean | null; hasCashback?: boolean | null; savingsMin?: number | null; savingsMax?: number | null;
  cashbackMin?: number | null; cashbackMax?: number | null; sortBy?: string; sortDirection?: "asc" | "desc"; limit?: number; offset?: number;
}
