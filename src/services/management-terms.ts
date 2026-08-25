import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import type { ManagementTermFilters, ManagementTermsResult } from "@/types/management-terms";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

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
  const { data, error } = await supabase.rpc("get_client_management_terms_v1", {
    p_search: filters.search || null, p_term_status: filters.termStatus || "all", p_client_status: filters.clientStatus || "all",
    p_start_from: filters.startFrom || null, p_start_to: filters.startTo || null, p_end_from: filters.endFrom || null, p_end_to: filters.endTo || null,
    p_has_savings: filters.hasSavings ?? null, p_has_cashback: filters.hasCashback ?? null, p_savings_min: filters.savingsMin ?? null, p_savings_max: filters.savingsMax ?? null,
    p_cashback_min: filters.cashbackMin ?? null, p_cashback_max: filters.cashbackMax ?? null, p_sort_by: filters.sortBy || "client_name", p_sort_direction: filters.sortDirection || "asc",
    p_limit: filters.limit ?? 25, p_offset: filters.offset ?? 0,
  });
  if (error) throw new Error(error.message || "Não foi possível carregar as vigências.");
  return normalizeManagementTerms(data);
}

export async function getVaultAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_my_vault_access_v1");
  if (error) return false;
  return record(data) && data.vaultAccess === true;
}

export function buildVaultClientUrl(clientId: string): string | null {
  const base = env.VITE_LOCAL_VAULT_URL;
  if (!base || !/^[0-9a-f-]{36}$/i.test(clientId)) return null;
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/clients/${clientId}`;
  url.search = ""; url.hash = "";
  return url.toString();
}

export async function openVaultClient(clientId: string): Promise<{ opened: boolean; message: string }> {
  const url = buildVaultClientUrl(clientId);
  if (!url) return { opened: false, message: "Cofre local indisponível nesta rede" };
  try {
    const health = new URL("/health", url);
    await fetch(health, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(2500) });
    window.open(url, "_blank", "noopener,noreferrer");
    return { opened: true, message: "" };
  } catch {
    return { opened: false, message: "Cofre local indisponível nesta rede" };
  }
}
