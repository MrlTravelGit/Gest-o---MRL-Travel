import { z } from "npm:zod@3.25.76";
import { sha256Hex } from "./client-link.ts";

const text = (min = 1, max = 200) => z.string().trim().min(min).max(max);
const optionalText = (max = 500) => z.string().trim().max(max).optional().default("");
const money = z.number().finite().min(0).max(10_000_000).default(0);
const nonNegativeInt = z.number().int().min(0).max(999).default(0);

const cardSchema = z.object({
  bank: text(1, 120),
  brand: text(1, 80),
  product: text(1, 160),
  paysAnnualFee: z.boolean().optional().default(false),
  annualFeeMonthly: money.optional().default(0),
}).strict();

const loyaltySchema = z.object({
  program: text(1, 80),
  hasAccount: z.boolean().default(false),
  declaredPoints: z.number().int().min(0).max(500_000_000).default(0),
  notes: optionalText(500),
}).strict();

const tripSchema = z.object({
  destination: text(2, 160),
  approximateDate: optionalText(80),
  notes: optionalText(800),
}).strict();

export const onboardingPayloadSchema = z.object({
  personal: z.object({
    fullName: text(3, 180),
    cpf: z.string().transform(onlyDigits).refine(isValidCpf, "CPF inválido"),
    rg: text(3, 40),
    birthDate: z.string().refine(isPastDate, "Data inválida"),
    email: z.string().trim().email().max(180).transform((value) => value.toLowerCase()),
    whatsapp: z.string().transform(normalizePhoneE164).refine((value) => value.length >= 12 && value.length <= 14, "WhatsApp inválido"),
    whatsappE164: z.string().optional(),
    maritalStatus: z.enum(["single", "married", "stable_union", "divorced", "widowed", "prefer_not_to_say"]),
    address: z.object({
      postalCode: z.string().transform(onlyDigits).refine((value) => value.length === 8, "CEP inválido"),
      state: text(2, 2).transform((value) => value.toUpperCase()),
      city: text(2, 120),
      neighborhood: text(1, 120),
      street: text(2, 160),
      number: text(1, 30),
      complement: optionalText(120),
    }).strict(),
    hasChildren: z.boolean().default(false),
    childrenCount: nonNegativeInt.optional().default(0),
    childrenNotes: optionalText(500),
    profession: text(2, 120),
    businessSector: optionalText(160),
    preferredContactPeriod: z.enum(["morning", "afternoon", "night", "custom"]),
    preferredContactTime: optionalText(80),
    referralSource: text(2, 120),
    referralOther: optionalText(160),
  }).strict(),
  technical: z.object({
    bestBank: text(2, 120),
    pfCards: z.array(cardSchema).max(12).default([]),
    pfMonthlySpend: money,
    hasPjCard: z.boolean().default(false),
    pjCards: z.array(cardSchema.omit({ paysAnnualFee: true, annualFeeMonthly: true })).max(12).default([]),
    pjMonthlySpend: money.default(0),
    vipLoungeInterest: z.enum(["yes", "no", "want_to_understand"]),
    uberMonthlySpend: money.default(0),
    ifoodMonthlySpend: money.default(0),
    fuelMonthlySpend: money.default(0),
    loyaltyAccounts: z.array(loyaltySchema).max(12).default([]),
  }).strict(),
  goals: z.object({
    preferredAirports: z.array(text(2, 80)).max(20).default([]),
    domesticTrips12m: nonNegativeInt,
    internationalTrips12m: nonNegativeInt,
    hasPlannedTrip: z.boolean().default(false),
    plannedTrips: z.array(tripSchema).max(12).default([]),
    frequentNationalDestinations: z.array(text(2, 120)).max(30).default([]),
    desiredDestinations: z.array(text(2, 120)).max(30).default([]),
    freeMonths: z.array(z.enum(["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"])).max(12).default([]),
    businessClassInterest: z.enum(["yes", "no", "depending"]),
    seatPriority: z.enum(["lowest_price", "together", "more_space", "front", "other"]),
    preferredSeat: z.enum(["window", "aisle", "indifferent", "extra_space"]),
    allInclusiveInterest: z.enum(["yes", "no", "maybe"]),
    previousTicketPurchaseMethods: z.array(z.enum(["airline_site", "agency", "app", "comparator", "miles", "other"])).max(8).default([]),
  }).strict(),
  expectations: z.object({
    priorities: z.array(z.enum(["savings", "comfort", "convenience", "flexibility", "service", "travel_support", "benefits", "travel_more", "other"])).min(1).max(9),
    serviceExpectations: text(20, 2000),
    privacyAcknowledged: z.literal(true),
    marketingConsent: z.boolean().default(false),
  }).strict(),
}).strict().superRefine((data, ctx) => {
  if (data.personal.hasChildren && data.personal.childrenCount < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["personal", "childrenCount"], message: "Informe a quantidade de filhos." });
  }
  if (data.technical.hasPjCard && data.technical.pjCards.length < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["technical", "pjCards"], message: "Adicione ao menos um cartão PJ." });
  }
  if (data.goals.hasPlannedTrip && data.goals.plannedTrips.length < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["goals", "plannedTrips"], message: "Adicione ao menos uma viagem planejada." });
  }
});

