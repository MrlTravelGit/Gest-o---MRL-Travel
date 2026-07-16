import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarCheck, Gem, PauseCircle } from "lucide-react";
import { ClientSelect, ProgramAccountSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate, formatPoints } from "@/lib/formatters";
import { getAdminFormOptions } from "@/services/admin-options";
import { confirmScheduledCredit, getClubCatalog, getClubSubscriptions, upsertClubSubscription } from "@/services/admin-clubs";

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7) + "-01";

export function AdminClubsPage() {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const catalog = useQuery({ queryKey: ["club-catalog"], queryFn: getClubCatalog });
  const [status, setStatus] = useState("all");
  const subscriptions = useQuery({ queryKey: ["club-subscriptions", status], queryFn: () => getClubSubscriptions(status) });
  const [form, setForm] = useState({ clientId: "", accountId: "", planId: "", status: "active" as const, startsOn: today, endsOn: "", expectedCreditDay: 1, nextCompetence: month, notes: "" });
  const client = options.data?.clients.find((item) => item.clientId === form.clientId);
  const account = client?.accounts.find((item) => item.accountId === form.accountId);
  const availablePlans = useMemo(() => catalog.data?.plans.filter((plan) => !account || plan.programId === account.programId) ?? [], [account, catalog.data]);
  const save = useMutation({ mutationFn: upsertClubSubscription, onSuccess: () => { setForm((current) => ({ ...current, notes: "" })); void Promise.all([queryClient.invalidateQueries({ queryKey: ["club-subscriptions"] }), queryClient.invalidateQueries({ queryKey: ["admin-form-options"] })]); } });
  const confirm = useMutation({ mutationFn: (creditId: string) => confirmScheduledCredit(creditId, crypto.randomUUID()), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["club-subscriptions"] }) });

  return <AppShell title="Clubes" hideHeading>
    <PageHeader eyebrow="Clubes de fidelidade" title="Catálogo e assinaturas" description="Planos são dados versionados; previsão de pontos não altera saldo até confirmação manual." />
    {(options.isLoading || catalog.isLoading) && <LoadingState />}
    {(options.isError || catalog.isError) && <ErrorState message={(options.error ?? catalog.error)?.message ?? "Falha ao carregar clubes"} />}
    {options.data && catalog.data && <section className="module-grid two-columns">
      <form className="module-form" onSubmit={(event) => { event.preventDefault(); save.mutate(form); }}>
        <div className="form-title"><Gem /><div><h2>Assinatura do cliente</h2><p>O backend confere cliente, conta e programa do plano.</p></div></div>
        <div className="form-grid">
          <label>Cliente<ClientSelect clients={options.data.clients} value={form.clientId} onChange={(clientId) => setForm((current) => ({ ...current, clientId, accountId: "", planId: "" }))} /></label>
          <label>Conta<ProgramAccountSelect client={client} value={form.accountId} onChange={(accountId) => setForm((current) => ({ ...current, accountId, planId: "" }))} /></label>
          <label>Plano<select value={form.planId} onChange={(event) => setForm((current) => ({ ...current, planId: event.target.value }))} required><option value="">Selecione</option>{availablePlans.map((plan) => <option key={plan.planId} value={plan.planId}>{plan.programName} · {plan.name}</option>)}</select></label>
          <label>Status<select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as "active" }))}><option value="active">Ativo</option><option value="paused">Pausado</option><option value="cancelled">Cancelado</option></select></label>
          <label>Início<input type="date" value={form.startsOn} onChange={(event) => setForm((current) => ({ ...current, startsOn: event.target.value }))} required /></label>
          <label>Fim<input type="date" value={form.endsOn} onChange={(event) => setForm((current) => ({ ...current, endsOn: event.target.value }))} /></label>
          <label>Dia de crédito<input type="number" min={1} max={28} value={form.expectedCreditDay} onChange={(event) => setForm((current) => ({ ...current, expectedCreditDay: Number(event.target.value) }))} /></label>
          <label>Competência<input type="month" value={form.nextCompetence.slice(0, 7)} onChange={(event) => setForm((current) => ({ ...current, nextCompetence: `${event.target.value}-01` }))} /></label>
          <label className="field-full">Observação<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
        </div>
        {save.isError && <div className="form-error">{save.error.message}</div>}
        {save.isSuccess && <div className="form-success">Assinatura salva e previsão mensal atualizada.</div>}
        <button className="primary-button" disabled={!options.data.canWrite || save.isPending}>{save.isPending ? "Salvando..." : "Salvar assinatura"}</button>
      </form>
      <div className="module-form read-panel">
        <div className="form-title"><BadgeCheck /><div><h2>Catálogo versionado</h2><p>{catalog.data.plans.length} planos cadastrados com fonte e data de verificação.</p></div></div>
        <div className="catalog-list">{catalog.data.plans.slice(0, 12).map((plan) => <article key={plan.planId}><strong>{plan.programName} · {plan.name}</strong><span>{formatPoints(plan.monthlyPoints)} / mês {plan.pointsDoNotExpire ? "· sem expiração enquanto ativo" : ""}</span><small>{plan.sourceVerifiedOn} · {plan.sourceNotes ?? "Fonte oficial"}</small></article>)}</div>
      </div>
    </section>}
    <section className="data-section">
      <div className="section-heading"><div><span className="eyebrow">Conciliação</span><h2>Assinaturas e créditos previstos</h2></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos</option><option value="active">Ativas</option><option value="paused">Pausadas</option><option value="cancelled">Canceladas</option></select></div>
      {subscriptions.isLoading && <LoadingState />}{subscriptions.isError && <ErrorState message={subscriptions.error.message} />}{subscriptions.data?.items.length === 0 && <EmptyState title="Nenhuma assinatura" description="Cadastre uma assinatura para gerar previsões de crédito." />}
      {subscriptions.data && subscriptions.data.items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Plano</th><th>Próximo crédito</th><th>Status</th><th>Previsões</th></tr></thead><tbody>{subscriptions.data.items.map((item) => <tr key={item.subscriptionId}><td><strong>{item.clientName}</strong><small>{item.programName}</small></td><td>{item.planName}<small>{formatPoints(item.monthlyPoints)} mensais</small></td><td>{formatDate(item.nextCompetence)}<small>dia {item.expectedCreditDay}</small></td><td><StatusBadge status={item.status} /></td><td>{item.credits?.slice(0, 2).map((credit) => <div className="inline-action" key={credit.creditId}><span>{formatDate(credit.expectedCreditOn)} · {formatPoints(credit.expectedPoints)} · {credit.status}</span>{credit.status === "expected" && <button className="table-action" onClick={() => confirm.mutate(credit.creditId)}><CalendarCheck size={14}/> Confirmar</button>}</div>)}</td></tr>)}</tbody></table></div>}
      {confirm.isError && <div className="form-error">{confirm.error.message}</div>}
    </section>
  </AppShell>;
}
