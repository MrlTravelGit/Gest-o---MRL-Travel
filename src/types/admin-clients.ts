export type PointEntryCategory =
  | "initial_balance"
  | "points_purchase"
  | "transfer"
  | "credit_card"
  | "other";

export type ValuationMode = "total_value" | "per_thousand";

export interface AdminClientListItem {
  clientId: string;
  publicId: string;
  fullName: string;
  status: string;
  totalPoints: number;
  programsCount: number;
  activeClubsCount: number;
  nextExpirationDate: string | null;
  expiringPoints: number;
  lastMovementAt: string | null;
}

export interface AdminClientsResult {
  items: AdminClientListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminProgramDetail {
  programId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  accountId: string | null;
  balance: number;
  averageCostPerThousand: number;
  estimatedValue: number;
  marketValuePerThousand: number;
  clubActive: boolean;
  clubUpdatedAt: string | null;
  expiringPoints: number;
  nextExpirationDate: string | null;
  lastUpdatedAt: string | null;
}

export interface AdminPointTransaction {
  id: string;
  programId: string;
  programName: string;
  entryCategory: PointEntryCategory | null;
  entryDate: string | null;
  pointsAmount: number;
  cashTotal: number | null;
  costPerThousand: number | null;
  expiresOn: string | null;
  description: string;
  createdAt: string;
}

export interface AdminExpirationLot {
  id: string;
  programId: string;
  programName: string;
  expiresOn: string;
  pointsAmount: number;
  remainingPoints: number;
  status: string;
  notes: string | null;
  sourceTransactionId: string | null;
  createdAt: string;
}

export interface AdminClientPointsDetail {
  client: {
    id: string;
    publicId: string;
    fullName: string;
    status: string;
    contractStatus: string | null;
    totalPoints: number;
    estimatedValue: number;
    expiringPoints: number;
  };
  canWrite: boolean;
  programs: AdminProgramDetail[];
  transactions: AdminPointTransaction[];
  expirationLots: AdminExpirationLot[];
}

export interface RecordPointEntryInput {
  clientId: string;
  programId: string;
  entryCategory: PointEntryCategory;
  entryDate: string;
  pointsAmount: number;
  valuationMode: ValuationMode;
  enteredValue: number;
  expiresOn?: string;
  notes?: string;
  operationId: string;
}

export interface RecordPointEntryResult {
  transactionId: string;
  accountId: string;
  newBalance: number;
  newAverageCostPerThousand: number;
  cashTotal: number;
  costPerThousand: number;
  expirationLotId: string | null;
  idempotentReplay: boolean;
}

export interface AddExpirationLotInput {
  clientId: string;
  programId: string;
  pointsAmount: number;
  expiresOn: string;
  notes?: string;
}
