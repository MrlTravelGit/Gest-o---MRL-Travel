import { supabase } from "@/lib/supabase";
import type { AdminOverview, ClientEconomy } from "@/types/dashboard";

export async function getPublicClientEconomyByLink(token: string): Promise<ClientEconomy> {
  const { data, error } = await supabase.functions.invoke<ClientEconomy>("get-client-economy-by-link", { body: { token } });
  if (error || !data) throw new Error("Página indisponível.");
  return data as unknown as ClientEconomy;
}

export async function getAdminClientEconomyPreview(clientId: string): Promise<ClientEconomy> {
  const { data, error } = await supabase.rpc("get_admin_client_economy_preview", { p_client_id: clientId });
  if (error || !data) throw new Error("Prévia de economia indisponível ou acesso não autorizado");
  return data as unknown as ClientEconomy;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await supabase.rpc("get_admin_overview");
  if (error || !data) throw new Error("Visão administrativa indisponível");
  return data as unknown as AdminOverview;
}
