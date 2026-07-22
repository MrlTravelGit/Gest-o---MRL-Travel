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
  contractReviewPending?: boolean;
  notice?: string | null;
}

const DIRECT_ACCESS_MESSAGES: Record<string, string> = {
  CLIENT_NOT_ACTIVE: "Somente clientes ativos podem gerar o link público.",
  ACTIVE_CONTRACT_REQUIRED: "Contrato pendente de revisão.",
  CLIENT_NOT_FOUND: "Cliente não encontrado.",
  FORBIDDEN: "Seu usuário não possui permissão para esta ação.",
  LINK_GENERATION_FAILED: "Não foi possível gerar o link agora.",
};

async function directAccessError(error: unknown, fallback: string) {
  const context = (error as { context?: Response })?.context;
  if (context) {
    try {
      const payload = await context.clone().json() as { code?: string; error?: string };
      if (payload.code && DIRECT_ACCESS_MESSAGES[payload.code]) return new Error(DIRECT_ACCESS_MESSAGES[payload.code]);
      if (payload.error) return new Error(payload.error);
    } catch {
      // usa fallback abaixo
    }
  }
  const message = error instanceof Error ? error.message : fallback;
  const domain = Object.entries(DIRECT_ACCESS_MESSAGES).find(([code]) => message.includes(code));
  return new Error(domain?.[1] ?? fallback);
}

async function invokeDirectAccess<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("admin-direct-access-link", { body });
  if (error || !data) throw await directAccessError(error, "Operação de link indisponível.");
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
