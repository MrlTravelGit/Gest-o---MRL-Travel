import { supabase } from "@/lib/supabase";
import type { AdminOverview, PublicClientDashboard } from "@/types/dashboard";

export async function getPublicClientDashboardByLink(token: string): Promise<PublicClientDashboard> {
  const { data, error } = await supabase.functions.invoke<PublicClientDashboard>("get-client-dashboard-by-link", { body: { token } });
  if (error || !data) throw new Error("Painel indisponível.");
  return normalizeDashboardCashback(data);
}

export async function getAdminClientDashboardPreview(clientId: string): Promise<PublicClientDashboard> {
  const { data, error } = await supabase.rpc("get_admin_client_dashboard_preview", { p_client_id: clientId });
  if (error?.code === "P0002" || error?.message?.includes("CLIENT_NOT_FOUND")) throw new AdminPreviewNotFoundError();
  if (error || !data) throw new Error("Prévia do painel indisponível ou acesso não autorizado");
  return normalizeDashboardCashback(data);
}

export class AdminPreviewNotFoundError extends Error {
  constructor() { super("Cliente não encontrado"); this.name = "AdminPreviewNotFoundError"; }
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await supabase.rpc("get_admin_overview");
  if (error || !data) throw new Error("Visão administrativa indisponível");
  return data as unknown as AdminOverview;
}

function normalizeDashboardCashback(payload: unknown): PublicClientDashboard {
  const dashboard = payload as PublicClientDashboard;
  const rawSavings = Array.isArray(dashboard.savingsHistory) ? dashboard.savingsHistory : [];
  const visibleSavings = rawSavings.filter((saving) =>
    saving.deletedAt == null && !["deleted", "removed", "archived"].includes(String(saving.status ?? "").toLowerCase()),
  );
  const leakedDeletedIds = new Set(rawSavings.filter((saving) => !visibleSavings.includes(saving)).map((saving) => saving.id));
  const cashback = dashboard.cashback as (PublicClientDashboard["cashback"] & {
    summary?: { available?: number };
  }) | undefined;

  const generatedSavings = dashboard.savingsHistory
    ? visibleSavings.reduce((total, saving) => total + Number(saving.savingsValue || 0), 0)
    : dashboard.summary.generatedSavings;
  const redemptionsCount = dashboard.savingsHistory ? visibleSavings.length : dashboard.summary.redemptionsCount;
  const normalizedBase = {
    ...dashboard,
    summary: { ...dashboard.summary, generatedSavings, redemptionsCount },
    savingsHistory: dashboard.savingsHistory ? visibleSavings : dashboard.savingsHistory,
    travelInterests: Array.isArray(dashboard.travelInterests) ? dashboard.travelInterests : [],
  };

  if (!cashback) return normalizedBase;

  const transactions = Array.isArray(cashback.transactions)
    ? cashback.transactions.filter((transaction) => !transaction.redemptionId || !leakedDeletedIds.has(transaction.redemptionId))
    : [];
  const summary = dashboard.savingsHistory
    ? (() => {
      const generated = visibleSavings.reduce((total, saving) => total + Number(saving.cashbackAmount || 0), 0);
      const source = cashback.summary;
      return {
        ...source,
        generated,
        available: generated + Number(source?.adjusted ?? 0) - Number(source?.used ?? 0) - Number(source?.paid ?? 0) - Number(source?.reversed ?? 0),
      };
    })()
    : cashback.summary;

  return {
    ...normalizedBase,
    cashback: {
      ...cashback,
      summary,
      transactions,
      availableBalance: Number(summary?.available ?? cashback.availableBalance ?? 0),
    },
  } as PublicClientDashboard;
}