export type OnboardingPayload = z.infer<typeof onboardingPayloadSchema>;

export function normalizePayload(payload: OnboardingPayload): OnboardingPayload {
  return {
    ...payload,
    personal: {
      ...payload.personal,
      cpf: onlyDigits(payload.personal.cpf),
      email: payload.personal.email.trim().toLowerCase(),
      whatsapp: normalizePhoneE164(payload.personal.whatsapp),
      whatsappE164: normalizePhoneE164(payload.personal.whatsapp),
      rg: payload.personal.rg.trim(),
    },
  };
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isPastDate(value: string): boolean {
  const date = new Date(value);
  return value.length >= 10 && !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (base: string, factor: number) => {
    const sum = [...base].reduce((total, digit) => total + Number(digit) * factor--, 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(cpf.slice(0, 9), 10) === Number(cpf[9]) && calc(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

export function normalizePhoneE164(value: string): string {
  const digits = onlyDigits(value);
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 11) return `+55${digits}`;
  return `+${digits}`;
}

export function publicSafeDraft(payload: OnboardingPayload): Record<string, unknown> {
  const safe = structuredClone(payload) as Record<string, unknown>;
  const personal = safe.personal as Record<string, unknown>;
  personal.cpf = maskCpf(String(personal.cpf ?? ""));
  personal.rg = personal.rg ? "[protegido]" : "";
  return safe;
}

export function redactDraftPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const safe = structuredClone(payload) as Record<string, unknown>;
  const personal = safe.personal;
  if (personal && typeof personal === "object" && !Array.isArray(personal)) {
    const personalRecord = personal as Record<string, unknown>;
    if (typeof personalRecord.cpf === "string") personalRecord.cpf = maskCpf(personalRecord.cpf);
    if (typeof personalRecord.rg === "string" && personalRecord.rg.trim()) personalRecord.rg = "[protegido]";
  }
  return safe;
}

export function maskCpf(value: string): string {
  const digits = onlyDigits(value);
  return digits.length === 11 ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**` : "***";
}

export async function protectSensitivePayload(payload: OnboardingPayload): Promise<Record<string, string>> {
  const piiKey = Deno.env.get("ONBOARDING_PII_KEY");
  const piiPepper = Deno.env.get("ONBOARDING_PII_HASH_PEPPER") ?? piiKey;
  if (!piiKey || piiKey.length < 24) throw new Error("CONFIG_MISSING");
  if (!piiPepper || piiPepper.length < 24) throw new Error("CONFIG_MISSING");

  const cpf = onlyDigits(payload.personal.cpf);
  const rg = payload.personal.rg.trim();

  return {
    cpfEncrypted: await encryptText(cpf, piiKey),
    cpfHash: await sha256Hex(`${cpf}:${piiPepper}`),
    cpfLast4: cpf.slice(-4),
    rgEncrypted: await encryptText(rg, piiKey),
    rgHash: await sha256Hex(`${rg.toLowerCase()}:${piiPepper}`),
    rgDisplayEncrypted: await encryptText(rg, piiKey),
  };
}

async function encryptText(value: string, secret: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return btoa(String.fromCharCode(...packed));
}
