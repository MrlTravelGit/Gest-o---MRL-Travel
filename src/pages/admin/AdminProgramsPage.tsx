import { PageHeader } from "@/components/admin/AdminPage";
import { ProgramsDashboardPanel } from "@/components/admin/ProgramsDashboardPanel";
import { AppShell } from "@/components/layout/AppShell";

export function AdminProgramsPage() {
  return <AppShell title="Programas" subtitle="Carteiras consolidadas por programa" hideHeading>
    <PageHeader eyebrow="Inteligência de carteira" title="Programas" description="Saldos, custos e vínculos de todos os clientes em uma única visão operacional." />
    <ProgramsDashboardPanel />
  </AppShell>;
}
