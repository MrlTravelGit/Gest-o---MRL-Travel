import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, CircleDollarSign, Sparkles, UsersRound, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "@/components/admin/AdminPage";
import { LoyaltyProgramMark } from "@/components/loyalty/LoyaltyProgramMark";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { supabase } from "@/lib/supabase";

type ProgramDashboardClient = {
  clientId: string;
  clientName: string;
  points: number | string;
  costPerThousand: number | string;
  estimatedValue: number | string;
  nextExpirationDate: string | null;
  pointsExpiring90Days: number | string;
  lastUpdatedAt: string | null;
  clubActive: boolean;
  accountLinked: boolean;
};

type ProgramDashboardRow = {
  program_key: string;
  program_name: string;
  program_logo_url: string | null;
  clients_count: number;
  total_points: number | string;
  total_estimated_value: number | string;
  clients: ProgramDashboardClient[];
};

const asNumber = (value: number | string | null | undefined) => Number(value ?? 0) || 0;

export function ProgramsDashboardPanel() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["admin-program-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_program_dashboard");
      if (error) throw error;
      return (data || []) as unknown as ProgramDashboardRow[];
    },
  });

  useEffect(() => {
    if (!query.data?.length) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !query.data.some((program) => program.program_key === selectedKey)) {
      setSelectedKey(query.data[0].program_key);
    }
  }, [query.data, selectedKey]);

  const summary = useMemo(() => {
    const programs = query.data ?? [];
    const clientIds = new Set(programs.flatMap((program) => program.clients.map((client) => client.clientId)));
    return {
      programs: programs.length,
      clients: clientIds.size,
      points: programs.reduce((total, program) => total + asNumber(program.total_points), 0),
    };
  }, [query.data]);

  const selectedProgram = query.data?.find((program) => program.program_key === selectedKey) ?? query.data?.[0];

  if (query.isLoading) return <LoadingState label="Consolidando as carteiras dos clientes..." />;
  if (query.isError) return <ErrorState message={query.error.message} retry={() => void query.refetch()} />;
  if (!query.data?.length) return <EmptyState title="Nenhum programa em gestão" description="Programas com saldo, clube ativo ou conta vinculada aparecerão aqui." />;

  return (
    <div className="programs-dashboard-panel">
      <section className="programs-summary-grid" aria-label="Resumo dos programas">
        <article className="programs-summary-card"><span className="programs-summary-icon"><WalletCards /></span><div><small>Programas ativos</small><strong>{formatPoints(summary.programs)}</strong><p>com relacionamento em carteira</p></div></article>
        <article className="programs-summary-card"><span className="programs-summary-icon"><UsersRound /></span><div><small>Clientes encontrados</small><strong>{formatPoints(summary.clients)}</strong><p>clientes únicos não arquivados</p></div></article>
        <article className="programs-summary-card"><span className="programs-summary-icon"><Sparkles /></span><div><small>Pontos sob gestão</small><strong>{formatPoints(summary.points)}</strong><p>saldo oficial consolidado</p></div></article>
      </section>

      <section aria-labelledby="programs-catalog-title">
        <div className="section-heading programs-section-heading"><div><span className="eyebrow">Visão consolidada</span><h2 id="programs-catalog-title">Programas e bancos</h2><p>Selecione um programa para consultar as carteiras relacionadas.</p></div><span>{query.data.length} {query.data.length === 1 ? "programa" : "programas"}</span></div>
        <div className="programs-grid">
          {query.data.map((program) => {
            const active = program.program_key === selectedProgram?.program_key;
            return <button key={program.program_key} type="button" className={`program-card-button ${active ? "active" : ""}`} aria-pressed={active} onClick={() => setSelectedKey(program.program_key)}>
              <span className="program-logo-box"><LoyaltyProgramMark name={program.program_name} slug={program.program_key} logoUrl={program.program_logo_url} size="md" /></span>
              <span className="program-card-copy"><strong>{program.program_name}</strong><small>{formatPoints(program.clients_count)} {program.clients_count === 1 ? "cliente" : "clientes"}</small></span>
              <span className="program-card-total"><strong>{formatPoints(asNumber(program.total_points))}</strong><small>pontos</small></span>
            </button>;
          })}
        </div>
      </section>

      {selectedProgram && <section className="selected-program-panel" aria-labelledby="selected-program-title">
        <header className="selected-program-header">
          <div className="selected-program-identity"><span className="program-logo-box featured"><LoyaltyProgramMark name={selectedProgram.program_name} slug={selectedProgram.program_key} logoUrl={selectedProgram.program_logo_url} size="md" /></span><div><span className="eyebrow">Programa selecionado</span><h2 id="selected-program-title">{selectedProgram.program_name}</h2><p>{formatPoints(selectedProgram.clients_count)} clientes com saldo, clube ou conta vinculada.</p></div></div>
          <div className="selected-program-totals"><span><small>Saldo total</small><strong>{formatPoints(asNumber(selectedProgram.total_points))}</strong></span><span><small>Valor estimado</small><strong>{formatCurrency(asNumber(selectedProgram.total_estimated_value))}</strong></span></div>
        </header>

        <div className="program-client-list">
          {selectedProgram.clients.map((client) => <article className="program-client-row" key={client.clientId}>
            <div className="program-client-name"><span>{client.clientName.slice(0, 1).toUpperCase()}</span><div><strong>{client.clientName}</strong><small>{[client.clubActive && "Clube ativo", client.accountLinked && "Conta vinculada"].filter(Boolean).join(" · ") || "Saldo em carteira"}</small></div></div>
            <ProgramMetric label="Saldo atual" value={formatPoints(asNumber(client.points))} />
            <ProgramMetric label="Custo por milheiro" value={formatCurrency(asNumber(client.costPerThousand))} icon={<CircleDollarSign />} />
            <ProgramMetric label="Valor estimado" value={formatCurrency(asNumber(client.estimatedValue))} />
            <ProgramMetric label="Vencendo em 90 dias" value={formatPoints(asNumber(client.pointsExpiring90Days))} icon={<CalendarClock />} note={client.nextExpirationDate ? `Próximo: ${formatDate(client.nextExpirationDate)}` : "Sem vencimento futuro"} />
            <ProgramMetric label="Última atualização" value={formatDate(client.lastUpdatedAt)} />
            <Link className="table-action program-client-action" to={`/admin/clientes/${client.clientId}`}>Abrir cliente <ArrowRight /></Link>
          </article>)}
        </div>
      </section>}
    </div>
  );
}

function ProgramMetric({ label, value, note, icon }: { label: string; value: string; note?: string; icon?: React.ReactNode }) {
  return <div className="program-client-metric"><small>{icon}{label}</small><strong>{value}</strong>{note && <span>{note}</span>}</div>;
}
