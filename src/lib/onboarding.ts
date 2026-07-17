import type { OnboardingPayload } from "@/types/onboarding";

export const onboardingDefaultValues: OnboardingPayload = {
  personal: {
    fullName: "",
    cpf: "",
    rg: "",
    birthDate: "",
    email: "",
    whatsapp: "",
    maritalStatus: "single",
    address: { postalCode: "", state: "", city: "", neighborhood: "", street: "", number: "", complement: "" },
    hasChildren: false,
    childrenCount: 0,
    childrenNotes: "",
    profession: "",
    businessSector: "",
    preferredContactPeriod: "morning",
    preferredContactTime: "",
    referralSource: "",
    referralOther: "",
  },
  technical: {
    bestBank: "",
    pfCards: [],
    pfMonthlySpend: 0,
    hasPjCard: false,
    pjCards: [],
    pjMonthlySpend: 0,
    vipLoungeInterest: "want_to_understand",
    uberMonthlySpend: 0,
    ifoodMonthlySpend: 0,
    fuelMonthlySpend: 0,
    loyaltyAccounts: [
      { program: "Smiles", hasAccount: false, declaredPoints: 0, notes: "" },
      { program: "Azul Fidelidade", hasAccount: false, declaredPoints: 0, notes: "" },
      { program: "LATAM Pass", hasAccount: false, declaredPoints: 0, notes: "" },
      { program: "Livelo", hasAccount: false, declaredPoints: 0, notes: "" },
      { program: "Esfera", hasAccount: false, declaredPoints: 0, notes: "" },
    ],
  },
  goals: {
    preferredAirports: [],
    domesticTrips12m: 0,
    internationalTrips12m: 0,
    hasPlannedTrip: false,
    plannedTrips: [],
    frequentNationalDestinations: [],
    desiredDestinations: [],
    freeMonths: [],
    businessClassInterest: "depending",
    seatPriority: "lowest_price",
    preferredSeat: "indifferent",
    allInclusiveInterest: "maybe",
    previousTicketPurchaseMethods: [],
  },
  expectations: {
    priorities: [],
    serviceExpectations: "",
    privacyAcknowledged: false,
    marketingConsent: false,
  },
};

export function splitList(value: string): string[] {
  return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 30);
}

export function maskCpfInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function maskCepInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
}

export function parseMoneyInput(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
