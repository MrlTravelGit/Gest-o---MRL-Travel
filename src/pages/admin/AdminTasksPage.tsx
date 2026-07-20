import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDot, Columns3, List, Plus, RotateCcw, Search, Trash2, UserRound } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { getAdminFormOptions } from "@/services/admin-options";
import { archiveManagementTask, createManagementTask, getManagementTasks, updateManagementTask } from "@/services/management-tasks";
import type { ManagementTask, ManagementTaskInput, TaskCategory, TaskStatus } from "@/types/management-tasks";

const statuses: Array<{ value: TaskStatus; label: string }> = [
  { value: "open", label: "Pendente" }, { value: "in_progress", label: "Em andamento" },
  { value: "waiting_client", label: "Aguardando cliente" }, { value: "waiting_third_party", label: "Aguardando terceiro" },
  { value: "on_hold", label: "Em espera" }, { value: "completed", label: "Concluída" }, { value: "cancelled", label: "Cancelada" },
];
const categories: Array<{ value: TaskCategory; label: string }> = [
  { value: "onboarding", label: "Onboarding" }, { value: "flight_quote", label: "Cotação de passagem" },
  { value: "hotel_quote", label: "Cotação de hospedagem" }, { value: "reschedule_or_cancel", label: "Remarcação ou cancelamento" },
  { value: "check_in", label: "Check-in" }, { value: "points_expiration", label: "Vencimento de pontos" },
  { value: "transfer", label: "Transferência" }, { value: "complaint", label: "Reclamação" },
  { value: "client_registration", label: "Cadastro de cliente" }, { value: "other", label: "Outros" },
];
const priorityLabels = ["", "Baixa", "Média", "Alta", "Urgente"];

