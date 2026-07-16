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

export interface ClubPlan {
  planId: string;
  programId: string;
  programName: string;
  code: string;
  name: string;
  monthlyPoints: number;
  qualifyingPoints: number;
  billingPeriod: string;
  validityMonths: number | null;
  pointsDoNotExpire: boolean;
  informativePrice: number | null;
  currency: string;
  status: string;
  sourceUrl: string;
  sourceVerifiedOn: string;
  sourceNotes: string | null;
  benefits: Array<{ title: string; type: string; description: string; numericValue: number | null; unit: string | null; rule: Record<string, unknown> }>;
}

export interface ClubSubscription {
  subscriptionId: string;
  clientId: string;
  clientName: string;
  accountId: string;
  programName: string;
  planId: string;
  planName: string;
  monthlyPoints: number;
  status: "active" | "paused" | "cancelled";
  startsOn: string;
  endsOn: string | null;
  expectedCreditDay: number;
  nextCompetence: string;
  notes: string | null;
  credits: Array<{ creditId: string; competence: string; expectedPoints: number; expectedCreditOn: string; status: string; transactionId: string | null }>;
}

export interface ClubCatalogResult {
  plans: ClubPlan[];
  tiers: Array<{ tierId: string; programId: string; name: string; requirements: Record<string, unknown>; benefitsDescription: string; sourceUrl: string; sourceVerifiedOn: string }>;
}

export interface ClubSubscriptionsResult {
  items: ClubSubscription[];
  total: number;
  limit: number;
  offset: number;
}

export interface CardStatementOption {
  cardId: string;
  clientId: string;
  label: string;
  basis: "brl" | "usd" | null;
  pointsPerUnit: number | null;
}

export interface CardStatementOptions {
  clients: Array<{ clientId: string; fullName: string }>;
  cards: CardStatementOption[];
}

export interface CardStatement {
  statementId: string;
  clientId: string;
  clientName: string;
  cardId: string;
  cardLabel: string;
  statementMonth: string;
  totalSpend: number;
  eligibleSpend: number;
  earningBasis: "brl" | "usd";
  earningRate: number;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
  expectedPoints: number;
  receivedPoints: number;
  difference: number;
  status: string;
  notes: string | null;
  ruleSnapshot: Record<string, unknown>;
}

export interface CardStatementsResult {
  items: CardStatement[];
  total: number;
  limit: number;
  offset: number;
}

export interface PointMovement {
  transactionId: string;
  clientId: string;
  clientName: string;
  accountId: string;
  programId: string;
  programName: string;
  occurredAt: string;
  transactionType: string;
  direction: "in" | "out";
  pointsDelta: number;
  source: string;
  description: string;
  status: string;
  originId: string | null;
  createdBy: string | null;
  createdAt: string;
  reversalOfTransactionId: string | null;
  correctionReason: string | null;
  correctedBy: string | null;
  correctedAt: string | null;
}

export interface PointMovementsResult {
  items: PointMovement[];
  total: number;
  limit: number;
  offset: number;
}

export interface DirectAccessLink {
  linkId: string;
  clientId: string;
  clientName: string;
  status: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  createdAt: string;
  revokedAt: string | null;
}
