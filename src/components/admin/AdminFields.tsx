import type { AdminClientOption } from "@/types/admin-modules";

export function ClientSelect({ clients, value, onChange, disabled, id = "client" }: { clients: AdminClientOption[]; value: string; onChange: (value: string) => void; disabled?: boolean; id?: string }) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}><option value="">Selecione o cliente</option>{clients.map((client) => <option value={client.clientId} key={client.clientId}>{client.fullName}</option>)}</select>;
}

export function ProgramAccountSelect({ client, value, onChange, exclude, id = "account" }: { client?: AdminClientOption; value: string; onChange: (value: string) => void; exclude?: string; id?: string }) {
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Selecione o programa</option>{client?.accounts.filter((account) => account.accountId !== exclude).map((account) => <option value={account.accountId} key={account.accountId}>{account.programName} · {new Intl.NumberFormat("pt-BR").format(account.balance)} pts</option>)}</select>;
}

export function StatusBadge({ status }: { status: string }) { const labels: Record<string, string> = { active: "Ativo", ended: "Arquivado", paused: "Pausado", lead: "Aguardando ativação", open: "Aberto", quoting: "Em cotação", converted: "Convertido", cancelled: "Cancelado", cash: "Dinheiro", miles: "Milhas" }; return <span className={`status-badge status-${status}`}>{labels[status] ?? status}</span>; }
