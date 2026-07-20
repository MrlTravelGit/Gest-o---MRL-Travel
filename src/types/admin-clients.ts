export type PointEntryCategory =
  | "initial_balance"
  | "points_purchase"
  | "transfer"
  | "credit_card"
  | "other";

export type ValuationMode = "total_value" | "per_thousand";

export interface AdminClientListItem {
  id: string;
  clientId: string;
  publicId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  contract: {
    startsOn: string | null;
    endsOn: string | null;
    status: string | null;
    planName: string | null;
  } | null;
  pointsBalance: number;
  totalPoints: number;
  generatedSavings: number;
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

export interface OnboardingLeadReview {
  submission: {
    id: string;
    status: string;
    duplicate_reason: string | null;
    duplicate_candidate_client_id: string | null;
    full_name: string;
    email: string | null;
    whatsapp_e164: string | null;
    cpf_last4: string | null;
    submitted_at: string | null;
    lead_created_at: string | null;
    best_bank: string | null;
    pf_monthly_spend: number | null;
    service_expectations: string | null;
  } | null;
  cards: Array<Record<string, unknown>>;
  loyaltyAccounts: Array<Record<string, unknown>>;
  plannedTrips: Array<Record<string, unknown>>;
}

export interface ActivateOnboardingLeadInput {
  clientId: string;
  startsOn: string;
  endsOn: string;
  planName: string;
  notes?: string;
}

export interface ActivateOnboardingLeadResult {
  ok: boolean;
  alreadyActive: boolean;
  client: { id: string; status: string; fullName: string };
  contract: { id: string; startsOn: string; endsOn: string; status: string; planName: string };
  submission?: { id: string; status: string };
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
