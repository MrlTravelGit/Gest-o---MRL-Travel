export interface PublicClientProgram {
  slug: string;
  name: string;
  logoUrl: string | null;
  balance: number;
  averageCostPerThousand: number;
  estimatedValue: number;
  capturedAt: string | null;
  expiringPoints: number;
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

export interface PublicClientContract {
  startsOn: string;
  endsOn: string;
  status: string;
  planName: string | null;
  daysRemaining: number;
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
  contract?: PublicClientContract | null;
}

export interface AdminOverview {
  activeClients: number;
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
