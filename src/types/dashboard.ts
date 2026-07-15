export interface DashboardProgram {
  accountId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  balance: number;
  averageCostPerThousand: number;
  estimatedValue: number;
  capturedAt: string | null;
  expiringPoints: number;
}

export interface BalanceHistoryPoint {
  month: string;
  balance: number;
}

export interface CardStatementPoint {
  month: string;
  totalSpend: number;
  eligibleSpend: number;
  expectedPoints: number;
  receivedPoints: number;
  divergence: number;
}

export interface ClientDashboard {
  client: {
    id: string;
    publicId: string;
    fullName: string;
    lastUpdatedAt: string | null;
  };
  summary: {
    totalPoints: number;
    estimatedPatrimony: number;
    generatedSavings: number;
    redemptionsCount: number;
    expiringIn90Days: number;
  };
  programs: DashboardProgram[];
  balanceHistory: BalanceHistoryPoint[];
  cardStatements: CardStatementPoint[];
  contract: null | {
    startsOn: string;
    endsOn: string;
    status: string;
    planName: string | null;
    daysRemaining: number;
  };
}

export interface AdminOverview {
  activeClients: number;
  managedPoints: number;
  generatedSavings: number;
  expiringIn30Days: number;
  contractsEndingIn30Days: number;
  openTasks: number;
}
