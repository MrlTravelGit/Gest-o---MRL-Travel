export interface ClientEconomyItem {
  id: string;
  issuedAt: string;
  launchedOn: string | null;
  travelType: string;
  paymentMode: string | null;
  details: string;
  originalValue: number;
  paidValue: number;
  savingsAmount: number;
  programName: string | null;
  pointsUsed: number | null;
}

export interface ClientEconomy {
  client: {
    id: string;
    fullName: string;
    lastUpdatedAt: string | null;
  };
  summary: {
    generatedSavings: number;
    redemptionsCount: number;
    positiveSavingsCount: number;
  };
  items: ClientEconomyItem[];
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
