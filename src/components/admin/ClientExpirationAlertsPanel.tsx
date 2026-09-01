import { useQuery } from "@tanstack/react-query";
import { BellRing, CalendarClock, CheckCircle2, CircleAlert } from "lucide-react";
import { formatDate, formatPoints } from "@/lib/formatters";
import { getClientExpirationAlerts } from "@/services/expiration-alerts";

export function ClientExpirationAlertsPanel({ clientId }: { clientId: string }) {
  const query = useQuery({ queryKey: ["client-expiration-alerts", clientId], queryFn: () => getClientExpirationAlerts(clientId) });
  return <section className="client-alerts-panel">
    <div className="section-heading"><div><span className="eyebrow">Monitoramento automático</span><h2>Alertas</h2><p>Pontos e vigência acompanhados pelo backend, sem dados do Cofre Local.</p></div><BellRing aria-hidden /></div>
    {query.isLoading && <div className="panel-state">Carregando calendário de alertas...</div>}
    {query.isError && <div className="panel-state error-state">{query.error.message}</div>}
    {query.data && <>
      <div className="client-alert-schedule">
        {query.data.schedules.length === 0 && <div className="alert-empty"><CheckCircle2 /><div><strong>Nenhum vencimento monitorado</strong><span>Não há lotes ativos nem vigência ativa com data final.</span></div></div>}
        {query.data.schedules.map((item, index) => <article key={`${item.type}-${item.programName}-${item.expiresAt}-${index}`}>
          <div className={`alert-kind ${item.type === "points_expiration" ? "points" : "management"}`}>{item.type === "points_expiration" ? <CircleAlert /> : <CalendarClock />}</div>
          <div><span>{item.type === "points_expiration" ? item.programName : "Vigência da gestão"}</span><strong>{item.pointsAmount == null ? `Vence em ${formatDate(item.expiresAt)}` : `${formatPoints(item.pointsAmount)} pontos`}</strong><small>{item.pointsAmount == null ? "Renovação contratual" : `Vencimento em ${formatDate(item.expiresAt)}`}</small></div>
          <div className="next-alert"><span>Próximo alerta</span><strong>{item.nextThresholdDays == null ? "Ciclo concluído" : `${item.nextThresholdDays} dias antes`}</strong></div>
        </article>)}
      </div>
      <div className="client-alert-history"><h3>Alertas já processados</h3>{query.data.history.length === 0 ? <p>Nenhum alerta registrado para este cliente.</p> : query.data.history.slice(0, 8).map((item) => <article key={item.id}><span className={`alert-status-dot ${item.status}`} /><div><strong>{item.alertType === "points_expiration" ? item.programName : "Gestão"} · {item.thresholdDays} dias</strong><small>{item.status === "sent" ? `Enviado em ${formatDate(item.sentAt)}` : item.status === "failed" ? "Falha — será tentado novamente" : "Aguardando envio"}</small></div><time>{formatDate(item.expiresAt)}</time></article>)}</div>
    </>}
  </section>;
}
