export interface AdminAccountOption {
  accountId: string;
  programId: string;
  programName: string;
  balance: number;
}

export interface AdminClientOption {
  clientId: string;
  fullName: string;
  accounts: AdminAccountOption[];
}

export interface AdminFormOptions {
  canWrite: boolean;
  clients: AdminClientOption[];
}

export interface TravelSale {
  id: string;
  clientId: string;
  clientName: string;
  launchedOn: string;
  paymentMode: "cash" | "miles";
  travelType: "flight" | "hotel" | "other";
  details: string;
  originalValue: number;
  paidValue: number;
  savingsAmount: number;
  programName: string | null;
  pointsUsed: number | null;
}

export interface TravelSalesResult {
  items: TravelSale[];
  total: number;
  totalSavings: number;
  limit: number;
  offset: number;
}

export type TravelInterestStatus = "open" | "quoting" | "converted" | "cancelled";

export interface TravelInterest {
  id: string;
  clientId: string;
  clientName: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  details: string;
  status: TravelInterestStatus;
  createdAt: string;
}

export interface TravelInterestsResult {
  items: TravelInterest[];
  total: number;
  limit: number;
  offset: number;
}

export interface RankingItem {
  position: number;
  clientId: string;
  clientName: string;
  totalPoints: number;
  programsCount: number;
  expiring30: number;
  expiring60: number;
  expiring90: number;
  lastMovementAt: string | null;
  programs: Array<{ programName: string; balance: number }>;
}

export interface RankingResult {
  items: RankingItem[];
  total: number;
  limit: number;
  offset: number;
}
