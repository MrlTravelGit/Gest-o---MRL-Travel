import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Search } from "lucide-react";
import { ClientSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate, formatPoints } from "@/lib/formatters";
import { getAdminFormOptions } from "@/services/admin-options";
import { getPointMovements, voidPointTransaction } from "@/services/movements";
import type { PointMovement } from "@/types/admin-modules";

export function AdminMovementsPage() {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const [filters, setFilters] = useState({ clientId: "", source: "all", status: "all", startDate: "", endDate: "" });
  const movements = useQuery({ queryKey: ["point-movements", filters], queryFn: () => getPointMovements(filters) });
  const [selected, setSelected] = useState<PointMovement | null>(null);
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => voidPointTransaction(selected!.transactionId, reason, crypto.randomUUID()), onSuccess: () => { setSelected(null); setReason(""); void queryClient.invalidateQueries({ queryKey: ["point-movements"] }); } });

  return <AppShell title="Movimentações" hideHeading>
    <PageHeader eyebrow="Livro-razão" title="Histórico unificado de pontos" description="Entradas, saídas, transferências, clubes, viagens e ajustes consultam a fonte canônica point_transactions." />
    <section className="data-section">
      <div className="section-heading"><div><span className="eyebrow">Filtros</span><h2>Movimentos</h2></div></div>
      {options.data && <div className="data-filters movement-filters"><ClientSelect clients={options.data.clients} value={filters.clientId} onChange={(clientId) => setFilters((current) => ({ ...current, clientId }))} /><select value={filters.source} onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value }))}><option value="all">Todas origens</option><option value="admin_points_management">Entradas</option><option value="transfer">Transferências</option><option value="manual_exit">Saída manual</option><option value="travel_sale">Viagens</option><option value="club">Clubes</option><option value="reversal">Estornos</option></select><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">Todos status</option><option value="confirmed">Confirmados</option><option value="voided">Estornados</option></select><input type="date" aria-label="Início" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /><input type="date" aria-label="Fim" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></div>}
      {movements.isLoading && <LoadingState />}{movements.isError && <ErrorState message={movements.error.message} retry={() => void movements.refetch()} />}{movements.data?.items.length === 0 && <EmptyState title="Nenhuma movimentação encontrada" description="Ajuste os filtros ou registre operações nos módulos." />}
      {movements.data && movements.data.items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Data</th><th>Cliente</th><th>Programa</th><th>Tipo</th><th>Pontos</th><th>Origem</th><th>Status</th><th></th></tr></thead><tbody>{movements.data.items.map((item) => <tr key={item.transactionId}><td>{formatDate(item.occurredAt)}</td><td>{item.clientName}</td><td>{item.programName}</td><td>{item.transactionType}</td><td className={item.pointsDelta < 0 ? "value-negative" : "value-positive"}>{formatPoints(item.pointsDelta)}</td><td>{item.source}<small>{item.description}</small></td><td><StatusBadge status={item.status} /></td><td><button className="table-action" disabled={item.status === "voided" || item.source === "reversal"} onClick={() => setSelected(item)}><RotateCcw size={14}/> Estornar</button></td></tr>)}</tbody></table></div>}
    </section>
    {selected && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="confirm-modal"><h2>Estornar movimentação</h2><p>Será criado um lançamento inverso e o original será preservado como estornado.</p><div className="danger-summary"><Search size={18}/><span>{selected.clientName} · {selected.programName} · {formatPoints(selected.pointsDelta)}</span></div><label>Motivo obrigatório<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>{mutation.isError && <div className="form-error">{mutation.error.message}</div>}<div className="dialog-actions"><button className="secondary-button" onClick={() => setSelected(null)}>Cancelar</button><button className="danger-button" disabled={reason.trim().length < 6 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Estornando..." : "Confirmar estorno"}</button></div></div></div>}
  </AppShell>;
}
