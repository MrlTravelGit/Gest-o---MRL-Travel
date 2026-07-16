import { supabase } from "@/lib/supabase";
import type { DirectAccessLink } from "@/types/admin-modules";

export async function getDirectAccessLinks(clientId?: string): Promise<{ items: DirectAccessLink[] }> {
  const { data, error } = await supabase.rpc("get_client_direct_access_links", { p_client_id: clientId || null });
  if (error || !data) throw new Error("Não foi possível carregar links de acesso.");
  return data as unknown as { items: DirectAccessLink[] };
}

export async function createDirectAccessLink(input: { clientId: string; expiresAt?: string; notes?: string }): Promise<{ linkId: string; token: string; path: string; expiresAt: string | null }> {
  const { data, error } = await supabase.rpc("create_client_direct_access_link", {
    p_client_id: input.clientId,
    p_expires_at: input.expiresAt || null,
    p_notes: input.notes || null,
  });
  if (error || !data) throw new Error(error?.message ?? "Link não foi gerado.");
  return data as unknown as { linkId: string; token: string; path: string; expiresAt: string | null };
}

export async function revokeDirectAccessLink(linkId: string, reason: string) {
  const { data, error } = await supabase.rpc("revoke_client_direct_access_link", { p_link_id: linkId, p_reason: reason || null });
  if (error || !data) throw new Error(error?.message ?? "Link não foi revogado.");
  return data;
}
