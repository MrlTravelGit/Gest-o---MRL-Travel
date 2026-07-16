import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned, Search } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ClientSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/formatters";
import { getAdminFormOptions } from "@/services/admin-options";
import { getTravelInterests, saveTravelInterest } from "@/services/travel-interests";

const schema = z.object({ clientId: z.string().uuid(), destination: z.string().trim().min(2), startDate: z.string(), endDate: z.string(), details: z.string().trim().min(3), status: z.enum(["open", "quoting", "converted", "cancelled"]) }).refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, { path: ["endDate"], message: "A data final deve ser posterior à inicial" });
type FormData = z.infer<typeof schema>;

export function AdminInterestsPage() {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const list = useQuery({ queryKey: ["travel-interests", search, statusFilter, offset], queryFn: () => getTravelInterests(search, statusFilter, 20, offset) });
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { clientId: "", destination: "", startDate: "", endDate: "", details: "", status: "open" } });
  const mutation = useMutation({ mutationFn: saveTravelInterest, onSuccess: () => { form.reset(); void Promise.all([queryClient.invalidateQueries({ queryKey: ["travel-interests"] }), queryClient.invalidateQueries({ queryKey: ["admin-overview"] })]); } });
  return <AppShell title="Interesses" hideHeading>
    <PageHeader eyebrow="Pipeline de oportunidades" title="Interesse em Viagens" description="Organize desejos de viagem antes que se tornem uma cotação." />
    {options.isLoading && <LoadingState />}{options.isError && <ErrorState message={options.error.message} />}
    {options.data && <form className="module-form operation-form" onSubmit={form.handleSubmit((value) => mutation.mutate(value))}><div className="form-title"><MapPinned /><div><h2>Novo interesse</h2><p>Vinculado a um cliente ativo e registrado em auditoria.</p></div></div><div className="form-grid"><label>Cliente<ClientSelect clients={options.data.clients} value={form.watch("clientId")} onChange={(value) => form.setValue("clientId", value, { shouldValidate: true })} /></label><label>Destino<input {...form.register("destination")} placeholder="Lisboa, Portugal" /></label><label>Data inicial<input type="date" {...form.register("startDate")} /></label><label>Data final<input type="date" {...form.register("endDate")} />{form.formState.errors.endDate && <small className="field-error">{form.formState.errors.endDate.message}</small>}</label><label>Status<select {...form.register("status")}><option value="open">Aberto</option><option value="quoting">Em cotação</option><option value="converted">Convertido</option><option value="cancelled">Cancelado</option></select></label><label className="field-full">Observação<textarea {...form.register("details")} /></label></div>{mutation.isError && <div className="form-error">{mutation.error.message}</div>}{mutation.isSuccess && <div className="form-success">Interesse registrado.</div>}<button className="primary-button" disabled={!options.data.canWrite || mutation.isPending}>Salvar interesse</button></form>}
    <section className="data-section"><div className="section-heading"><div><span className="eyebrow">Acompanhamento</span><h2>Interesses recentes</h2></div></div><div className="data-filters"><div className="search-field"><Search size={17} /><input aria-label="Buscar cliente ou destino" value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} placeholder="Cliente ou destino" /></div><select aria-label="Filtrar interesses por status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setOffset(0); }}><option value="">Todos os status</option><option value="open">Aberto</option><option value="quoting">Em cotação</option><option value="converted">Convertido</option><option value="cancelled">Cancelado</option></select></div>
      {list.isLoading && <LoadingState />}{list.isError && <ErrorState message={list.error.message} retry={() => void list.refetch()} />}{list.data?.items.length === 0 && <EmptyState title="Nenhum interesse" description="Os planos relatados pelos clientes aparecerão aqui." />}{list.data && list.data.items.length > 0 && <><div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Destino</th><th>Período</th><th>Status</th><th>Observação</th></tr></thead><tbody>{list.data.items.map((item) => <tr key={item.id}><td><strong>{item.clientName}</strong></td><td>{item.destination}</td><td>{formatDate(item.startDate)} — {formatDate(item.endDate)}</td><td><StatusBadge status={item.status} /></td><td className="table-notes">{item.details}</td></tr>)}</tbody></table></div><Pagination offset={offset} total={list.data.total} pending={list.isFetching} setOffset={setOffset} /></>}
    </section>
  </AppShell>;
}

function Pagination({ offset, total, pending, setOffset }: { offset: number; total: number; pending: boolean; setOffset: (value: number) => void }) { return <div className="pagination-bar"><span>{offset + 1}–{Math.min(offset + 20, total)} de {total}</span><div><button className="secondary-button" disabled={!offset || pending} onClick={() => setOffset(Math.max(0, offset - 20))}>Anterior</button><button className="secondary-button" disabled={offset + 20 >= total || pending} onClick={() => setOffset(offset + 20)}>Próxima</button></div></div>; }
