import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, FileText, RotateCcw, XCircle } from "lucide-react";
import { ClientSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/formatters";
import { getAdminFormOptions } from "@/services/admin-options";
import { createOnboardingForm, getOnboardingDetail, getOnboardingForms, reopenOnboardingForm, revokeOnboardingForm } from "@/services/onboarding";
import type { OnboardingDetail, OnboardingFormListItem } from "@/types/onboarding";

export function AdminFormsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiryDate());
  const [generatedLink, setGeneratedLink] = useState("");
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const origin = useMemo(() => window.location.origin, []);

  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const forms = useQuery({ queryKey: ["onboarding-forms", search, status], queryFn: () => getOnboardingForms({ search, status, limit: 30, offset: 0 }) });
  const detail = useQuery({ queryKey: ["onboarding-detail", selectedFormId], queryFn: () => getOnboardingDetail(selectedFormId!), enabled: Boolean(selectedFormId) });

  const create = useMutation({
    mutationFn: () => createOnboardingForm({ clientId, expiresAt: `${expiresAt}T23:59:59`, notes: "Gerado pelo painel Formulários" }),
    onSuccess: (result) => {
      setGeneratedLink(`${origin}${result.path}`);
      void queryClient.invalidateQueries({ queryKey: ["onboarding-forms"] });
    },
  });
  const revoke = useMutation({ mutationFn: (formId: string) => revokeOnboardingForm(formId, "Revogado no painel de onboarding."), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["onboarding-forms"] }) });
  const reopen = useMutation({ mutationFn: (formId: string) => reopenOnboardingForm(formId, `${defaultExpiryDate()}T23:59:59`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["onboarding-forms"] }) });

  return <AppShell title="Formulários" hideHeading>
    <PageHeader eyebrow="Entrada digital" title="Formulários de onboarding" description="Gere links únicos, acompanhe respostas e revise dados declarados pelos clientes." action={<button className="primary-button" form="generate-onboarding-form"><FileText size={16}/> Gerar formulário</button>} />

    <section className="onboarding-admin-grid">
      <form id="generate-onboarding-form" className="module-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <div className="form-title"><FileText/><div><h2>Gerar formulário</h2><p>O token bruto aparece somente agora. Se perder o link, gere outro.</p></div></div>
        {options.isLoading && <LoadingState />}
        {options.isError && <ErrorState message={options.error.message} />}
        {options.data && <div className="form-grid"><label>Cliente<ClientSelect clients={options.data.clients} value={clientId} onChange={setClientId} /></label><label>Validade<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div>}
        {create.isError && <div className="form-error">{create.error.message}</div>}
        {generatedLink && <div className="copy-box"><input readOnly value={generatedLink} /><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(generatedLink)}><Copy size={15}/> Copiar</button></div>}
        <button className="primary-button" disabled={!clientId || create.isPending}>{create.isPending ? "Gerando..." : "Gerar e rotacionar"}</button>
      </form>
      <div className="metric-strip onboarding-summary">
        <Metric label="Pendentes" value={forms.data?.summary.pending ?? 0} />
        <Metric label="Em andamento" value={forms.data?.summary.inProgress ?? 0} />
        <Metric label="Enviados" value={forms.data?.summary.submitted ?? 0} />
        <Metric label="Expirados" value={forms.data?.summary.expired ?? 0} />
      </div>
    </section>

    <section className="data-section">
      <div className="section-heading">
        <div><span className="eyebrow">Operação</span><h2>Onboardings gerados</h2></div>
        <div className="data-filters"><input placeholder="Buscar cliente" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="pending">Pendente</option><option value="in_progress">Em andamento</option><option value="submitted">Enviado</option><option value="expired">Expirado</option><option value="revoked">Revogado</option></select></div>
      </div>
      {forms.isLoading && <LoadingState />}
      {forms.isError && <ErrorState message={forms.error.message} retry={() => void forms.refetch()} />}
      {forms.data?.items.length === 0 && <EmptyState title="Nenhum onboarding" description="Gere um formulário para um cliente já cadastrado." />}
      {forms.data && forms.data.items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Status</th><th>Criado em</th><th>Expira em</th><th>Iniciado em</th><th>Enviado em</th><th>Ações</th></tr></thead><tbody>{forms.data.items.map((item) => <OnboardingRow key={item.formId} item={item} onOpen={setSelectedFormId} onRevoke={(id) => revoke.mutate(id)} onReopen={(id) => reopen.mutate(id)} busy={revoke.isPending || reopen.isPending} />)}</tbody></table></div>}
    </section>

    {selectedFormId && <OnboardingDetailPanel detail={detail.data} loading={detail.isLoading} error={detail.error?.message} close={() => setSelectedFormId(null)} />}
  </AppShell>;
}

