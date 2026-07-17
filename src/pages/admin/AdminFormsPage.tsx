import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Eye, FileText, PauseCircle, RotateCcw, Send, UserPlus } from "lucide-react";
import { StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/formatters";
import { getOnboardingDetail, getOnboardingOverview, pauseOnboardingForm, publishOnboardingForm, registerOnboardingCopy, rotateOnboardingForm } from "@/services/onboarding";
import type { OnboardingDetail, OnboardingSubmissionListItem } from "@/types/onboarding";

export function AdminFormsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [duplicateOnly, setDuplicateOnly] = useState(false);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  const overview = useQuery({
    queryKey: ["onboarding-overview", search, status, duplicateOnly],
    queryFn: () => getOnboardingOverview({ search, status, duplicateOnly, limit: 40, offset: 0 }),
  });
  const detail = useQuery({
    queryKey: ["onboarding-submission-detail", selectedSubmissionId],
    queryFn: () => getOnboardingDetail(selectedSubmissionId!),
    enabled: Boolean(selectedSubmissionId),
  });

  const publish = useMutation({ mutationFn: publishOnboardingForm, onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["onboarding-overview"] }) });
  const pause = useMutation({ mutationFn: pauseOnboardingForm, onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["onboarding-overview"] }) });
  const rotate = useMutation({
    mutationFn: rotateOnboardingForm,
    onSuccess: () => {
      setCopyMessage("Link rotacionado. O endereço anterior não recebe novas respostas.");
      void queryClient.invalidateQueries({ queryKey: ["onboarding-overview"] });
    },
  });

  const publication = overview.data?.publication;
  const busy = publish.isPending || pause.isPending || rotate.isPending;

  return <AppShell title="Formulários" hideHeading>
    <PageHeader eyebrow="Entrada digital" title="Formulários de onboarding" description="Link público reutilizável para entrada de novos leads, respostas vinculadas ao cadastro e revisão administrativa." />

    <section className="onboarding-admin-grid">
      <div className="module-form onboarding-publication-card">
        <div className="form-title"><FileText/><div><h2>Link do formulário de entrada</h2><p>Envie este link para pessoas que ainda não existem no cadastro. Não há seleção de cliente.</p></div></div>
        {overview.isLoading && <LoadingState />}
        {overview.isError && <ErrorState message={overview.error.message} retry={() => void overview.refetch()} />}
        {publication && <>
          <div className="copy-box">
            <input readOnly value={publication.url ?? ""} placeholder="Publique o formulário para gerar o link" />
            <button type="button" className="secondary-button" disabled={!publication.url} onClick={() => openOnboarding(publication.url)}>
              <ExternalLink size={15}/> Abrir formulário
            </button>
          </div>
          <div className="economy-admin-actions">
            {!publication.hasPublication || publication.status !== "published" ? (
              <button type="button" className="primary-button" disabled={busy} onClick={() => publish.mutate()}><Send size={15}/> Publicar</button>
            ) : (
              <button type="button" className="secondary-button" disabled={busy} onClick={() => pause.mutate()}><PauseCircle size={15}/> Pausar recebimentos</button>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={!publication.url}
              onClick={async () => {
                const url = validateOnboardingUrl(publication.url);
                await navigator.clipboard.writeText(url);
                await registerOnboardingCopy();
                setCopyMessage("Link copiado para a área de transferência.");
              }}
            >
              <Copy size={15}/> Copiar link
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                if (confirm("Rotacionar o link? O endereço anterior deixará de aceitar respostas novas.")) rotate.mutate();
              }}
            >
              <RotateCcw size={15}/> Rotacionar link
            </button>
          </div>
          <p className="helper-text">
            Status: <strong>{publication.status}</strong>
            {publication.formVersion ? ` · versão ${publication.formVersion}` : ""}
            {publication.publishedAt ? ` · publicado em ${formatDate(publication.publishedAt)}` : ""}
          </p>
          {copyMessage && <div className="form-success">{copyMessage}</div>}
          {(publish.isError || pause.isError || rotate.isError) && <div className="form-error">{publish.error?.message ?? pause.error?.message ?? rotate.error?.message}</div>}
        </>}
      </div>
      <div className="metric-strip onboarding-summary">
        <Metric label="Novas respostas" value={overview.data?.summary.received ?? 0} />
        <Metric label="Aguardando revisão" value={overview.data?.summary.awaitingReview ?? 0} />
        <Metric label="Clientes lead" value={overview.data?.summary.clientsCreated ?? 0} />
        <Metric label="Duplicidades" value={overview.data?.summary.duplicates ?? 0} />
        <Metric label="Ativados" value={overview.data?.summary.activated ?? 0} />
      </div>
    </section>

    <section className="data-section">
      <div className="section-heading">
        <div><span className="eyebrow">Entrada</span><h2>Respostas recebidas</h2></div>
        <div className="data-filters">
          <input placeholder="Buscar nome ou e-mail" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            <option value="client_created">Cliente criado</option>
            <option value="duplicate_review">Possível duplicidade</option>
            <option value="reviewed">Revisado</option>
            <option value="activated">Ativado</option>
            <option value="rejected">Rejeitado</option>
          </select>
          <label className="check-field"><input type="checkbox" checked={duplicateOnly} onChange={(event) => setDuplicateOnly(event.target.checked)} /> Duplicidades</label>
        </div>
      </div>
      {overview.isLoading && <LoadingState />}
      {overview.isError && <ErrorState message={overview.error.message} retry={() => void overview.refetch()} />}
      {overview.data?.submissions.length === 0 && <EmptyState title="Nenhuma resposta recebida" description="Publique o formulário e envie o link para novos interessados." />}
      {overview.data && overview.data.submissions.length > 0 && <div className="responsive-table"><table><thead><tr><th>Nome informado</th><th>Contato</th><th>Recebido em</th><th>Status</th><th>Cliente criado</th><th>Duplicidade</th><th>Ações</th></tr></thead><tbody>{overview.data.submissions.map((item) => <SubmissionRow key={item.id} item={item} onOpen={setSelectedSubmissionId} />)}</tbody></table></div>}
    </section>

    {overview.data && overview.data.legacyForms.length > 0 && <section className="data-section muted-section">
      <div className="section-heading"><div><span className="eyebrow">Compatibilidade</span><h2>Onboardings antigos vinculados</h2><p>Registros preservados do modelo anterior por cliente existente. Novos formulários não usam esse fluxo.</p></div></div>
      <div className="responsive-table"><table><thead><tr><th>Formulário</th><th>Cliente</th><th>Status</th><th>Criado em</th><th>Enviado em</th></tr></thead><tbody>{overview.data.legacyForms.map((item) => <tr key={item.id}><td>{item.id.slice(0, 8)}</td><td>{item.client_id.slice(0, 8)}</td><td><StatusBadge status={item.status} /></td><td>{formatDate(item.created_at)}</td><td>{formatDate(item.submitted_at)}</td></tr>)}</tbody></table></div>
    </section>}

    {selectedSubmissionId && <OnboardingDetailPanel detail={detail.data} loading={detail.isLoading} error={detail.error?.message} close={() => setSelectedSubmissionId(null)} />}
  </AppShell>;
}