export function AdminTasksPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [view, setView] = useState<"list" | "board">("list");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<ManagementTask | "new" | null>(params.get("new") === "1" ? "new" : null);
  const clientId = params.get("clientId") ?? "";
  const status = params.get("status") ?? "";
  const priority = Number(params.get("priority") ?? 0);
  const category = params.get("category") ?? "";
  const assignedStaffId = params.get("staff") ?? "";
  const source = params.get("source") ?? "";
  const sort = (params.get("sort") as "priority" | "due_at" | "updated_at" | "created_at") || "due_at";

  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const tasks = useQuery({
    queryKey: ["management-tasks", clientId, status, priority, category, assignedStaffId, source, sort, page, search],
    queryFn: () => getManagementTasks({ clientId, status, priority: priority || undefined, category, assignedStaffId, source, sort, search, limit: 20, offset: page * 20 }),
  });
  const save = useMutation({
    mutationFn: ({ taskId, input }: { taskId?: string; input: ManagementTaskInput }) => taskId ? updateManagementTask(taskId, input) : createManagementTask(input),
    onSuccess: async () => { setEditing(null); await Promise.all([queryClient.invalidateQueries({ queryKey: ["management-tasks"] }), queryClient.invalidateQueries({ queryKey: ["admin-overview"] })]); },
  });
  const archive = useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) => archiveManagementTask(taskId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["management-tasks"] }),
  });
  const quickStatus = useMutation({
    mutationFn: ({ taskId, next }: { taskId: string; next: TaskStatus }) => updateManagementTask(taskId, { status: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["management-tasks"] }),
  });

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete("new"); setParams(next); setPage(0);
  }

  return <AppShell title="Demandas" hideHeading>
    <PageHeader eyebrow="Operação diária" title="Demandas" description="Acompanhe prazos, responsáveis e pendências da gestão em uma única fonte oficial." action={<button className="primary-button" onClick={() => setEditing("new")}><Plus size={16} /> Nova demanda</button>} />
    {tasks.data && <section className="task-indicator-grid" aria-label="Indicadores de demandas">
      <TaskIndicator label="Abertas" value={tasks.data.indicators.open} icon={<CircleDot />} />
      <TaskIndicator label="Vencidas" value={tasks.data.indicators.overdue} tone="danger" icon={<AlertTriangle />} />
      <TaskIndicator label="Vencem hoje" value={tasks.data.indicators.dueToday} icon={<CalendarClock />} />
      <TaskIndicator label="Próximos 7 dias" value={tasks.data.indicators.next7Days} icon={<CalendarClock />} />
      <TaskIndicator label="Aguardando cliente" value={tasks.data.indicators.waitingClient} icon={<UserRound />} />
      <TaskIndicator label="Concluídas no mês" value={tasks.data.indicators.completedPeriod} tone="success" icon={<CheckCircle2 />} />
    </section>}
    <section className="task-control-panel">
      <label className="task-search"><Search size={16} /><span className="sr-only">Buscar demandas</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Título, cliente ou observação" /></label>
      <select aria-label="Cliente" value={clientId} onChange={(event) => setFilter("clientId", event.target.value)}><option value="">Todos os clientes</option>{options.data?.clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.fullName}</option>)}</select>
      <select aria-label="Status" value={status} onChange={(event) => setFilter("status", event.target.value)}><option value="">Todos os status</option>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <select aria-label="Prioridade" value={priority || ""} onChange={(event) => setFilter("priority", event.target.value)}><option value="">Todas as prioridades</option>{priorityLabels.slice(1).map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select>
      <select aria-label="Categoria" value={category} onChange={(event) => setFilter("category", event.target.value)}><option value="">Todas as categorias</option>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <select aria-label="Responsável" value={assignedStaffId} onChange={(event) => setFilter("staff", event.target.value)}><option value="">Todos os responsáveis</option>{tasks.data?.staff.map((staff) => <option key={staff.userId} value={staff.userId}>{staff.fullName}</option>)}</select>
      <select aria-label="Origem" value={source} onChange={(event) => setFilter("source", event.target.value)}><option value="">Todas as origens</option><option value="manual">Manual</option><option value="notion_import">Notion</option></select>
      <select aria-label="Ordenação" value={sort} onChange={(event) => setFilter("sort", event.target.value)}><option value="due_at">Prazo</option><option value="priority">Prioridade</option><option value="updated_at">Atualização</option><option value="created_at">Criação</option></select>
      <div className="view-switch" aria-label="Visualização"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="Visualização em lista"><List size={17} /></button><button className={view === "board" ? "active" : ""} onClick={() => setView("board")} aria-label="Visualização em quadro"><Columns3 size={17} /></button></div>
    </section>
    {tasks.isLoading && <LoadingState label="Carregando demandas oficiais..." />}
    {tasks.isError && <ErrorState message={tasks.error.message} retry={() => tasks.refetch()} />}
    {tasks.data && !tasks.data.items.length && <EmptyState title="Nenhuma demanda encontrada" description="Ajuste os filtros ou registre a primeira demanda." />}
    {tasks.data && tasks.data.items.length > 0 && (view === "list"
      ? <div className="task-list">{tasks.data.items.map((task) => <TaskCard key={task.taskId} task={task} onEdit={() => setEditing(task)} onToggle={() => quickStatus.mutate({ taskId: task.taskId, next: task.status === "completed" ? "open" : "completed" })} onArchive={() => { const reason = window.prompt("Motivo do arquivamento (mínimo 5 caracteres):"); if (reason) archive.mutate({ taskId: task.taskId, reason }); }} />)}</div>
      : <TaskBoard items={tasks.data.items} onEdit={setEditing} />)}
    {tasks.data && tasks.data.total > 20 && <nav className="pagination" aria-label="Paginação"><button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page + 1} de {Math.ceil(tasks.data.total / 20)}</span><button disabled={(page + 1) * 20 >= tasks.data.total} onClick={() => setPage((value) => value + 1)}>Próxima</button></nav>}
    {editing && <TaskModal task={editing === "new" ? undefined : editing} defaultClientId={clientId} clients={options.data?.clients ?? []} staff={tasks.data?.staff ?? []} busy={save.isPending} error={save.error?.message} onClose={() => setEditing(null)} onSubmit={(input) => save.mutate({ taskId: editing === "new" ? undefined : editing.taskId, input })} />}
  </AppShell>;
}

function TaskIndicator({ label, value, icon, tone = "" }: { label: string; value: number; icon: React.ReactNode; tone?: string }) { return <article className={tone}>{icon}<span>{label}</span><strong>{value}</strong></article>; }

