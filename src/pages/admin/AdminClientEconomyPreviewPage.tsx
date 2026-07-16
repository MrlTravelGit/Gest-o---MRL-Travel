import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ErrorState, LoadingState } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { ClientEconomyContent } from "@/pages/ClientEconomyPage";
import { getAdminClientEconomyPreview } from "@/services/dashboard";

export function AdminClientEconomyPreviewPage() {
  const { clientId } = useParams();
  const economy = useQuery({
    queryKey: ["admin-client-economy-preview", clientId],
    queryFn: () => getAdminClientEconomyPreview(clientId!),
    enabled: Boolean(clientId),
  });

  if (!clientId) return <Navigate to="/admin/clientes" replace />;

  return (
    <AppShell title="Prévia de economia" subtitle="Visualização administrativa sem revelar token bearer" hideHeading>
      <div className="page-toolbar detail-toolbar">
        <Link className="secondary-button" to={`/admin/clientes/${clientId}`}><ArrowLeft size={17} /> Voltar ao cliente</Link>
      </div>
      {economy.isLoading && <LoadingState label="Carregando economia do cliente..." />}
      {economy.isError && <ErrorState message={economy.error.message} />}
      {economy.data && <ClientEconomyContent economy={economy.data} adminPreview />}
    </AppShell>
  );
}
