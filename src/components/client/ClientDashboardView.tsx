import { AlertTriangle, BarChart3, CalendarClock, Coins, LineChart as LineChartIcon, PiggyBank, PlaneTakeoff, RefreshCw, WalletCards } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import type { PublicClientDashboard } from "@/types/dashboard";

const chartMargin = { top: 12, right: 12, bottom: 4, left: 0 };

export function ClientDashboardView({
  dashboard,
  adminPreview = false,
  onRefresh,
  refreshing = false,
}: {
  dashboard: PublicClientDashboard;
  adminPreview?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const displayName = dashboard.client.displayName || "Cliente MRL";
  const hasBalanceHistory = dashboard.balanceHistory.length > 0;
  const hasMonthlyMovements = dashboard.monthlyMovements.length > 0;

  return (
    <ClientDashboardShell>
      <section className="dashboard-hero" aria-labelledby="client-dashboard-title">
        <div>
          <span className="eyebrow">{adminPreview ? "Prévia administrativa" : "Acesso exclusivo por link"}</span>
          <h1 id="client-dashboard-title">Painel completo de {displayName}</h1>
          <p>
            Saldos, patrimônio, economia, emissões, programas, custos médios, vencimentos e gráficos consolidados pela MRL Travel.
          </p>
          <small>Última atualização: {formatDate(dashboard.client.lastUpdatedAt)}</small>
        </div>
        <div className="dashboard-hero-card">
          <Coins aria-hidden />
          <span>Saldo de pontos/milhas</span>
          <strong>{formatPoints(dashboard.summary.totalPoints)}</strong>
        </div>
      </section>

      <section className="dashboard-kpis" aria-label="Resumo do painel">
        <SummaryCard icon={<Coins />} label="Saldo de Pontos/Milhas" value={formatPoints(dashboard.summary.totalPoints)} />
        <SummaryCard icon={<WalletCards />} label="Patrimônio" value={formatCurrency(dashboard.summary.estimatedPatrimony)} />
        <SummaryCard icon={<PiggyBank />} label="Economia" value={formatCurrency(dashboard.summary.generatedSavings)} />
        <SummaryCard icon={<PlaneTakeoff />} label="Emissões/Economias" value={formatPoints(dashboard.summary.redemptionsCount)} />
      </section>

      {dashboard.summary.expiringIn90Days > 0 && (
        <div className="dashboard-alert" role="status">
          <AlertTriangle size={18} aria-hidden />
          <span>{formatPoints(dashboard.summary.expiringIn90Days)} pontos vencem nos próximos 90 dias.</span>
        </div>
      )}

      <section className="dashboard-section" aria-labelledby="programs-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Carteira do cliente</span>
            <h2 id="programs-title">Milhas por programa</h2>
          </div>
          {onRefresh && (
            <button className="secondary-button" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw size={15} /> Atualizar
            </button>
          )}
        </div>
        {dashboard.programs.length === 0 ? (
          <div className="panel-state">Nenhum programa ativo cadastrado para este cliente.</div>
        ) : (
          <div className="public-program-grid">
            {dashboard.programs.map((program) => (
              <article className="public-program-card" key={program.slug}>
                <div className="program-card-header">
                  {program.logoUrl ? <img src={program.logoUrl} alt="" loading="lazy" /> : <div className="program-logo-fallback">{program.name.slice(0, 2).toUpperCase()}</div>}
                  <div>
                    <h3>{program.name}</h3>
                    <span>Atualizado em {formatDate(program.capturedAt)}</span>
                  </div>
                </div>
                <strong>{formatPoints(program.balance)}</strong>
                <dl>
                  <div><dt>Custo médio/milheiro</dt><dd>{formatCurrency(program.averageCostPerThousand)}</dd></div>
                  <div><dt>Valor estimado</dt><dd>{formatCurrency(program.estimatedValue)}</dd></div>
                  <div><dt>Vencendo em 90 dias</dt><dd>{formatPoints(program.expiringPoints)}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="dashboard-charts-grid">
        <section className="dashboard-section chart-card" aria-labelledby="balance-chart-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow"><LineChartIcon size={14} /> Histórico</span>
              <h2 id="balance-chart-title">Saldo acumulado</h2>
            </div>
          </div>
          {hasBalanceHistory ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dashboard.balanceHistory} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.08)" />
                  <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fill: "#a9a39b", fontSize: 12 }} />
                  <YAxis tickFormatter={(value) => formatCompactNumber(Number(value))} tick={{ fill: "#a9a39b", fontSize: 12 }} width={58} />
                  <Tooltip formatter={(value) => formatPoints(Number(value))} labelFormatter={formatMonth} contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="balance" stroke="#f3c66d" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} name="Saldo" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="panel-state">Sem histórico de saldo suficiente para exibir gráfico.</div>
          )}
        </section>

        <section className="dashboard-section chart-card" aria-labelledby="movement-chart-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow"><BarChart3 size={14} /> Movimentações</span>
              <h2 id="movement-chart-title">Movimentação mensal</h2>
            </div>
          </div>
          {hasMonthlyMovements ? (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dashboard.monthlyMovements} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.08)" />
                  <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fill: "#a9a39b", fontSize: 12 }} />
                  <YAxis tickFormatter={(value) => formatCompactNumber(Number(value))} tick={{ fill: "#a9a39b", fontSize: 12 }} width={58} />
                  <Tooltip formatter={(value) => formatPoints(Number(value))} labelFormatter={formatMonth} contentStyle={tooltipStyle} />
                  <Bar dataKey="points" fill="#d8a973" radius={[10, 10, 0, 0]} name="Pontos" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="panel-state">Sem movimentações mensais registradas.</div>
          )}
        </section>
      </div>

      {dashboard.cardStatements && dashboard.cardStatements.length > 0 && (
        <section className="dashboard-section" aria-labelledby="cards-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Cartões</span>
              <h2 id="cards-title">Faturas e pontos esperados</h2>
            </div>
          </div>
          <div className="statement-list">
            {dashboard.cardStatements.slice(-6).map((statement) => (
              <article key={statement.month}>
                <CalendarClock aria-hidden />
                <div>
                  <span>{formatMonth(statement.month)}</span>
                  <strong>{formatCurrency(statement.eligibleSpend)}</strong>
                </div>
                <p>{formatPoints(statement.expectedPoints)} esperados · {formatPoints(statement.receivedPoints)} recebidos</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {dashboard.contract && (
        <section className="dashboard-section public-contract-card" aria-label="Contrato ativo">
          <div>
            <span>Plano</span>
            <strong>{dashboard.contract.planName ?? "MRL Travel"}</strong>
          </div>
          <div>
            <span>Vigência</span>
            <strong>{formatDate(dashboard.contract.startsOn)} — {formatDate(dashboard.contract.endsOn)}</strong>
          </div>
          <div>
            <span>Dias restantes</span>
            <strong>{formatPoints(dashboard.contract.daysRemaining)}</strong>
          </div>
        </section>
      )}
    </ClientDashboardShell>
  );
}

export function ClientDashboardSkeleton() {
  return (
    <ClientDashboardShell>
      <section className="dashboard-hero dashboard-skeleton" aria-label="Carregando painel">
        <div>
          <span className="skeleton-line short" />
          <span className="skeleton-title" />
          <span className="skeleton-line" />
          <span className="skeleton-line medium" />
        </div>
        <div className="dashboard-hero-card">
          <span className="skeleton-line short" />
          <span className="skeleton-title small" />
        </div>
      </section>
      <section className="dashboard-kpis" aria-hidden>
        <article><span className="skeleton-dot" /><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
        <article><span className="skeleton-dot" /><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
        <article><span className="skeleton-dot" /><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
        <article><span className="skeleton-dot" /><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
      </section>
      <section className="dashboard-section">
        <div className="public-program-grid">
          <div className="public-program-card"><span className="skeleton-line short" /><span className="skeleton-title small" /><span className="skeleton-line" /></div>
          <div className="public-program-card"><span className="skeleton-line short" /><span className="skeleton-title small" /><span className="skeleton-line" /></div>
          <div className="public-program-card"><span className="skeleton-line short" /><span className="skeleton-title small" /><span className="skeleton-line" /></div>
        </div>
      </section>
      <div className="dashboard-charts-grid">
        <section className="dashboard-section chart-card"><span className="skeleton-title small" /><div className="chart-container skeleton-panel" /></section>
        <section className="dashboard-section chart-card"><span className="skeleton-title small" /><div className="chart-container skeleton-panel" /></section>
      </div>
    </ClientDashboardShell>
  );
}

export function ClientDashboardErrorState() {
  return (
    <ClientDashboardShell>
      <section className="dashboard-section" aria-live="polite">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Acesso protegido</span>
            <h1>Painel indisponível</h1>
            <p>Não foi possível carregar este painel. Solicite um novo link à equipe MRL Travel.</p>
          </div>
        </div>
      </section>
    </ClientDashboardShell>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article>
      <div className="summary-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ClientDashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="client-dashboard-shell">
      <div className="brand-lockup dashboard-brand">
        <div className="brand-mark">MRL</div>
        <div><strong>MRL Travel</strong><span>Painel protegido</span></div>
      </div>
      {children}
    </div>
  );
}

function formatMonth(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(value));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const tooltipStyle = {
  background: "#111316",
  border: "1px solid rgba(216,169,115,.32)",
  borderRadius: "14px",
  color: "#f7f3ed",
};
