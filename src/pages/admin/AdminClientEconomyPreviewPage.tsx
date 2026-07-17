import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/admin/AdminPage";
import { ClientDashboardView } from "@/components/client/ClientDashboardView";
import { AppShell } from "@/components/layout/AppShell";
import { getAdminClientDashboardPreview } from "@/services/dashboard";

export function AdminClientEconomyPreviewPage() {
  const { clientId } = useParams();
  const dashboard = useQuery({
    queryKey: ["admin-client-dashboard-preview", clientId],
    queryFn: () => getAdminClientDashboardPreview(clientId!),
    enabled: Boolean(clientId),
  });

  if (!clientId) return <Navigate to="/admin/clientes" replace />;

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
