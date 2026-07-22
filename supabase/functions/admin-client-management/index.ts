import { z } from "npm:zod@3.25.76";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const e164 = z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable();
const addressSchema = z.object({
  postalCode: z.string().trim().min(3).max(16),
  street: z.string().trim().min(2).max(160),
  number: z.string().trim().min(1).max(30),
  complement: z.string().trim().max(120).nullable(),
  neighborhood: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(80),
  countryCode: z.string().trim().regex(/^[A-Za-z]{2}$/),
}).strict().nullable();

const updateProfileSchema = z.object({
  action: z.literal("update_profile"),
  clientId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  fullName: z.string().trim().min(2).max(160),
  displayName: z.string().trim().min(2).max(160).nullable(),
  documentNumber: z.string().trim().max(24).nullable(),
  birthDate: z.string().date().nullable(),
  email: z.string().trim().email().nullable(),
  phone: e164,
  whatsapp: e164,
  notes: z.string().trim().max(4000).nullable(),
  address: addressSchema,
}).strict();

const onlyDigits = (value: string) => value.replace(/\D/g, "");

function validCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const digit = (base: string, factor: number) => {
    let sum = 0;
    for (const char of base) sum += Number(char) * factor--;
    const result = 11 - (sum % 11);
    return result > 9 ? 0 : result;
  };
  return digit(cpf.slice(0, 9), 10) === Number(cpf[9]) && digit(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function validCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = calc(cnpj.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]);
  const second = calc(cnpj.slice(0, 12) + first, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function protectDocument(raw: string): Promise<Record<string, string>> {
  const keySecret = Deno.env.get("ONBOARDING_PII_KEY");
  const pepper = Deno.env.get("ONBOARDING_PII_HASH_PEPPER") ?? keySecret;
  if (!keySecret || keySecret.length < 24 || !pepper || pepper.length < 24) throw new Error("CONFIG_MISSING");
  const digits = onlyDigits(raw);
  const kind = digits.length === 11 && validCpf(digits) ? "cpf" : digits.length === 14 && validCnpj(digits) ? "cnpj" : null;
  if (!kind) throw new Error("INVALID_DOCUMENT");
  const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keySecret));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(digits)));
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0); packed.set(cipher, iv.length);
  return {
    ciphertext: btoa(String.fromCharCode(...packed)),
    hash: await sha256Hex(`${digits}:${pepper}`),
    last4: digits.slice(-4),
    kind,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada." }, 403);
  try {
    const actor = await requireAdmin(request, ["super_admin", "manager"]);
    const parsed = updateProfileSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonResponse(request, { code: "INVALID_PROFILE", error: "Revise os dados do cadastro." }, 422);
    const input = parsed.data;
    const secureDocument = input.documentNumber ? await protectDocument(input.documentNumber) : null;
    const { data, error } = await adminClient().rpc("update_client_profile_admin", {
      p_actor_user_id: actor.userId,
      p_client_id: input.clientId,
      p_expected_version: input.expectedVersion,
      p_full_name: input.fullName,
      p_display_name: input.displayName,
      p_birth_date: input.birthDate,
      p_email: input.email,
      p_phone_e164: input.phone,
      p_whatsapp_e164: input.whatsapp,
      p_notes: input.notes,
      p_address: input.address,
      p_secure_document: secureDocument,
    });
    if (error) throw error;
    return jsonResponse(request, data);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const code = ["CONCURRENT_EDIT","INVALID_DOCUMENT","CONTACT_REQUIRED","INVALID_EMAIL","INVALID_PHONE","INVALID_WHATSAPP","INVALID_BIRTH_DATE","INCOMPLETE_ADDRESS","CONFIG_MISSING","FORBIDDEN"].find((value) => raw.includes(value)) ?? "PROFILE_UPDATE_FAILED";
    const status = code === "FORBIDDEN" ? 403 : code === "CONCURRENT_EDIT" ? 409 : code === "PROFILE_UPDATE_FAILED" || code === "CONFIG_MISSING" ? 500 : 422;
    console.error("admin-client-management failed", code);
    return jsonResponse(request, { code, error: code === "CONCURRENT_EDIT" ? "O cadastro mudou em outra tela. Recarregue antes de salvar." : code === "FORBIDDEN" ? "Acesso não autorizado." : code === "CONFIG_MISSING" ? "A proteção de dados não está configurada." : code === "PROFILE_UPDATE_FAILED" ? "Não foi possível atualizar o cadastro." : "Revise os dados informados." }, status);
  }
});
