export interface PublicClientProgram {
  slug: string;
  name: string;
  logoUrl: string | null;
  balance: number;
  averageCostPerThousand: number;
  estimatedValue: number;
  capturedAt: string | null;
  expiringPoints: number;
  catalogActive?: boolean;
  hasMovements?: boolean;
  clubActive?: boolean;
  clubExpiresAt?: string | null;
  linkedAccount?: boolean;
  accountStatus?: string | null;
}

export interface PublicClientBalanceHistoryPoint {
  month: string;
  balance: number;
  averageCostPerThousand?: number;
}

export interface PublicClientMonthlyMovement {
  month: string;
  points: number;
}

export interface PublicClientCardStatement {
  month: string;
  totalSpend: number;
  eligibleSpend: number;
  expectedPoints: number;
  receivedPoints: number;
  divergence: number;
}

export interface PublicClientSaving {
  id: string;
  date: string;
  description: string;
  originalValue: number;
  paidValue: number;
  savingsValue: number;
  travelType: "flight" | "hotel" | "other";
  migrated: boolean;
  cashbackPercentage: number | null;
  cashbackAmount: number;
  cashbackBaseType: "paid_amount" | null;
  cashbackBaseAmount: number | null;
  cashbackCalculationVersion: string | null;
  hasEvidence: boolean;
  deletedAt?: string | null;
  status?: string | null;
}

export interface PublicClientCashback {
  enabled: boolean;
  availableBalance: number;
  totalGenerated?: number;
  totalRedeemed?: number;
  notice: string | null;
  summary: { generated: number; used: number; paid?: number; reversed: number; adjusted: number; available: number };
  transactions: Array<{ id: string; type: "earning" | "redemption" | "reversal" | "adjustment"; amount: number; description: string; redemptionId: string | null; createdAt: string }>;
}

export interface PublicClientContract {
  startsOn: string;
  endsOn: string | null;
  status: string;
  planName: string | null;
  daysRemaining: number | null;
}

export interface PublicTravelInterest {
  id: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  status: "waiting" | "in_progress" | "completed";
  statusLabel: string;
  publicNote: string | null;
  updatedAt: string;
}

export interface PublicClientDashboard {
  client: {
    displayName: string;
    lastUpdatedAt: string | null;
  };
  summary: {
    totalPoints: number;
    estimatedPatrimony: number;
    generatedSavings: number;
    redemptionsCount: number;
    expiringIn90Days: number;
  };
  programs: PublicClientProgram[];
  balanceHistory: PublicClientBalanceHistoryPoint[];
  monthlyMovements: PublicClientMonthlyMovement[];
  cardStatements?: PublicClientCardStatement[];
  savingsHistory?: PublicClientSaving[];
  cashback?: PublicClientCashback | null;
  contract?: PublicClientContract | null;
  travelInterests?: PublicTravelInterest[];
}

export interface AdminOverview {
  activeClients: number;
  pendingLeads?: number;
  managedPoints: number;
  generatedSavings: number;
  expiringIn30Days: number;
  contractsEndingIn30Days: number;
  openTasks: number;
  openInterests: number;
  transfersCount: number;
  operatorName: string;
  role: "super_admin" | "manager" | "operator" | "auditor";
  canWrite: boolean;
  canArchive: boolean;
}
