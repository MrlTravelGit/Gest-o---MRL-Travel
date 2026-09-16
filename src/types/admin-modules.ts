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

export interface TransferProgram {
  id: string;
  slug: string;
  name: string;
  category: "bancos" | "programas_aereos" | "outros";
  programType: "financial_points_program" | "loyalty_program";
  logoUrl: string | null;
  conversionLabel: string | null;
  supportsPointsLaunch: boolean;
  supportsBonusTransfer: boolean;
  isTransferSource: boolean;
  isTransferTarget: boolean;
  isActive: boolean;
}

export interface BonusTransferCampaign {
  id: string;
  sourceProgramId: string;
  sourceProgramName: string;
  targetProgramId: string;
  targetProgramName: string;
  bonusPercentage: number;
  startsAt: string;
  endsAt: string;
  minimumPoints: number | null;
  maximumPoints: number | null;
  rulesSummary: string;
  officialUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BonusTransferAdminData {
  canWrite: boolean;
  programs: TransferProgram[];
  campaigns: BonusTransferCampaign[];
}

export interface MileageSimulation {
  id: string;
  clientId: string | null;
  clientName: string | null;
  sourceProgramId: string;
  sourceProgramName: string;
  targetProgramId: string;
  targetProgramName: string;
  totalPoints: number;
  pointsUsed: number;
  cashAmount: number;
  bonusPercent: number;
  pixDiscountPercent: number | null;
  clubActive: boolean;
  finalCostPerThousand: number;
  finalCostPerThousandWithPix: number | null;
  rating: "excellent" | "good" | "attention" | "expensive";
  notes: string | null;
  simulatedAt: string;
  createdByName: string | null;
}

export interface MileageCalculatorAdminData {
  canWrite: boolean;
  clients: Array<{ clientId: string; fullName: string }>;
  programs: TransferProgram[];
  simulations: MileageSimulation[];
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
  sourceSystem: string | null;
  sourceBatchKey: string | null;
  migrated: boolean;
  updatedAt: string;
  cashbackPercentage: number | null;
  cashbackAmount: number;
  cashbackBaseType: "paid_amount" | null;
  cashbackBaseAmount: number | null;
  cashbackCalculationVersion: string | null;
  hasEvidence: boolean;
  status: "active" | "voided";
  deletedAt?: string | null;
  deletedBy?: string | null;
  deletionReason?: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  operationGroupId: string;
}

export interface TravelSalesResult {
  items: TravelSale[];
  total: number;
  totalSavings: number;
  totalCashback: number;
  limit: number;
  offset: number;
  ranking: Array<{ position: number; clientId: string; clientName: string; totalSavings: number; records: number }>;
  pendingReconciliation: number;
  canWrite: boolean;
  selectedClientCashback: { enabled: boolean; defaultPercentage: number | null; summary: CashbackSummary } | null;
}

export interface CashbackSummary { generated: number; used: number; paid: number; reversed: number; adjusted: number; available: number }
export interface CashbackTransaction { id: string; type: "earning" | "redemption" | "reversal" | "adjustment"; amount: number; status: string; description: string; redemptionId: string | null; reversedTransactionId: string | null; createdAt: string; operationGroupId: string; visibilityScope: "public" | "admin_only"; originKind: string; redemptionMode: "usage" | "payment" | null }
export interface ClientCashbackState {
  config: { enabled: boolean; defaultPercentage: number | null; enabledAt: string | null; enabledBy: string | null; updatedAt: string | null; updatedBy: string | null };
  summary: CashbackSummary;
  transactions: CashbackTransaction[];
  canManage: boolean;
}

export interface CashbackFormulaReconciliationItem {
  reconciliationKey: string;
  redemptionId: string;
  clientId: string;
  clientName: string;
  description: string;
  originalAmount: number;
  paidAmount: number;
  savingsAmount: number;
  cashbackPercentage: number;
  previousCashbackAmount: number;
  correctCashbackAmount: number;
  differenceAmount: number;
  allocatedAmount: number;
  availableAmount: number;
  action: "replace" | "adjustment" | "review";
  reviewReason: string | null;
}

export interface CashbackFormulaReconciliationPreview {
  formulaVersion: "paid_amount_v1";
  confirmationKey: string;
  candidateCount: number;
  replaceCount: number;
  adjustmentCount: number;
  reviewCount: number;
  totals: { previousCashback: number; correctCashback: number; difference: number };
  preserved: { legacySavingsCount: number; legacySavingsTotal: number; pointsTotal: number };
  items: CashbackFormulaReconciliationItem[];
  canApply: boolean;
}

export interface CashbackFormulaReconciliationResult {
  formulaVersion: "paid_amount_v1";
  candidateCount: number;
  applied: number;
  replaced: number;
  adjusted: number;
  review: number;
  newMovements: number;
  totals: { reversed: number; credited: number; adjusted: number };
  alreadyReconciled: number;
  remainingCandidates: number;
}

export interface IddasSavingsImportRow {
  rowId: string | null;
  sourceRowNumber: number;
  legacyPersonId: number | null;
  legacyName: string;
  eventDate: string;
  description: string;
  originalValue: number;
  paidValue: number;
  savingsValue: number;
  externalKey: string;
  clientId: string | null;
  clientName: string | null;
  clientStatus: string | null;
  matchMethod: string | null;
  status: "pending" | "ready" | "committed" | "conflict" | null;
  issueCode: string | null;
  reason: string | null;
  decisionReason: string | null;
  redemptionId: string | null;
  migrated: boolean;
}

export interface IddasSavingsImportState {
  batch: { batchId: string; status: string; createdAt: string; finishedAt: string | null; summary: Record<string, unknown> } | null;
  sourceSummary: { rows: number; people: number; originalValue: number; paidValue: number; savingsValue: number; zeroSavings: number };
  counts: { ready: number; committed: number; pending: number; conflict: number };
  appliedSummary: { rows: number; originalValue: number; paidValue: number; savingsValue: number };
  rows: IddasSavingsImportRow[];
  clientOptions: Array<{ clientId: string; fullName: string; status: string }>;
  canManage: boolean;
}

export type TravelInterestStatus = "waiting" | "in_progress" | "completed" | "cancelled";
export type TravelInterestPriority = "low" | "normal" | "high" | "urgent";

export interface TravelInterestStatusHistory {
  id: string;
  previousStatus: TravelInterestStatus | null;
  newStatus: TravelInterestStatus;
  note: string | null;
  changedBy: string | null;
  changedAt: string;
}

export interface TravelInterest {
  id: string;
  clientId: string;
  clientName: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  details: string;
  status: TravelInterestStatus;
  priority: TravelInterestPriority;
  publicVisible: boolean;
  publicNote: string | null;
  internalNote: string | null;
  nextActionOn: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory: TravelInterestStatusHistory[];
}

export interface TravelInterestsResult {
  items: TravelInterest[];
  counts: { all: number; waiting: number; inProgress: number; completed: number; cancelled: number };
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
  slug?: string;
  productFamily?: string;
  priceQualifier?: "fixed" | "from" | "promotional";
  joiningBonusPoints?: number;
  minimumTransferPoints?: number | null;
  purchasePointsDiscountPercent?: number | null;
  monthlyPurchasePointsLimit?: number | null;
  reviewStatus?: "reviewed" | "needs_review" | "archived";
  catalogVersion?: number;
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
  institutionId?: string | null;
  issuer?: string;
  label: string;
  basis: "brl" | "usd" | null;
  pointsPerUnit: number | null;
  catalogVersionId?: string | null;
  cardSlug?: string | null;
  calculationReady?: boolean;
  requiresReview?: boolean;
}

export interface CardStatementOptions {
  clients: Array<{ clientId: string; fullName: string }>;
  institutions: Array<{ institutionId: string; name: string; logoUrl: string | null }>;
  cards: CardStatementOption[];
}

export interface CardStatement {
  statementId: string;
  clientId: string;
  clientName: string;
  institutionId: string | null;
  institutionName: string | null;
  accountPersonType: "PF" | "PJ" | null;
  cardId: string | null;
  cardLabel: string | null;
  statementMonth: string;
  totalSpend: number;
  eligibleSpend: number;
  domesticAmount: number | null;
  internationalAmount: number | null;
  earningBasis: "brl" | "usd";
  earningRate: number;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
  expectedPoints: number | null;
  predictedPoints: number | null;
  receivedPoints: number;
  difference: number | null;
  predictionStatus: "pending_card" | "pending_breakdown" | "calculated" | "outdated" | "confirmed" | "not_applicable";
  status: string;
  notes: string | null;
  ruleSnapshot: Record<string, unknown>;
  calculationDetails?: Record<string, unknown>;
  calculationVersion?: string | null;
  calculatedAt?: string | null;
  calculationRuleId?: string | null;
  linkStatus?: "pending" | "linked";
  cardSlug?: string | null;
  catalogVersion?: number | null;
}

export type CardRuleUnit = "points_per_usd" | "points_per_brl" | "one_point_per_brl_amount";
export type CardSourceQuality = "official_exact" | "official_up_to" | "official_conditional";

export interface CardCatalogRule {
  ruleId: string;
  scope: string;
  unitType: CardRuleUnit;
  rate: number | null;
  denominator: number | null;
  spendLocation: "domestic" | "international" | "any";
  merchantScope: "any" | "airline" | "program_partner" | "streaming" | "custom";
  merchantMatch: string | null;
  minimumStatementAmount: number | null;
  maximumStatementAmount: number | null;
  relationshipCondition: string | null;
  clubCondition: string | null;
  acceleratorCondition: boolean | null;
  rewardModeCondition: string | null;
  automaticDebitCondition: boolean | null;
  calculationEnabled: boolean;
  requiresReview: boolean;
  priority: number;
  validFrom: string;
  validUntil: string | null;
}

export interface CardCatalogItem {
  catalogVersionId: string;
  cardSlug: string;
  version: number;
  issuer: string;
  cardName: string;
  cardVariant: string | null;
  brand: string | null;
  rewardsProgram: string;
  sourceUrl: string;
  sourceCheckedAt: string;
  validFrom: string;
  validUntil: string | null;
  sourceQuality: CardSourceQuality;
  calculationEnabled: boolean;
  requiresReview: boolean;
  reviewNotes: string | null;
  active: boolean;
  rules: CardCatalogRule[];
}

export interface CardCatalogResult {
  items: CardCatalogItem[];
  filters: { issuers: string[]; programs: string[] };
}

export interface ClientCatalogCard {
  cardId: string;
  clientId: string;
  catalogVersionId: string;
  cardSlug: string;
  version: number;
  issuer: string;
  cardName: string;
  variant: string | null;
  brand: string | null;
  rewardsProgram: string;
  lastFour: string | null;
  startedOn: string;
  endedOn: string | null;
  ownership: "holder" | "additional";
  rewardMode: "points" | "cashback";
  relationshipCondition: string | null;
  clubCondition: string | null;
  eliteCategoryCondition: string | null;
  acceleratorActive: boolean;
  automaticDebitActive: boolean;
  hasCustomRate: boolean;
  customRate: number | null;
  active: boolean;
  calculationReady: boolean;
  requiresReview: boolean;
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
  linkId?: string;
  clientId?: string;
  clientName?: string;
  status?: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  createdAt: string;
  revokedAt: string | null;
  hasActiveLink?: boolean;
  recoverable?: boolean;
  requiresRotation?: boolean;
  url?: string | null;
}
