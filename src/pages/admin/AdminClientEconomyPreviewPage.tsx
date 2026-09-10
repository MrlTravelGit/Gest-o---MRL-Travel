import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/admin/AdminPage";
import { ClientDashboardView } from "@/components/client/ClientDashboardView";
import { AppShell } from "@/components/layout/AppShell";
import { AdminPreviewNotFoundError, getAdminClientDashboardPreview } from "@/services/dashboard";

export function AdminClientEconomyPreviewPage() {
  const { clientId } = useParams();
  const dashboard = useQuery({
    queryKey: ["admin-client-dashboard-preview", clientId],
    queryFn: () => getAdminClientDashboardPreview(clientId!),
    enabled: Boolean(clientId),
  });

  if (!clientId) return <Navigate to="/admin/clientes" replace />;

  if (dashboard.error instanceof AdminPreviewNotFoundError) {
    return <AppShell title="Cliente não encontrado" hideHeading><div className="not-found admin-preview-not-found"><h1>Cliente não encontrado</h1><p>O identificador informado não corresponde a um cliente disponível.</p><Link className="secondary-button" to="/admin/clientes"><ArrowLeft size={17} /> Voltar para clientes</Link></div></AppShell>;
  }

  return (
    <AppShell title="Prévia do painel do cliente" subtitle="Visualização administrativa sem revelar token bearer" hideHeading>
      <div className="page-toolbar detail-toolbar">
        <Link className="secondary-button" to={`/admin/clientes/${clientId}`}><ArrowLeft size={17} /> Voltar ao cliente</Link>
      </div>
      {dashboard.isLoading && <LoadingState label="Carregando painel do cliente..." />}
      {dashboard.isError && <ErrorState message={dashboard.error.message} />}
      {dashboard.data && <ClientDashboardView dashboard={dashboard.data} adminPreview />}
    </AppShell>
  );
}
