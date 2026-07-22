import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CalendarRange, CheckCircle2, ClipboardCheck, Coins, Copy, ExternalLink, Gem, KeyRound, Pencil, RotateCcw, RotateCw, ShieldAlert, Trash2, WalletCards } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ClientPointsForm } from "@/components/admin/ClientPointsForm";
import { ExpirationLotForm } from "@/components/admin/ExpirationLotForm";
import { ExpirationLotsList, PointTransactionsHistory } from "@/components/admin/PointTransactionsHistory";
import { ProgramAccountCard } from "@/components/admin/ProgramAccountCard";
import { ClientTasksPanel } from "@/components/admin/ClientTasksPanel";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { leadActivationCopy } from "@/lib/client-admin";
import { openClientPanel, validateClientPanelUrl } from "@/lib/client-panel-link";
import { activateOnboardingLead, archiveClient, getAdminClientManagement, getAdminClientPointsDetail, getOnboardingLeadReview, reactivateClient } from "@/services/admin-clients";
import { getDirectAccessLink, registerDirectAccessCopy, revokeDirectAccessLink, rotateDirectAccessLink } from "@/services/direct-access";
import type { OnboardingLeadReview } from "@/types/admin-clients";

export function AdminClientDetailPage() {
  const { clientId } = useParams();
  const queryClient = useQueryClient();
  const [copyMessage, setCopyMessage] = useState("");
  const [activationOpen, setActivationOpen] = useState(false);
  const [reactivationOpen, setReactivationOpen] = useState(false);

  const detail = useQuery({
    queryKey: ["admin-client-detail", clientId],
    queryFn: () => getAdminClientPointsDetail(clientId!),
    enabled: Boolean(clientId),
  });
  const isLead = detail.data?.client.status === "lead";
  const isArchived = detail.data?.client.status === "ended";
  const isActive = detail.data?.client.status === "active";
  const canOperate = Boolean(detail.data?.canWrite && detail.data.client.status === "active");

  const management = useQuery({
    queryKey: ["admin-client-management", clientId],
    queryFn: () => getAdminClientManagement(clientId!),
    enabled: Boolean(clientId),
  });
  const today = new Date().toISOString().slice(0, 10);
  const activeContract = management.data?.contract;
  const hasActiveContract = Boolean(activeContract && activeContract.status === "active" && activeContract.startsOn <= today && (!activeContract.endsOn || activeContract.endsOn >= today));
  const contractPending = Boolean(isActive && (management.data?.client.contractReviewStatus === "pending_review" || !hasActiveContract));

  const onboardingReview = useQuery({
    queryKey: ["onboarding-lead-review", clientId],
    queryFn: () => getOnboardingLeadReview(clientId!),
    enabled: Boolean(clientId && isLead),
  });

  const directLink = useQuery({
    queryKey: ["direct-access-link", clientId],
    queryFn: () => getDirectAccessLink(clientId!),
    enabled: Boolean(clientId && detail.data && !isLead),
  });
  const rotateLink = useMutation({
    mutationFn: () => rotateDirectAccessLink({ clientId: clientId!, notes: "Rotação pelo detalhe do cliente" }),
    onSuccess: () => {
      setCopyMessage("Link atualizado e recuperável com segurança.");
      void queryClient.invalidateQueries({ queryKey: ["direct-access-link", clientId] });
    },
  });
  const revokeLink = useMutation({
    mutationFn: (linkId: string) => revokeDirectAccessLink(linkId, "Revogado no detalhe do cliente."),
    onSuccess: () => {
      setCopyMessage("Link revogado. O acesso público foi invalidado.");
      void queryClient.invalidateQueries({ queryKey: ["direct-access-link", clientId] });
    },
  });

  const activate = useMutation({
    mutationFn: async (input: { startsOn: string; endsOn: string; planName: string; notes?: string; generateLink: boolean }) => {
      const result = await activateOnboardingLead({ clientId: clientId!, startsOn: input.startsOn, endsOn: input.endsOn, planName: input.planName, notes: input.notes });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-client-detail", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding-lead-review", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding-overview"] }),
      ]);
      if (input.generateLink) {
        try {
          await rotateDirectAccessLink({ clientId: clientId!, notes: "Gerado automaticamente após ativação do lead" });
          await queryClient.invalidateQueries({ queryKey: ["direct-access-link", clientId] });
          setCopyMessage("Cliente ativado e link público gerado.");
        } catch (error) {
          setCopyMessage(`Cliente ativado. O link não foi gerado: ${error instanceof Error ? error.message : "tente novamente."}`);
        }
      } else {
        setCopyMessage("Cliente ativado. Operações oficiais liberadas após recarregar os dados.");
      }
      return result;
    },
    onSuccess: () => setActivationOpen(false),
  });

  const discardLead = useMutation({
    mutationFn: (confirmationName: string) => archiveClient(clientId!, confirmationName),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-client-detail", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
      ]);
    },
  });

  if (!clientId) return <Navigate to="/admin/clientes" replace />;

  return (
    <AppShell title={detail.data?.client.fullName ?? "Gestão do cliente"} subtitle="Pontos, custo médio, clubes e vencimentos">
      <div className="page-toolbar detail-toolbar">
        <Link className="secondary-button" to="/admin/clientes"><ArrowLeft size={17} /> Clientes</Link>
        <div className="detail-toolbar-actions">
          {detail.data&&<Link className="secondary-button" to={`/admin/clientes/${clientId}/editar`}><Pencil size={16}/> Editar cadastro</Link>}
          {detail.data&&isArchived&&detail.data.canWrite&&<button className="primary-button" onClick={()=>setReactivationOpen(true)}><RotateCcw size={16}/> Reativar cliente</button>}
          {detail.data && <span className="status-pill">{isLead ? "Aguardando ativação" : isArchived ? "Arquivado" : contractPending ? "Contrato pendente de revisão" : detail.data.client.contractStatus ?? detail.data.client.status}</span>}
        </div>
      </div>
      {detail.isLoading && <div className="panel-state">Carregando gestão de pontos...</div>}
      {detail.isError && <div className="panel-state error-state">{detail.error.message}</div>}
      {detail.data && <>
        {isLead && <LeadActivationBanner
          canWrite={detail.data.canWrite}
          clientName={detail.data.client.fullName}
          review={onboardingReview.data}
          reviewLoading={onboardingReview.isLoading}
          reviewError={onboardingReview.error?.message}
          onReview={() => document.getElementById("onboarding-review")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          onActivate={() => setActivationOpen(true)}
          onDiscard={() => {
            const confirmation = window.prompt(`Digite o nome completo para descartar o lead: ${detail.data.client.fullName}`);
            if (confirmation) discardLead.mutate(confirmation);
          }}
        />}
        {contractPending&&<div className="contract-review-warning contract-review-callout"><AlertTriangle size={18}/><div><strong>Contrato pendente de revisão</strong><span>O painel público de leitura continua disponível. Cadastre a vigência quando os dados jurídicos estiverem confirmados.</span></div><Link className="contract-review-action" to={`/admin/clientes/${clientId}/editar#contrato`}><CalendarRange size={15}/> Cadastrar vigência</Link></div>}

        <section className="detail-summary-grid">
          <Summary icon={<Coins />} label="Total de pontos" value={formatPoints(detail.data.client.totalPoints)} />
          <Summary icon={<Gem />} label="Valor estimado" value={formatCurrency(detail.data.client.estimatedValue)} />
          <Summary icon={<AlertTriangle />} label="Vencendo em 90 dias" value={formatPoints(detail.data.client.expiringPoints)} />
          <Summary icon={<WalletCards />} label="Programas ativos" value={String(detail.data.programs.filter((program) => program.accountId).length)} />
        </section>
        {!detail.data.canWrite && <div className="read-only-banner"><AlertTriangle size={18} /> Perfil auditor: consultas liberadas, alterações bloqueadas.</div>}

        <section className="module-form client-economy-admin-card">
          <div className="form-title"><KeyRound /><div><h2>Painel do cliente</h2><p>Link bearer recuperável para o dashboard público completo. Tokens legados precisam ser rotacionados uma vez.</p></div></div>
          {!isActive && <div className="lead-operation-lock"><ShieldAlert size={18} /> {isLead ? "Ative o cliente para liberar a geração do link público." : "Reative o cliente para gerar, copiar ou abrir o painel público."}</div>}
          <div className="copy-box">
            <input className="copy-input" readOnly value={isActive ? directLink.data?.url ?? "" : ""} placeholder={!isActive ? "Disponível somente para cliente ativo" : directLink.isLoading ? "Carregando link..." : "Nenhum link recuperável disponível"} />
            <button type="button" className="secondary-button" disabled={!isActive || !directLink.data?.url} onClick={() => {
              const result = openClientPanel(directLink.data?.url);
              if (result.opened) return;
              setCopyMessage(result.message);
              if (result.url) void navigator.clipboard.writeText(result.url).then(() => setCopyMessage("Pop-up bloqueado. O link foi copiado para a área de transferência.")).catch(() => undefined);
            }}>
              <ExternalLink size={15} /> Abrir painel do cliente
            </button>
          </div>
          <div className="economy-admin-actions">
            <Link className="secondary-button" to={`/admin/clientes/${clientId}/painel`} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Prévia administrativa
            </Link>
            <button type="button" className="secondary-button" disabled={!isActive || !detail.data.canWrite || rotateLink.isPending} onClick={() => rotateLink.mutate()}>
              <RotateCw size={15} /> {rotateLink.isPending ? "Gerando..." : directLink.data?.hasActiveLink ? "Rotacionar link" : "Gerar link"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!isActive || !directLink.data?.url}
              onClick={async () => {
                const url = validateClientPanelUrl(directLink.data?.url);
                await navigator.clipboard.writeText(url);
                if (directLink.data?.linkId) await registerDirectAccessCopy(directLink.data.linkId);
                setCopyMessage("Link copiado para a área de transferência.");
              }}
            >
              <Copy size={15} /> Copiar link
            </button>
            <button
              type="button"
              className="secondary-button danger-button"
              disabled={isLead || !detail.data.canWrite || !directLink.data?.linkId || revokeLink.isPending}
              onClick={() => {
                if (directLink.data?.linkId && confirm("Revogar o link atual do painel do cliente?")) revokeLink.mutate(directLink.data.linkId);
              }}
            >
              Revogar link
            </button>
          </div>
          <p className="helper-text">
            {!isActive && (isLead ? "Ative o cliente antes de gerar o link." : "O cliente arquivado não pode gerar ou utilizar o painel público.")}
            {isActive && directLink.data?.hasActiveLink && directLink.data.recoverable && "Link ativo recuperável. Ele continuará disponível após refresh para administradores autorizados."}
            {isActive && directLink.data?.hasActiveLink && !directLink.data.recoverable && "Link ativo legado — é necessário rotacionar uma vez para torná-lo recuperável."}
            {isActive && directLink.data && !directLink.data.hasActiveLink && "Nenhum link ativo. Gere um link para disponibilizar o painel público."}
          </p>
          {copyMessage && <div className="form-success">{copyMessage}</div>}
          {directLink.isError && <div className="form-error">{directLink.error.message}</div>}
          {rotateLink.isError && <div className="form-error">{rotateLink.error.message}</div>}
          {revokeLink.isError && <div className="form-error">{revokeLink.error.message}</div>}
          {discardLead.isError && <div className="form-error">{discardLead.error.message}</div>}
        </section>

        <section className="program-accounts-section">
          <div className="section-heading"><div><span className="eyebrow">Carteira do cliente</span><h2>Programas de fidelidade</h2><p>{isLead ? "Saldos declarados no onboarding aparecem abaixo como pendentes de conferência; não alteram saldos oficiais." : "Todos os programas ativos aparecem, inclusive antes do primeiro lançamento."}</p></div></div>
          <div className="account-cards-grid">{detail.data.programs.map((program) => <ProgramAccountCard key={program.programId} clientId={clientId} program={program} canWrite={canOperate} />)}</div>
        </section>

        {isLead && <OnboardingReviewSection review={onboardingReview.data} loading={onboardingReview.isLoading} error={onboardingReview.error?.message} />}

        <ClientTasksPanel clientId={clientId} clientName={detail.data.client.fullName} canWrite={Boolean(detail.data.canWrite)} />

        {isLead && <div className="lead-operation-lock forms-lock"><ShieldAlert size={18} /> Lançamentos, transferências, saídas e vencimentos oficiais ficam bloqueados até a ativação e criação do contrato.</div>}
        <div className="management-forms-grid">
          <ClientPointsForm clientId={clientId} publicId={detail.data.client.publicId} clientName={detail.data.client.fullName} programs={detail.data.programs} canWrite={canOperate} disabledReason={isLead ? "Ative o cliente antes de realizar esta operação." : undefined} />
          <ExpirationLotForm clientId={clientId} programs={detail.data.programs} canWrite={canOperate} disabledReason={isLead ? "Ative o cliente antes de classificar vencimentos." : undefined} />
        </div>
        <PointTransactionsHistory transactions={detail.data.transactions} />
        <ExpirationLotsList lots={detail.data.expirationLots} />

        {activationOpen && <ActivateLeadModal
          clientName={detail.data.client.fullName}
          review={onboardingReview.data}
          busy={activate.isPending}
          error={activate.error?.message}
          onClose={() => setActivationOpen(false)}
          onSubmit={(input) => activate.mutate(input)}
        />}
        {reactivationOpen && (
          <DetailReactivationDialog
            clientId={clientId}
            clientName={detail.data.client.fullName}
            rowVersion={management.data?.client.rowVersion}
            points={detail.data.client.totalPoints}
            programs={detail.data.programs.filter((program) => program.accountId).length}
            contractPending={contractPending}
            onClose={() => setReactivationOpen(false)}
          />
        )}
      </>}
    </AppShell>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <article><div className="summary-icon">{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}

function LeadActivationBanner({ canWrite, clientName, review, reviewLoading, reviewError, onReview, onActivate, onDiscard }: { canWrite: boolean; clientName: string; review?: OnboardingLeadReview; reviewLoading: boolean; reviewError?: string; onReview: () => void; onActivate: () => void; onDiscard: () => void }) {
  const checklist = readinessChecklist(review);
  const copy = leadActivationCopy(clientName);
  return <section className="lead-activation-banner">
    <div className="lead-banner-copy">
      <span className="eyebrow">Cadastro recebido pelo formulário de onboarding</span>
      <h2>{copy.title}</h2>
      <p>{copy.support}</p>
      {reviewLoading && <small>Carregando respostas de onboarding...</small>}
      {reviewError && <small className="field-error">{reviewError}</small>}
    </div>
    <div className="lead-actions">
      <button type="button" className="secondary-button" onClick={onReview}><ClipboardCheck size={15} /> Revisar onboarding</button>
      <button type="button" className="primary-button" disabled={!canWrite} onClick={onActivate}><CheckCircle2 size={15} /> Ativar cliente</button>
      <button type="button" className="danger-button" disabled={!canWrite} onClick={onDiscard}><Trash2 size={15} /> Encerrar lead</button>
      <Link className="secondary-button" to="/admin/clientes">Voltar para clientes</Link>
    </div>
    <div className="lead-checklist">
      {checklist.map((item) => <span key={item.label} className={item.ok ? "ok" : "pending"}>{item.ok ? "✓" : "•"} {item.label}</span>)}
    </div>
  </section>;
}

function DetailReactivationDialog({clientId,clientName,rowVersion,points,programs,contractPending,onClose}:{clientId:string;clientName:string;rowVersion?:number;points:number;programs:number;contractPending:boolean;onClose:()=>void}){
  const qc=useQueryClient();const [note,setNote]=useState("");const [confirmed,setConfirmed]=useState(false);
  const mutation=useMutation({mutationFn:()=>reactivateClient(clientId,note,rowVersion),onSuccess:async()=>{await Promise.all([qc.invalidateQueries({queryKey:["admin-client-detail",clientId]}),qc.invalidateQueries({queryKey:["admin-client-management",clientId]}),qc.invalidateQueries({queryKey:["admin-clients"]}),qc.invalidateQueries({queryKey:["admin-overview"]})]);onClose();}});
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Reativar ${clientName}`}><form className="confirm-modal reactivation-modal" onSubmit={event=>{event.preventDefault();if(confirmed)mutation.mutate();}}><button type="button" className="dialog-close" onClick={onClose}>Fechar</button><span className="eyebrow">Reativação individual</span><h2>Reativar cliente</h2><div className="reactivation-person"><strong>{clientName}</strong><span>{formatPoints(points)} pontos · {programs} programas</span></div>{contractPending&&<div className="contract-review-warning">Sem vigência confiável: o cliente ficará ativo com contrato pendente de revisão.</div>}<label>Observação<textarea rows={3} value={note} onChange={event=>setNote(event.target.value)}/></label><label className="check-field"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/> Confirmo que saldos, links e histórico devem ser preservados.</label>{mutation.isError&&<div className="form-error">{mutation.error.message}</div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={!confirmed||mutation.isPending}>{mutation.isPending?"Reativando...":"Reativar cliente"}</button></div></form></div>;
}

function readinessChecklist(review?: OnboardingLeadReview) {
  const submission = review?.submission;
  return [
    { label: "dados pessoais recebidos", ok: Boolean(submission?.full_name) },
    { label: "contato válido", ok: Boolean(submission?.email || submission?.whatsapp_e164) },
    { label: "possível duplicidade resolvida", ok: Boolean(submission && submission.status !== "duplicate_review" && !submission.duplicate_candidate_client_id) },
    { label: "onboarding enviado", ok: Boolean(submission?.submitted_at || submission?.lead_created_at) },
    { label: "início do contrato", ok: false },
    { label: "término do contrato", ok: false },
    { label: "plano", ok: false },
  ];
}

function OnboardingReviewSection({ review, loading, error }: { review?: OnboardingLeadReview; loading: boolean; error?: string }) {
  return <section id="onboarding-review" className="module-form onboarding-review-card">
    <div className="form-title"><ClipboardCheck /><div><h2>Revisão do onboarding</h2><p>Dados declaratórios recebidos pelo formulário. Eles não viram saldo oficial sem lançamento administrativo.</p></div></div>
    {loading && <div className="panel-state">Carregando respostas...</div>}
    {error && <div className="form-error">{error}</div>}
    {!loading && !error && !review?.submission && <div className="read-only-banner">Nenhuma submissão vinculada a este lead.</div>}
    {review?.submission && <>
      <div className="lead-review-grid">
        <DetailBlock title="Contato" rows={{ Nome: review.submission.full_name, "CPF final": review.submission.cpf_last4, Email: review.submission.email, WhatsApp: review.submission.whatsapp_e164, Status: review.submission.status }} />
        <DetailBlock title="Situação técnica" rows={{ "Banco principal": review.submission.best_bank, "Gasto PF": formatCurrency(Number(review.submission.pf_monthly_spend ?? 0)), Expectativas: review.submission.service_expectations }} />
      </div>
      <ReviewCollection title="Cartões declarados" items={review.cards} />
      <ReviewCollection title="Programas declarados — pendentes de conferência" items={review.loyaltyAccounts} />
      <ReviewCollection title="Viagens planejadas" items={review.plannedTrips} />
    </>}
  </section>;
}

function DetailBlock({ title, rows }: { title: string; rows: Record<string, unknown> }) {
  return <article className="lead-review-block"><h3>{title}</h3>{Object.entries(rows).map(([label, value]) => <p key={label}><span>{label}</span><strong>{String(value ?? "—")}</strong></p>)}</article>;
}

function ReviewCollection({ title, items }: { title: string; items: Array<Record<string, unknown>> }) {
  if (!items.length) return null;
  return <div className="lead-review-collection"><h3>{title}</h3><div>{items.map((item, index) => <article key={index}>{Object.entries(item).map(([key, value]) => <p key={key}><span>{key}</span><strong>{String(value ?? "—")}</strong></p>)}</article>)}</div></div>;
}

function defaultStartDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function oneYearAfter(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setFullYear(date.getFullYear() + 1);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function ActivateLeadModal({ clientName, review, busy, error, onClose, onSubmit }: { clientName: string; review?: OnboardingLeadReview; busy: boolean; error?: string; onClose: () => void; onSubmit: (input: { startsOn: string; endsOn: string; planName: string; notes?: string; generateLink: boolean }) => void }) {
  const [startsOn, setStartsOn] = useState(defaultStartDate);
  const [endsOn, setEndsOn] = useState(() => oneYearAfter(defaultStartDate()));
  const [planName, setPlanName] = useState("Gestão MRL Travel");
  const [notes, setNotes] = useState("");
  const [generateLink, setGenerateLink] = useState(true);
  const [localError, setLocalError] = useState("");
  const duplicateBlocked = review?.submission?.status === "duplicate_review" || Boolean(review?.submission?.duplicate_candidate_client_id);

  const summary = useMemo(() => [
    `Cliente: ${clientName}`,
    `Vigência: ${formatDate(startsOn)} — ${formatDate(endsOn)}`,
    `Plano: ${planName || "pendente"}`,
    "Mudança: Lead → Cliente ativo",
  ], [clientName, endsOn, planName, startsOn]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError("");
    if (duplicateBlocked) return setLocalError("Resolva a possível duplicidade antes de ativar.");
    if (!startsOn || !endsOn || endsOn < startsOn) return setLocalError("Confira as datas de início e término da gestão.");
    if (!planName.trim()) return setLocalError("Informe o plano contratado.");
    onSubmit({ startsOn, endsOn, planName: planName.trim(), notes: notes.trim() || undefined, generateLink });
  }

  return <div className="modal-backdrop" role="dialog" aria-modal="true">
    <form className="confirm-modal activate-lead-modal" onSubmit={submit}>
      <button type="button" className="dialog-close" onClick={onClose}>Fechar</button>
      <h2>Ativar cliente</h2>
      <p>Revise os dados já recebidos e informe somente a vigência operacional. Nenhum usuário Auth será criado.</p>
      <div className="activation-summary">{summary.map((item) => <span key={item}>{item}</span>)}</div>
      <div className="form-grid">
        <label>Nome<input readOnly value={clientName} /></label>
        <label>Contato<input readOnly value={review?.submission?.email ?? review?.submission?.whatsapp_e164 ?? ""} placeholder="Contato pendente" /></label>
        <label>Início da gestão<input type="date" value={startsOn} onChange={(event) => { setStartsOn(event.target.value); if (!endsOn || endsOn < event.target.value) setEndsOn(oneYearAfter(event.target.value)); }} required /></label>
        <label>Término da gestão<input type="date" min={startsOn} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required /></label>
        <label className="field-wide">Plano<input value={planName} onChange={(event) => setPlanName(event.target.value)} required /></label>
        <label className="field-full">Observação interna<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      </div>
      <label className="check-field"><input type="checkbox" checked={generateLink} onChange={(event) => setGenerateLink(event.target.checked)} /> Gerar link do painel após ativar</label>
      {(localError || error) && <div className="form-error" role="alert">{localError || error}</div>}
      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" disabled={busy || duplicateBlocked}>{busy ? "Ativando..." : "Confirmar ativação"}</button>
      </div>
    </form>
  </div>;
}
