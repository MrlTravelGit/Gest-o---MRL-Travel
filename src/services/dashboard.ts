import { supabase } from "@/lib/supabase";
import type { AdminOverview, ClientDashboard } from "@/types/dashboard";

export async function getClientDashboard(publicId: string): Promise<ClientDashboard> {
  const { data, error } = await supabase.rpc("get_client_dashboard", {
    p_public_id: publicId,
  });

  if (error || !data) throw new Error("Dashboard indisponível ou acesso não autorizado");
  return data as unknown as ClientDashboard;
}

export async function getMyClientDashboard(): Promise<ClientDashboard> {
  const { data, error } = await supabase.rpc("get_my_client_dashboard");
  if (error || !data) throw new Error("Dashboard indisponível ou acesso não autorizado");
  return data as unknown as ClientDashboard;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await supabase.rpc("get_admin_overview");
  if (error || !data) throw new Error("Visão administrativa indisponível");
  return data as unknown as AdminOverview;
}