function OnboardingRow({ item, onOpen, onRevoke, onReopen, busy }: { item: OnboardingFormListItem; onOpen: (id: string) => void; onRevoke: (id: string) => void; onReopen: (id: string) => void; busy: boolean }) {
  return <tr><td><strong>{item.clientName}</strong><small>Final {item.tokenHint ?? "—"}</small></td><td><StatusBadge status={item.status} /></td><td>{formatDate(item.createdAt)}</td><td>{formatDate(item.expiresAt)}</td><td>{formatDate(item.startedAt)}</td><td>{formatDate(item.submittedAt)}</td><td><div className="table-actions"><button className="table-action" onClick={() => onOpen(item.formId)}><Eye size={14}/> Abrir</button><button className="table-action" disabled={busy || item.status === "revoked"} onClick={() => onRevoke(item.formId)}><XCircle size={14}/> Revogar</button><button className="table-action" disabled={busy || item.status !== "submitted"} onClick={() => onReopen(item.formId)}><RotateCcw size={14}/> Reabrir</button></div></td></tr>;
}

function OnboardingDetailPanel({ detail, loading, error, close }: { detail?: OnboardingDetail; loading: boolean; error?: string; close: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="confirm-modal onboarding-detail-modal"><button className="dialog-close" onClick={close}>Fechar</button>{loading && <LoadingState />}{error && <ErrorState message={error} />}{detail && <><h2>Resposta de onboarding</h2><p>{detail.form.clientName} · <StatusBadge status={detail.form.status}/></p>{detail.submission ? <div className="onboarding-detail-grid"><Detail title="Dados pessoais" data={pick(detail.submission, ["full_name","cpf_last4","birth_date","email","whatsapp_e164","marital_status","profession"])} /><Detail title="Endereço" data={pick(detail.submission, ["postal_code","state","city","neighborhood","street","address_number","address_complement"])} /><Detail title="Situação técnica" data={pick(detail.submission, ["best_bank","pf_monthly_spend","has_pj_card","pj_monthly_spend","vip_lounge_interest","uber_monthly_spend","ifood_monthly_spend","fuel_monthly_spend"])} /><Detail title="Metas" data={pick(detail.submission, ["domestic_trips_12m","international_trips_12m","business_class_interest","seat_priority","preferred_seat","all_inclusive_interest"])} /></div> : <EmptyState title="Sem submissão" description="O cliente ainda não enviou o onboarding." />}<Collection title="Cartões" items={detail.cards} /><Collection title="Programas declarados" items={detail.loyaltyAccounts} /><Collection title="Viagens planejadas" items={detail.plannedTrips} /><Collection title="Divergências para revisão" items={detail.divergences} /><Collection title="Eventos" items={detail.events} /></>}</div></div>;
}

function Detail({ title, data }: { title: string; data: Record<string, unknown> }) {
  return <section><h3>{title}</h3>{Object.entries(data).map(([key, value]) => <p key={key}><span>{key}</span><strong>{String(value ?? "—")}</strong></p>)}</section>;
}

function Collection({ title, items }: { title: string; items: Array<Record<string, unknown>> }) {
  if (!items.length) return null;
  return <section className="detail-collection"><h3>{title}</h3>{items.map((item, index) => <div key={index}>{Object.entries(item).slice(0, 8).map(([key, value]) => <p key={key}><span>{key}</span><strong>{String(value ?? "—")}</strong></p>)}</div>)}</section>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value}</strong></article>;
}

function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function defaultExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}
