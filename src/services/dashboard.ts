import { supabase } from "@/lib/supabase";
import type { AdminOverview, PublicClientDashboard } from "@/types/dashboard";

export async function getPublicClientDashboardByLink(token: string): Promise<PublicClientDashboard> {
  const { data, error } = await supabase.functions.invoke<PublicClientDashboard>("get-client-dashboard-by-link", { body: { token } });
  if (error || !data) throw new Error("Painel indisponível.");
  return data as unknown as PublicClientDashboard;
}

export async function getAdminClientDashboardPreview(clientId: string): Promise<PublicClientDashboard> {
  const { data, error } = await supabase.rpc("get_admin_client_dashboard_preview", { p_client_id: clientId });
  if (error || !data) throw new Error("Prévia do painel indisponível ou acesso não autorizado");
  return data as unknown as PublicClientDashboard;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await supabase.rpc("get_admin_overview");
  if (error || !data) throw new Error("Visão administrativa indisponível");
  return data as unknown as AdminOverview;
}
