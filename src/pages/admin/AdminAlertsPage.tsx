import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Bot, CalendarClock, CheckCircle2, CircleAlert, History, Play, Save, Send, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate, formatPoints } from "@/lib/formatters";
import { getExpirationAlertsDashboard, runExpirationAlerts, testTelegramAlert, updateExpirationAlertSettings } from "@/services/expiration-alerts";

const availableThresholds = [90, 60, 30, 15, 7, 1];

export function AdminAlertsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["expiration-alerts-dashboard"], queryFn: getExpirationAlertsDashboard });
  const [form, setForm] = useState({ pointsEnabled: true, managementEnabled: true, thresholdDays: availableThresholds, dailyTime: "08:00" });
  const [notice, setNotice] = useState("");
  useEffect(() => { if (query.data) setForm({ pointsEnabled: query.data.settings.pointsEnabled, managementEnabled: query.data.settings.managementEnabled, thresholdDays: query.data.settings.thresholdDays, dailyTime: query.data.settings.dailyTime }); }, [query.data]);
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["expiration-alerts-dashboard"] });
  const save = useMutation({ mutationFn: () => updateExpirationAlertSettings(form), onSuccess: async () => { setNotice("Configurações salvas."); await refresh(); } });
  const test = useMutation({ mutationFn: testTelegramAlert, onSuccess: async (result) => { setNotice(result.message); await refresh(); } });
  const run = useMutation({ mutationFn: runExpirationAlerts, onSuccess: async (result) => { setNotice(`Rotina concluída: ${result.sent} enviado(s), ${result.skipped} já processado(s), ${result.failed} falha(s).`); await refresh(); } });
  const toggleThreshold = (day: number) => setForm((current) => ({ ...current, thresholdDays: current.thresholdDays.includes(day) ? current.thresholdDays.filter((item) => item !== day) : [...current.thresholdDays, day].sort((a, b) => b - a) }));
  const telegramReady = Boolean(query.data?.telegram.tokenConfigured && query.data.telegram.chatConfigured);
  const mutationError = save.error ?? test.error ?? run.error;

  return <AppShell title="Alertas" hideHeading>
    <PageHeader eyebrow="Configurações · Automação" title="Alertas de vencimento" description="Uma central silenciosa para antecipar pontos e renovações antes que se tornem urgentes." action={<button className="primary-button" disabled={!telegramReady || run.isPending} onClick={() => run.mutate()}><Play size={16} /> {run.isPending ? "Executando..." : "Executar agora"}</button>} />
    {query.isLoading && <LoadingState label="Carregando monitoramento..." />}
    {query.isError && <ErrorState message={query.error.message} retry={() => void query.refetch()} />}
    {query.data && <>
      <section className="alert-ops-hero">
        <article className={telegramReady ? "healthy" : "warning"}><div><Bot /></div><span>Canal Telegram</span><strong>{telegramReady ? "Conectado" : "Configuração pendente"}</strong><small>{query.data.telegram.chatIdMasked ? `Destino ${query.data.telegram.chatIdMasked}` : "Secrets protegidos no backend"}</small></article>
        <article><div><CalendarClock /></div><span>Próxima janela diária</span><strong>{query.data.settings.dailyTime}</strong><small>{query.data.settings.timezone}</small></article>
        <article><div><BellRing /></div><span>Alertas elegíveis agora</span><strong>{query.data.summary.awaiting}</strong><small>Deduplicados antes do envio</small></article>
        <article className={query.data.summary.failed ? "danger" : "healthy"}><div>{query.data.summary.failed ? <CircleAlert /> : <ShieldCheck />}</div><span>Saúde recente</span><strong>{query.data.summary.failed ? `${query.data.summary.failed} falha(s)` : "Operação normal"}</strong><small>{query.data.summary.lastSentAt ? `Último envio ${formatDate(query.data.summary.lastSentAt)}` : "Nenhum envio registrado"}</small></article>
      </section>

      <div className="alert-settings-layout">
        <section className="module-form alert-settings-card"><div className="form-title"><BellRing /><div><h2>Política de antecedência</h2><p>O marco de 90 dias é permanente; as demais janelas são complementares.</p></div></div>
          <div className="alert-toggle-grid"><label><input type="checkbox" checked={form.pointsEnabled} onChange={(event) => setForm((current) => ({ ...current, pointsEnabled: event.target.checked }))} /><span><strong>Pontos e milhas</strong><small>Lotes ativos com saldo disponível</small></span></label><label><input type="checkbox" checked={form.managementEnabled} onChange={(event) => setForm((current) => ({ ...current, managementEnabled: event.target.checked }))} /><span><strong>Vigência da gestão</strong><small>Contratos ativos de clientes ativos</small></span></label></div>
          <fieldset className="threshold-fieldset"><legend>Dias de antecedência</legend><div>{availableThresholds.map((day) => <label key={day} className={form.thresholdDays.includes(day) ? "selected" : ""}><input type="checkbox" checked={form.thresholdDays.includes(day)} disabled={day === 90} onChange={() => toggleThreshold(day)} /><strong>{day}</strong><span>dias</span>{day === 90 && <small>principal</small>}</label>)}</div></fieldset>
          <label className="alert-time-field">Horário diário<span>Horário de Brasília; a execução ocorre uma vez por dia.</span><input type="time" value={form.dailyTime} onChange={(event) => setForm((current) => ({ ...current, dailyTime: event.target.value }))} /></label>
          <div className="alert-settings-actions"><button className="primary-button" disabled={save.isPending} onClick={() => save.mutate()}><Save size={16} /> {save.isPending ? "Salvando..." : "Salvar configurações"}</button></div>
        </section>
        <aside className="module-form telegram-test-card"><div className="form-title"><Send /><div><h2>Teste controlado</h2><p>Somente uma mensagem operacional, sem dados de cliente.</p></div></div><div className={`telegram-readiness ${telegramReady ? "ready" : "pending"}`}>{telegramReady ? <CheckCircle2 /> : <CircleAlert />}<div><strong>{telegramReady ? "Secrets disponíveis" : "Configure os secrets"}</strong><span>Token: {query.data.telegram.tokenConfigured ? "protegido" : "ausente"}<br />Chat ID: {query.data.telegram.chatConfigured ? "protegido" : "ausente"}</span></div></div><button className="secondary-button" disabled={!telegramReady || test.isPending} onClick={() => test.mutate()}><Send size={15} /> {test.isPending ? "Enviando..." : "Testar Telegram"}</button><p className="security-note"><ShieldCheck /> O token nunca chega ao navegador nem é gravado no histórico.</p></aside>
      </div>
      {notice && <div className="form-success" role="status">{notice}</div>}{mutationError && <div className="form-error" role="alert">{mutationError.message}</div>}{query.data.settings.lastError && <div className="alert-last-error"><CircleAlert /><div><strong>Último erro da rotina</strong><span>{query.data.settings.lastError}</span></div></div>}

      <section className="data-section alert-history-section"><div className="section-heading"><div><span className="eyebrow">Rastro operacional</span><h2>Histórico de alertas</h2><p>Envios, tentativas e falhas registrados para impedir duplicidade.</p></div><History /></div>
        {query.data.history.length === 0 ? <EmptyState title="Nenhum alerta processado" description="Os primeiros registros aparecerão após uma execução elegível." /> : <div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Tipo</th><th>Vencimento</th><th>Janela</th><th>Resultado</th><th>Processado em</th></tr></thead><tbody>{query.data.history.map((item) => <tr key={item.id}><td><Link to={`/admin/clientes/${item.clientId}`}>{item.clientName || "Abrir cliente"}</Link><small>{item.alertType === "points_expiration" ? `${item.programName} · ${formatPoints(item.pointsAmount ?? 0)} pontos` : "Gestão MRL Travel"}</small></td><td>{item.alertType === "points_expiration" ? "Pontos" : "Gestão"}</td><td>{formatDate(item.expiresAt)}</td><td><strong>{item.thresholdDays} dias</strong></td><td><span className={`alert-history-status ${item.status}`}>{item.status === "sent" ? "Enviado" : item.status === "failed" ? "Falhou" : "Pendente"}</span>{item.errorMessage && <small>{item.errorMessage}</small>}</td><td>{formatDate(item.sentAt ?? item.createdAt)}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </AppShell>;
}
