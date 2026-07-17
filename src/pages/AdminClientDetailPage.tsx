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
import { getDirectAccessLink, registerDirectAccessCopy, revokeDirectAccessLink, rotateDirectAccessLink } from "@/services/direct-access";

export function AdminClientDetailPage() {
  const { clientId } = useParams();
  const queryClient = useQueryClient();
  const [copyMessage, setCopyMessage] = useState("");
  const detail = useQuery({
    queryKey: ["admin-client-detail", clientId],
    queryFn: () => getAdminClientPointsDetail(clientId!),
    enabled: Boolean(clientId),
  });
  const directLink = useQuery({
    queryKey: ["direct-access-link", clientId],
    queryFn: () => getDirectAccessLink(clientId!),
    enabled: Boolean(clientId && detail.data),
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
          <div className="form-title"><KeyRound /><div><h2>Painel do cliente</h2><p>Link bearer recuperável para o dashboard público completo. Tokens legados precisam ser rotacionados uma vez.</p></div></div>
          <div className="copy-box">
            <input className="copy-input" readOnly value={directLink.data?.url ?? ""} placeholder={directLink.isLoading ? "Carregando link..." : "Nenhum link recuperável disponível"} />
            <button type="button" className="secondary-button" disabled={!directLink.data?.url} onClick={() => openClientPanel(directLink.data?.url)}>
              <ExternalLink size={15} /> Abrir painel do cliente
            </button>
          </div>
          <div className="economy-admin-actions">
            <Link className="secondary-button" to={`/admin/clientes/${clientId}/painel`} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Prévia administrativa
            </Link>
            <button type="button" className="secondary-button" disabled={!detail.data.canWrite || rotateLink.isPending} onClick={() => rotateLink.mutate()}>
              <RotateCw size={15} /> {rotateLink.isPending ? "Gerando..." : directLink.data?.hasActiveLink ? "Rotacionar link" : "Gerar link"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!directLink.data?.url}
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
              disabled={!detail.data.canWrite || !directLink.data?.linkId || revokeLink.isPending}
              onClick={() => {
                if (directLink.data?.linkId && confirm("Revogar o link atual do painel do cliente?")) revokeLink.mutate(directLink.data.linkId);
              }}
            >
              Revogar link
            </button>
          </div>
          <p className="helper-text">
            {directLink.data?.hasActiveLink && directLink.data.recoverable && "Link ativo recuperável. Ele continuará disponível após refresh para administradores autorizados."}
            {directLink.data?.hasActiveLink && !directLink.data.recoverable && "Link ativo legado — é necessário rotacionar uma vez para torná-lo recuperável."}
            {directLink.data && !directLink.data.hasActiveLink && "Nenhum link ativo. Gere um link para disponibilizar o painel público."}
          </p>
          {copyMessage && <div className="form-success">{copyMessage}</div>}
          {directLink.isError && <div className="form-error">{directLink.error.message}</div>}
          {rotateLink.isError && <div className="form-error">{rotateLink.error.message}</div>}
          {revokeLink.isError && <div className="form-error">{revokeLink.error.message}</div>}
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

export function validateClientPanelUrl(url?: string | null): string {
  if (!url) throw new Error("Link indisponível.");
  const parsed = new URL(url);
  const allowedHost = new URL("https://gestao-mrltravel.vercel.app").hostname;
  if (parsed.protocol !== "https:") throw new Error("Link inválido.");
  if (parsed.hostname !== allowedHost) throw new Error("Origem não autorizada.");
  if (!/^\/economia\/[a-f0-9]{64}$/i.test(parsed.pathname)) throw new Error("Rota do painel inválida.");
  return parsed.toString();
}

function openClientPanel(url?: string | null) {
  const validatedUrl = validateClientPanelUrl(url);
  const opened = window.open(validatedUrl, "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("Pop-up bloqueado. Copie o link manualmente.");
}
