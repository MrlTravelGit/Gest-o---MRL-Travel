import { useQuery } from "@tanstack/react-query";
import { AdminBentoGrid } from "@/components/admin/AdminBentoGrid";
import { AdminHero } from "@/components/admin/AdminHero";
import { ErrorState, LoadingState } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { getAdminOverview } from "@/services/dashboard";

export function AdminDashboardPage() {
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: getAdminOverview });
  return <AppShell title="Gestão de Milhas" hideHeading>
    {overview.isLoading && <LoadingState label="Preparando seu centro de operações..." />}
    {overview.isError && <ErrorState message={overview.error.message} retry={() => void overview.refetch()} />}
    {overview.data && <><AdminHero overview={overview.data} /><AdminBentoGrid overview={overview.data} /></>}
  </AppShell>;
}