function SubmissionRow({ item, onOpen }: { item: OnboardingSubmissionListItem; onOpen: (id: string) => void }) {
  return <tr>
    <td><strong>{item.full_name}</strong><small>CPF final {item.cpf_last4 ?? "—"}</small></td>
    <td><span>{item.email}</span><small>{item.phoneMasked ?? "telefone protegido"}</small></td>
    <td>{formatDate(item.submitted_at)}</td>
    <td><StatusBadge status={item.status} /></td>
    <td>{item.client ? <a href={`/admin/clientes/${item.client.id}`}>{item.client.full_name}</a> : "—"}</td>
    <td>{item.duplicate_reason ?? "—"}</td>
    <td><div className="table-actions"><button type="button" className="table-action" onClick={() => onOpen(item.id)}><Eye size={14}/> Ver resposta</button>{item.client && <a className="table-action" href={`/admin/clientes/${item.client.id}`}><UserPlus size={14}/> Abrir cadastro</a>}</div></td>
  </tr>;
}

function OnboardingDetailPanel({ detail, loading, error, close }: { detail?: OnboardingDetail; loading: boolean; error?: string; close: () => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="confirm-modal onboarding-detail-modal"><button type="button" className="dialog-close" onClick={close}>Fechar</button>{loading && <LoadingState />}{error && <ErrorState message={error} />}{detail && <><h2>Resposta de onboarding</h2>{detail.client && <p>Cliente criado: <a href={`/admin/clientes/${detail.client.id}`}>{String(detail.client.full_name)}</a></p>}<div className="onboarding-detail-grid"><Detail title="Dados pessoais" data={pick(detail.submission, ["full_name","cpf_last4","birth_date","email","whatsapp_e164","marital_status","profession","status","duplicate_reason"])} /><Detail title="Endereço" data={pick(detail.submission, ["postal_code","state","city","neighborhood","street","address_number","address_complement"])} /><Detail title="Situação técnica" data={pick(detail.submission, ["best_bank","pf_monthly_spend","has_pj_card","pj_monthly_spend","vip_lounge_interest","uber_monthly_spend","ifood_monthly_spend","fuel_monthly_spend"])} /><Detail title="Metas" data={pick(detail.submission, ["domestic_trips_12m","international_trips_12m","business_class_interest","seat_priority","preferred_seat","all_inclusive_interest"])} /></div><Collection title="Cartões" items={detail.cards} /><Collection title="Programas declarados" items={detail.loyaltyAccounts} /><Collection title="Viagens planejadas" items={detail.plannedTrips} /><Collection title="Eventos" items={detail.events} /></>}</div></div>;
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

export function validateOnboardingUrl(url?: string | null): string {
  if (!url) throw new Error("Link indisponível.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Link inválido.");
  if (parsed.hostname !== "gestao-mrltravel.vercel.app") throw new Error("Origem não autorizada.");
  if (!/^\/entrar-na-gestao\/[A-Za-z0-9_-]{32,96}$/.test(parsed.pathname)) throw new Error("Rota do formulário inválida.");
  return parsed.toString();
}

function openOnboarding(url?: string | null) {
  const validatedUrl = validateOnboardingUrl(url);
  const opened = window.open(validatedUrl, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("Pop-up bloqueado. Copie o link manualmente.");
}
