import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router-dom";
import { AlertTriangle, Coins, PiggyBank, PlaneTakeoff, WalletCards } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/layout/AppShell";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { getClientDashboard } from "@/services/dashboard";

export function ClientDashboardPage() {
  const { publicId } = useParams();
  const dashboard = useQuery({
    queryKey: ["client-dashboard", publicId],
    queryFn: () => getClientDashboard(publicId!),
    enabled: Boolean(publicId),
    retry: 1,
  });

  if (!publicId) return <Navigate to="/" replace />;

  return (
    <AppShell
      title={dashboard.data?.client.fullName ?? "Sua gestão de milhas"}
      subtitle={`Última atualização: ${formatDate(dashboard.data?.client.lastUpdatedAt)}`}
    >
      {dashboard.isLoading && <div className="panel-state">Carregando indicadores...</div>}
      {dashboard.isError && <div className="panel-state error-state">{dashboard.error.message}</div>}
      {dashboard.data && (
        <>
          <section className="summary-grid">
            <SummaryCard icon={<Coins />} label="Saldo de pontos e milhas" value={formatPoints(dashboard.data.summary.totalPoints)} />
            <SummaryCard icon={<WalletCards />} label="Patrimônio estimado" value={formatCurrency(dashboard.data.summary.estimatedPatrimony)} />
            <SummaryCard icon={<PiggyBank />} label="Economia gerada" value={formatCurrency(dashboard.data.summary.generatedSavings)} />
            <SummaryCard icon={<PlaneTakeoff />} label="Emissões realizadas" value={formatPoints(dashboard.data.summary.redemptionsCount)} />
          </section>

          {dashboard.data.summary.expiringIn90Days > 0 && (
            <div className="warning-banner">
              <AlertTriangle size={20} />
              <span>{formatPoints(dashboard.data.summary.expiringIn90Days)} pontos vencem nos próximos 90 dias.</span>
            </div>
          )}

          <section>
            <div className="section-heading"><h2>Milhas por programa</h2></div>
            <div className="program-grid">
              {dashboard.data.programs.map((program) => (
                <article className="program-card" key={program.accountId}>
                  <div><span className="program-name">{program.name}</span><small>Atualizado em {formatDate(program.capturedAt)}</small></div>
                  <strong>{formatPoints(program.balance)}</strong>
                  <div className="program-metrics">
                    <span>Patrimônio <b>{formatCurrency(program.estimatedValue)}</b></span>
                    <span>Custo médio <b>{formatCurrency(program.averageCostPerThousand)}</b></span>
                  </div>
                </article>
              ))}
              {dashboard.data.programs.length === 0 && <div className="panel-state">Nenhum programa lançado.</div>}
            </div>
          </section>

          <section className="chart-card">
            <div className="section-heading"><h2>Saldo acumulado</h2></div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dashboard.data.balanceHistory}>
                  <CartesianGrid stroke="#2d3138" strokeDasharray="3 3" />
                  <XAxis dataKey="month" stroke="#a5a5a5" />
                  <YAxis stroke="#a5a5a5" tickFormatter={(value) => formatPoints(Number(value))} />
                  <Tooltip formatter={(value) => formatPoints(Number(value))} contentStyle={{ background: "#101113", border: "1px solid #bd8332" }} />
                  <Line type="monotone" dataKey="balance" stroke="#d8a973" strokeWidth={3} dot={{ fill: "#fcd58a" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {dashboard.data.contract && (
            <section className="contract-card">
              <div><span>Plano de gestão</span><strong>{dashboard.data.contract.planName ?? "Gestão MRL Travel"}</strong></div>
              <div><span>Vigência</span><strong>{formatDate(dashboard.data.contract.startsOn)} a {formatDate(dashboard.data.contract.endsOn)}</strong></div>
              <div><span>Dias restantes</span><strong>{dashboard.data.contract.daysRemaining}</strong></div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <article className="summary-card"><div className="summary-icon">{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}
