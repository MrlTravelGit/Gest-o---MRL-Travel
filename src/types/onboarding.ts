export type OnboardingStatus = "pending" | "in_progress" | "submitted" | "expired" | "revoked" | "reopened";

export interface OnboardingFormListItem {
  formId: string;
  clientId: string;
  clientName: string;
  status: OnboardingStatus;
  expiresAt: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  tokenHint: string | null;
  submissionId: string | null;
}

export interface OnboardingFormListResult {
  items: OnboardingFormListItem[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    pending: number;
    inProgress: number;
    submitted: number;
    expired: number;
  };
}

export interface CreateOnboardingFormResult {
  formId: string;
  token: string;
  path: string;
  expiresAt: string;
}

export interface PublicOnboardingMetadata {
  clientDisplayName: string;
  status: OnboardingStatus;
  expiresAt: string | null;
  submittedAt: string | null;
  formVersion: string;
  draft: Partial<OnboardingPayload>;
}

export interface OnboardingPayload {
  personal: {
    fullName: string;
    cpf: string;
    rg: string;
    birthDate: string;
    email: string;
    whatsapp: string;
    whatsappE164?: string;
    maritalStatus: string;
    address: {
      postalCode: string;
      state: string;
      city: string;
      neighborhood: string;
      street: string;
      number: string;
      complement: string;
    };
    hasChildren: boolean;
    childrenCount: number;
    childrenNotes: string;
    profession: string;
    businessSector: string;
    preferredContactPeriod: string;
    preferredContactTime: string;
    referralSource: string;
    referralOther: string;
  };
  technical: {
    bestBank: string;
    pfCards: OnboardingCardInput[];
    pfMonthlySpend: number;
    hasPjCard: boolean;
    pjCards: Array<Omit<OnboardingCardInput, "paysAnnualFee" | "annualFeeMonthly">>;
    pjMonthlySpend: number;
    vipLoungeInterest: string;
    uberMonthlySpend: number;
    ifoodMonthlySpend: number;
    fuelMonthlySpend: number;
    loyaltyAccounts: OnboardingLoyaltyInput[];
  };
  goals: {
    preferredAirports: string[];
    domesticTrips12m: number;
    internationalTrips12m: number;
    hasPlannedTrip: boolean;
    plannedTrips: OnboardingTripInput[];
    frequentNationalDestinations: string[];
    desiredDestinations: string[];
    freeMonths: string[];
    businessClassInterest: string;
    seatPriority: string;
    preferredSeat: string;
    allInclusiveInterest: string;
    previousTicketPurchaseMethods: string[];
  };
  expectations: {
    priorities: string[];
    serviceExpectations: string;
    privacyAcknowledged: boolean;
    marketingConsent: boolean;
  };
}

export interface OnboardingCardInput {
  bank: string;
  brand: string;
  product: string;
  paysAnnualFee: boolean;
  annualFeeMonthly: number;
}

export interface OnboardingLoyaltyInput {
  program: string;
  hasAccount: boolean;
  declaredPoints: number;
  notes: string;
}

export interface OnboardingTripInput {
  destination: string;
  approximateDate: string;
  notes: string;
}

export interface OnboardingDetail {
  form: OnboardingFormListItem;
  submission: Record<string, unknown> | null;
  cards: Array<Record<string, unknown>>;
  loyaltyAccounts: Array<Record<string, unknown>>;
  plannedTrips: Array<Record<string, unknown>>;
  divergences: Array<Record<string, unknown>>;
  events: Array<{ eventType: string; createdAt: string }>;
}
