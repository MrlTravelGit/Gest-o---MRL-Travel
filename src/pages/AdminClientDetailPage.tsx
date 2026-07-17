import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Coins, Copy, ExternalLink, Gem, KeyRound, RotateCw, WalletCards } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ClientPointsForm } from "@/components/admin/ClientPointsForm";
import { ExpirationLotForm } from "@/components/admin/ExpirationLotForm";
import { ExpirationLotsList, PointTransactionsHistory } from "@/components/admin/PointTransactionsHistory";
import { ProgramAccountCard } from "@/components/admin/ProgramAccountCard";
import { formatCurrency, formatPoints } from "@/lib/formatters";
import { getAdminClientPointsDetail } from "@/services/admin-clients";
import { createDirectAccessLink, getDirectAccessLinks } from "@/services/direct-access";

export function AdminClientDetailPage() {
  const { clientId } = useParams();
  const queryClient = useQueryClient();
  const [generatedLink, setGeneratedLink] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const detail = useQuery({
    queryKey: ["admin-client-detail", clientId],
    queryFn: () => getAdminClientPointsDetail(clientId!),
    enabled: Boolean(clientId),
  });
  const accessLinks = useQuery({
    queryKey: ["direct-access-links", clientId],
    queryFn: () => getDirectAccessLinks(clientId),
    enabled: Boolean(clientId && detail.data),
  });
  const rotateLink = useMutation({
    mutationFn: () => createDirectAccessLink({ clientId: clientId!, notes: "Rotação pelo detalhe do cliente" }),
    onSuccess: (result) => {
      const fullLink = `${window.location.origin}${result.path}`;
      setGeneratedLink(fullLink);
      setCopyMessage("Novo link gerado. Copie agora; por segurança ele não poderá ser recuperado depois.");
      void queryClient.invalidateQueries({ queryKey: ["direct-access-links", clientId] });
    },
  });

  if (!clientId) return <Navigate to="/admin/clientes" replace />;

  return (
    <AppShell title={detail.data?.client.fullName ?? "Gestão do cliente"} subtitle="Pontos, custo médio, clubes e vencimentos">
      <div className="page-toolbar detail-toolbar">
        <Link className="secondary-button" to="/admin/clientes"><ArrowLeft size={17} /> Clientes</Link>
        {detail.data && <span className="status-pill">{detail.data.client.contractStatus ?? detail.data.client.status}</span>}
      </div>
      {detail.isLoading && <div className="panel-state">Carregando gestão de pontos...</div>}
      {detail.isError && <div className="panel-state error-state">{detail.error.message}</div>}
      {detail.data && <>
        <section className="detail-summary-grid">
          <Summary icon={<Coins />} label="Total de pontos" value={formatPoints(detail.data.client.totalPoints)} />
          <Summary icon={<Gem />} label="Valor estimado" value={formatCurrency(detail.data.client.estimatedValue)} />
          <Summary icon={<AlertTriangle />} label="Vencendo em 90 dias" value={formatPoints(detail.data.client.expiringPoints)} />
          <Summary icon={<WalletCards />} label="Programas ativos" value={String(detail.data.programs.filter((program) => program.accountId).length)} />
        </section>
        {!detail.data.canWrite && <div className="read-only-banner"><AlertTriangle size={18} /> Perfil auditor: consultas liberadas, alterações bloqueadas.</div>}

        <section className="module-form client-economy-admin-card">
          <div className="form-title"><KeyRound /><div><h2>Painel do cliente</h2><p>Abra uma prévia administrativa ou gere um link bearer exclusivo para o dashboard completo.</p></div></div>
          <div className="economy-admin-actions">
            <Link className="secondary-button" to={`/admin/clientes/${clientId}/painel`} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Abrir painel do cliente
            </Link>
            <button className="secondary-button" disabled={!detail.data.canWrite || rotateLink.isPending} onClick={() => rotateLink.mutate()}>
              <RotateCw size={15} /> {rotateLink.isPending ? "Gerando..." : "Gerar/rotacionar link"}
            </button>
            <button
              className="secondary-button"
              disabled={!generatedLink}
              onClick={() => {
                void navigator.clipboard.writeText(generatedLink);
                setCopyMessage("Link copiado para a área de transferência.");
              }}
            >
              <Copy size={15} /> Copiar link do cliente
            </button>
          </div>
          {generatedLink && <input className="copy-input" readOnly value={generatedLink} />}
          <p className="helper-text">
            {accessLinks.data ? `${accessLinks.data.items.filter((item) => item.status === "active").length} link ativo encontrado. ` : ""}
            O token bruto só aparece no momento da geração; se ele for perdido, rotacione novamente.
          </p>
          {copyMessage && <div className="form-success">{copyMessage}</div>}
          {rotateLink.isError && <div className="form-error">{rotateLink.error.message}</div>}
        </section>

        <section className="program-accounts-section">
          <div className="section-heading"><div><span className="eyebrow">Carteira do cliente</span><h2>Programas de fidelidade</h2><p>Todos os programas ativos aparecem, inclusive antes do primeiro lançamento.</p></div></div>
          <div className="account-cards-grid">{detail.data.programs.map((program) => <ProgramAccountCard key={program.programId} clientId={clientId} program={program} canWrite={detail.data.canWrite} />)}</div>
        </section>

        <div className="management-forms-grid">
          <ClientPointsForm clientId={clientId} publicId={detail.data.client.publicId} clientName={detail.data.client.fullName} programs={detail.data.programs} canWrite={detail.data.canWrite} />
          <ExpirationLotForm clientId={clientId} programs={detail.data.programs} canWrite={detail.data.canWrite} />
        </div>
        <PointTransactionsHistory transactions={detail.data.transactions} />
        <ExpirationLotsList lots={detail.data.expirationLots} />
      </>}
    </AppShell>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <article><div className="summary-icon">{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}
