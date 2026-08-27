import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import type { ManagementTermFilters, ManagementTermsResult } from "@/types/management-terms";
import { z } from "zod";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const MANAGEMENT_TERMS_RPC_ARGUMENTS = [
  "p_cashback_max", "p_cashback_min", "p_client_status", "p_end_from", "p_end_to",
  "p_has_cashback", "p_has_savings", "p_limit", "p_offset", "p_savings_max",
  "p_savings_min", "p_search", "p_sort_by", "p_sort_direction", "p_start_from",
  "p_start_to", "p_term_status",
] as const;

const itemSchema = z.object({
  clientId: z.string().uuid(), clientName: z.string(), clientStatus: z.string(),
  contractId: z.string().uuid().nullable(), contractStatus: z.string().nullable(),
  termStatus: z.enum(["active", "expiring", "ended", "no_term", "archived"]),
  startsOn: z.string().nullable(), endsOn: z.string().nullable(), totalDays: z.number().nullable(),
  elapsedDays: z.number().nullable(), remainingDays: z.number().nullable(), progressPercent: z.number(),
  savings: z.number(), cashback: z.number(), historicalSavings: z.number(), historicalCashback: z.number(),
  lastActivity: z.string().nullable(), vaultSyncStatus: z.enum(["synced", "pending", "failed"]).optional(),
});

const responseSchema = z.object({
  summary: z.object({ active: z.number(), expiring: z.number(), ended: z.number(), noTerm: z.number(), totalSavings: z.number(), totalCashback: z.number() }),
  items: z.array(itemSchema), total: z.number(), limit: z.number(), offset: z.number(), canVaultAccess: z.boolean(),
});

type RpcError = { code?: string; message?: string; details?: string; hint?: string };

export class ManagementTermsServiceError extends Error {
  constructor(public readonly kind: "unavailable" | "forbidden" | "invalid_response" | "request_failed", message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ManagementTermsServiceError";
  }
}

export function buildManagementTermsRpcArgs(filters: ManagementTermFilters) {
  return {
    p_cashback_max: filters.cashbackMax ?? null,
    p_cashback_min: filters.cashbackMin ?? null,
    p_client_status: filters.clientStatus || "all",
    p_end_from: filters.endFrom || null,
    p_end_to: filters.endTo || null,
    p_has_cashback: filters.hasCashback ?? null,
    p_has_savings: filters.hasSavings ?? null,
    p_limit: filters.limit ?? 25,
    p_offset: filters.offset ?? 0,
    p_savings_max: filters.savingsMax ?? null,
    p_savings_min: filters.savingsMin ?? null,
    p_search: filters.search || null,
    p_sort_by: filters.sortBy || "client_name",
    p_sort_direction: filters.sortDirection || "asc",
    p_start_from: filters.startFrom || null,
    p_start_to: filters.startTo || null,
    p_term_status: filters.termStatus || "all",
  } satisfies Record<(typeof MANAGEMENT_TERMS_RPC_ARGUMENTS)[number], unknown>;
}

function managementTermsError(error: RpcError): ManagementTermsServiceError {
  const technical = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  if (error.code === "PGRST202" || (technical.includes("get_client_management_terms_v1") && technical.includes("schema cache"))) {
    return new ManagementTermsServiceError("unavailable", "O painel de vigências está temporariamente indisponível. Tente novamente em instantes.", error);
  }
  if (error.code === "42501" || technical.includes("forbidden") || technical.includes("permission denied")) {
    return new ManagementTermsServiceError("forbidden", "Você não possui permissão administrativa para acessar este painel.", error);
  }
  return new ManagementTermsServiceError("request_failed", "Não foi possível carregar as vigências. Tente novamente.", error);
}

export function normalizeManagementTerms(value: unknown): ManagementTermsResult {
  const source = record(value) ? value : {};
  const summary = record(source.summary) ? source.summary : {};
  const number = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
  return {
    summary: { active: number(summary.active), expiring: number(summary.expiring), ended: number(summary.ended), noTerm: number(summary.noTerm), totalSavings: number(summary.totalSavings), totalCashback: number(summary.totalCashback) },
    items: Array.isArray(source.items) ? source.items as ManagementTermsResult["items"] : [],
    total: number(source.total), limit: number(source.limit) || 25, offset: number(source.offset), canVaultAccess: source.canVaultAccess === true,
  };
}

export async function getManagementTerms(filters: ManagementTermFilters): Promise<ManagementTermsResult> {
  const { data, error } = await supabase.rpc("get_client_management_terms_v1", buildManagementTermsRpcArgs(filters));
  if (error) throw managementTermsError(error);
  const normalized = normalizeManagementTerms(data);
  const parsed = responseSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new ManagementTermsServiceError("invalid_response", "O painel de vigências recebeu uma resposta inválida. Tente novamente.", parsed.error);
  }
  return parsed.data;
}

export async function getVaultAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_my_vault_access_v1");
  if (error) throw new Error(error.message || "Permissão do cofre local indisponível.");
  return record(data) && data.vaultAccess === true;
}

export function buildVaultClientUrl(clientId: string): string | null {
  const base = env.VITE_LOCAL_VAULT_URL || "http://192.168.0.25:7443";
  if (!base || !/^[0-9a-f-]{36}$/i.test(clientId)) return null;
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/clients/${encodeURIComponent(clientId)}`;
  url.search = ""; url.hash = "";
  return url.toString();
}
