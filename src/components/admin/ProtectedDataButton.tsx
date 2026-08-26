import { Eye } from "lucide-react";
import { buildVaultClientUrl } from "@/services/management-terms";

export type VaultLaunchState = "synced" | "pending" | "failed";

const labels: Record<VaultLaunchState, string> = {
  synced: "Abrir dados protegidos",
  pending: "Cadastro aguardando sincronização com a Gestão",
  failed: "Falha de sincronização do cofre local",
};

export function ProtectedDataButton({ clientId, allowed, compact = false, state = "synced" }: { clientId: string; allowed: boolean; compact?: boolean; state?: VaultLaunchState }) {
  if (!allowed) return null;
  const url = buildVaultClientUrl(clientId);
  if (!url) return null;
  const title = labels[state];
  return <span className="vault-launch-wrap" title={title}><a href={url} target="_blank" rel="noopener noreferrer" aria-label={title} className={`${compact ? "table-action vault-launch-icon" : "secondary-button vault-launch-button"} vault-state-${state}`}><Eye size={15} />{compact ? <span className="sr-only">{title}</span> : "Abrir dados protegidos"}</a></span>;
}
