import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ClipboardList, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { getManagementTasks } from "@/services/management-tasks";

export function ClientTasksPanel({ clientId, clientName, canWrite }: { clientId: string; clientName: string; canWrite: boolean }) {
  const tasks = useQuery({ queryKey: ["management-tasks", "client", clientId], queryFn: () => getManagementTasks({ clientId, limit: 5, sort: "due_at" }) });
  return <section className="module-form client-tasks-panel">
    <div className="form-title"><ClipboardList /><div><h2>Demandas</h2><p>Próximas ações vinculadas a {clientName}.</p></div></div>
    {tasks.isLoading && <div className="panel-state">Carregando demandas...</div>}
    {tasks.isError && <div className="form-error">{tasks.error.message}</div>}
    {tasks.data && <>
      <div className="client-task-counts"><span><strong>{tasks.data.indicators.open}</strong> abertas</span><span className={tasks.data.indicators.overdue ? "danger" : ""}><strong>{tasks.data.indicators.overdue}</strong> vencidas</span></div>
      {!tasks.data.items.length && <div className="read-only-banner">Nenhuma demanda vinculada a este cliente.</div>}
      <div className="client-task-list">{tasks.data.items.map((task) => <Link key={task.taskId} to={`/admin/demandas?clientId=${clientId}`}><span className={`task-priority-dot priority-${task.priority}`} /><div><strong>{task.title}</strong><small>{task.dueAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(task.dueAt)) : "Sem prazo"}</small></div>{task.overdue ? <AlertTriangle className="danger" size={16} /> : <ArrowRight size={16} />}</Link>)}</div>
      <div className="economy-admin-actions"><Link className={`primary-button ${!canWrite ? "disabled" : ""}`} aria-disabled={!canWrite} to={canWrite ? `/admin/demandas?clientId=${clientId}&new=1` : "#"}><Plus size={15} /> Nova demanda para este cliente</Link><Link className="secondary-button" to={`/admin/demandas?clientId=${clientId}`}>Ver todas</Link></div>
    </>}
  </section>;
}
