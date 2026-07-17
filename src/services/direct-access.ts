import { supabase } from "@/lib/supabase";

export interface DirectAccessState {
  hasActiveLink: boolean;
  recoverable: boolean;
  requiresRotation: boolean;
  url: string | null;
  linkId: string;
  clientId: string;
  clientName: string;
  status: string;
  createdAt: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  useCount?: number;
  revokedAt?: string | null;
}

async function invokeDirectAccess<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("admin-direct-access-link", { body });
  if (error || !data) throw new Error(error?.message ?? "Operação de link indisponível.");
  return data;
}

export async function getDirectAccessLink(clientId: string): Promise<DirectAccessState> {
  return invokeDirectAccess<DirectAccessState>({ action: "get", clientId });
}

export async function rotateDirectAccessLink(input: { clientId: string; expiresAt?: string | null; notes?: string }): Promise<DirectAccessState> {
  return invokeDirectAccess<DirectAccessState>({
    action: "rotate",
    clientId: input.clientId,
    expiresAt: input.expiresAt || null,
    notes: input.notes || null,
  });
}

export async function revokeDirectAccessLink(linkId: string, reason: string): Promise<DirectAccessState> {
  return invokeDirectAccess<DirectAccessState>({ action: "revoke", linkId, reason: reason || null });
}

export async function registerDirectAccessCopy(linkId: string): Promise<void> {
  await invokeDirectAccess<{ ok: boolean }>({ action: "copy", linkId });
}

// Compatibilidade com a tela administrativa antiga de "Acessos".
export async function getDirectAccessLinks(): Promise<{ items: DirectAccessState[] }> {
  return { items: [] };
}

export async function createDirectAccessLink(input: { clientId: string; expiresAt?: string | null; notes?: string }): Promise<{ linkId: string; token: string; path: string; expiresAt: string | null }> {
  const result = await rotateDirectAccessLink(input);
  const url = result.url ? new URL(result.url) : null;
  return { linkId: result.linkId ?? "", token: "", path: url?.pathname ?? "", expiresAt: result.expiresAt ?? null };
}
