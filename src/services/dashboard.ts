import { supabase } from "@/lib/supabase";
import type { AdminOverview, PublicClientDashboard } from "@/types/dashboard";

export async function getPublicClientDashboardByLink(token: string): Promise<PublicClientDashboard> {
  const { data, error } = await supabase.functions.invoke<PublicClientDashboard>("get-client-dashboard-by-link", { body: { token } });
  if (error || !data) throw new Error("Painel indisponível.");
  return normalizeDashboardCashback(data);
}

export async function getAdminClientDashboardPreview(clientId: string): Promise<PublicClientDashboard> {
  const { data, error } = await supabase.rpc("get_admin_client_dashboard_preview", { p_client_id: clientId });
  if (error || !data) throw new Error("Prévia do painel indisponível ou acesso não autorizado");
  return normalizeDashboardCashback(data);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await supabase.rpc("get_admin_overview");
  if (error || !data) throw new Error("Visão administrativa indisponível");
  return data as unknown as AdminOverview;
}

function normalizeDashboardCashback(payload: unknown): PublicClientDashboard {
  const dashboard = payload as PublicClientDashboard;
  const cashback = dashboard.cashback as (PublicClientDashboard["cashback"] & {
    summary?: { available?: number };
  }) | undefined;

  if (!cashback || typeof cashback.availableBalance === "number") return { ...dashboard, travelInterests: Array.isArray(dashboard.travelInterests) ? dashboard.travelInterests : [] };

  return {
    ...dashboard,
    travelInterests: Array.isArray(dashboard.travelInterests) ? dashboard.travelInterests : [],
    cashback: {
      ...cashback,
      availableBalance: Number(cashback.summary?.available ?? 0),
    },
  } as PublicClientDashboard;
}
