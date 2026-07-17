export type OnboardingStatus =
  | "pending"
  | "in_progress"
  | "submitted"
  | "expired"
  | "revoked"
  | "reopened"
  | "published"
  | "paused"
  | "received"
  | "client_created"
  | "duplicate_review"
  | "reviewed"
  | "activated"
  | "rejected";

export interface OnboardingPublication {
  hasPublication: boolean;
  publicationId?: string;
  publicKeySuffix?: string;
  status: string;
  url: string | null;
  formVersion?: string;
  publishedAt?: string | null;
  pausedAt?: string | null;
  createdAt?: string;
}

export interface OnboardingSubmissionListItem {
  id: string;
  publication_id: string;
  client_id: string | null;
  status: OnboardingStatus;
  duplicate_candidate_client_id: string | null;
  duplicate_reason: string | null;
  full_name: string;
  email: string;
  whatsapp_e164: string;
  phoneMasked: string | null;
  cpf_last4: string | null;
  submitted_at: string;
  lead_created_at: string | null;
  client: { id: string; full_name: string; status: string } | null;
}

export interface LegacyOnboardingForm {
  id: string;
  client_id: string;
  status: string;
  created_at: string;
  submitted_at: string | null;
  expires_at: string | null;
  token_hint: string | null;
}

export interface OnboardingOverview {
  publication: OnboardingPublication;
  submissions: OnboardingSubmissionListItem[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    received: number;
    awaitingReview: number;
    clientsCreated: number;
    duplicates: number;
    activated: number;
  };
  legacyForms: LegacyOnboardingForm[];
}

export interface PublicOnboardingMetadata {
  mode: "public_entry" | "legacy_client_invite";
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
  submission: Record<string, unknown>;
  client: Record<string, unknown> | null;
  cards: Array<Record<string, unknown>>;
  loyaltyAccounts: Array<Record<string, unknown>>;
  plannedTrips: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}