function TaskCard({ task, onEdit, onToggle, onArchive }: { task: ManagementTask; onEdit: () => void; onToggle: () => void; onArchive: () => void }) {
  return <article className={`task-card priority-${task.priority} ${task.overdue ? "overdue" : ""}`}>
    <button className="task-card-main" onClick={onEdit}><div className="task-card-top"><span className={`task-status status-${task.status}`}>{statusLabel(task.status)}</span><span className={`task-priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>{task.overdue && <span className="overdue-badge">Atrasada</span>}</div><h2>{task.title}</h2><p>{task.description || "Sem observação"}</p><div className="task-meta"><span>{task.clientName || "Demanda interna"}</span><span>{task.assignedName || "Sem responsável"}</span><span>{task.dueAt ? formatTaskDate(task.dueAt) : "Sem prazo"}</span></div></button>
    <div className="task-card-actions">{task.clientId && <Link to={`/admin/clientes/${task.clientId}`}>Abrir cliente</Link>}<button onClick={onToggle}>{task.status === "completed" ? <><RotateCcw size={14} /> Reabrir</> : <><CheckCircle2 size={14} /> Concluir</>}</button><button className="danger-link" onClick={onArchive}><Trash2 size={14} /> Arquivar</button></div>
  </article>;
}

function TaskBoard({ items, onEdit }: { items: ManagementTask[]; onEdit: (task: ManagementTask) => void }) {
  const columns: TaskStatus[] = ["open", "in_progress", "waiting_client", "waiting_third_party", "on_hold", "completed"];
  return <div className="task-board" aria-label="Quadro de demandas paginado">{columns.map((status) => <section key={status}><header><span>{statusLabel(status)}</span><strong>{items.filter((task) => task.status === status).length}</strong></header>{items.filter((task) => task.status === status).map((task) => <button key={task.taskId} onClick={() => onEdit(task)} className={task.overdue ? "overdue" : ""}><span className={`task-priority-dot priority-${task.priority}`} /><strong>{task.title}</strong><small>{task.clientName || "Interna"}</small><time>{task.dueAt ? formatTaskDate(task.dueAt) : "Sem prazo"}</time></button>)}</section>)}</div>;
}

function TaskModal({ task, defaultClientId, clients, staff, busy, error, onClose, onSubmit }: { task?: ManagementTask; defaultClientId: string; clients: Array<{ clientId: string; fullName: string }>; staff: Array<{ userId: string; fullName: string }>; busy: boolean; error?: string; onClose: () => void; onSubmit: (input: ManagementTaskInput) => void }) {
  const [scope, setScope] = useState<"client" | "internal">(task?.scope ?? (defaultClientId ? "client" : "internal"));
  const [clientId, setClientId] = useState(task?.clientId ?? defaultClientId);
  const [title, setTitle] = useState(task?.title ?? ""); const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "open"); const [priority, setPriority] = useState(task?.priority ?? 2);
  const [category, setCategory] = useState<TaskCategory>(task?.category ?? "other"); const [assignedStaffId, setAssignedStaffId] = useState(task?.assignedStaffId ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(task?.startsAt)); const [dueAt, setDueAt] = useState(toLocalInput(task?.dueAt));
  const [timeSpent, setTimeSpent] = useState(task?.timeSpentMinutes?.toString() ?? ""); const [checklist, setChecklist] = useState(""); const [localError, setLocalError] = useState("");
  useEffect(() => { if (scope === "internal") setClientId(""); }, [scope]);
  function submit(event: FormEvent) { event.preventDefault(); if (!title.trim()) return setLocalError("Informe o título da demanda."); if (scope === "client" && !clientId) return setLocalError("Selecione o cliente desta demanda."); onSubmit({ scope, clientId: clientId || undefined, title: title.trim(), description: description.trim() || undefined, status, priority, category, assignedStaffId: assignedStaffId || undefined, startsAt: startsAt ? new Date(startsAt).toISOString() : undefined, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, timeSpentMinutes: timeSpent ? Number(timeSpent) : undefined, checklist: task ? undefined : checklist.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }); }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="task-modal-title"><form className="confirm-modal task-modal" onSubmit={submit}><button type="button" className="dialog-close" onClick={onClose}>Fechar</button><span className="eyebrow">{task ? "Editar demanda" : "Nova demanda"}</span><h2 id="task-modal-title">{task?.title ?? "Organize a próxima ação"}</h2><div className="form-grid"><label>Escopo<select value={scope} onChange={(event) => setScope(event.target.value as "client" | "internal")}><option value="internal">Interna</option><option value="client">Cliente</option></select></label><label>Cliente<select disabled={scope === "internal"} value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Selecione</option>{clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.fullName}</option>)}</select></label><label className="field-full">Título<input maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} autoFocus /></label><label className="field-full">Descrição<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Prioridade<select value={priority} onChange={(event) => setPriority(Number(event.target.value) as 1 | 2 | 3 | 4)}>{priorityLabels.slice(1).map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label><label>Categoria<select value={category} onChange={(event) => setCategory(event.target.value as TaskCategory)}>{categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Responsável<select value={assignedStaffId} onChange={(event) => setAssignedStaffId(event.target.value)}><option value="">Sem responsável</option>{staff.map((item) => <option key={item.userId} value={item.userId}>{item.fullName}</option>)}</select></label><label>Início<input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Prazo<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label><label>Tempo gasto (minutos)<input type="number" min="0" value={timeSpent} onChange={(event) => setTimeSpent(event.target.value)} /></label>{!task && <label className="field-full">Checklist inicial<textarea placeholder="Um item por linha" value={checklist} onChange={(event) => setChecklist(event.target.value)} /></label>}</div>{(localError || error) && <div className="form-error" role="alert">{localError || error}</div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Salvando..." : "Salvar demanda"}</button></div></form></div>;
}

function statusLabel(status: TaskStatus) { return statuses.find((item) => item.value === status)?.label ?? status; }
function formatTaskDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function toLocalInput(value?: string | null) { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
