import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { openVaultClient } from "@/services/management-terms";

export function ProtectedDataButton({ clientId, allowed, compact = false }: { clientId: string; allowed: boolean; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "checking" | "unavailable">("idle");
  if (!allowed) return null;
  return <span className="vault-launch-wrap"><button type="button" className={compact ? "table-action" : "secondary-button vault-launch-button"} disabled={state === "checking"} onClick={async () => {
    setState("checking"); const result = await openVaultClient(clientId); setState(result.opened ? "idle" : "unavailable");
  }}><ShieldCheck size={15} />{state === "checking" ? "Verificando cofre..." : "Abrir dados protegidos"}</button>{state === "unavailable" && <small className="vault-unavailable">Cofre local indisponível nesta rede</small>}</span>;
}
