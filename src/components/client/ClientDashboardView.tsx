import { useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CalendarClock, Coins, LineChart as LineChartIcon, PiggyBank, PlaneTakeoff, WalletCards } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { resolveLoyaltyProgramBrand } from "@/lib/loyalty-program-brand";
import type { PublicClientBalanceHistoryPoint, PublicClientDashboard, PublicClientMonthlyMovement, PublicClientProgram } from "@/types/dashboard";

const balanceChartMargin = { top: 28, right: 18, bottom: 12, left: 2 };
const movementChartMargin = { top: 28, right: 18, bottom: 12, left: 2 };

export function ClientDashboardView({
  dashboard,
  adminPreview = false,
}: {
  dashboard: PublicClientDashboard;
  adminPreview?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const displayName = dashboard.client.displayName || "Cliente MRL";
  const balanceHistory = orderBalanceHistory(dashboard.balanceHistory);
  const monthlyMovements = orderMonthlyMovements(dashboard.monthlyMovements);
  const hasBalanceHistory = balanceHistory.length > 0;
  const hasMonthlyMovements = monthlyMovements.length > 0;

  return (
    <ClientDashboardShell>
      <header className="dashboard-public-header" aria-labelledby="client-dashboard-title">
        <div>
          {adminPreview && <span className="eyebrow">Prévia administrativa</span>}
          <h1 id="client-dashboard-title">{displayName}</h1>
          <p>Dashboard MRL Travel com saldos, patrimônio, economia, emissões, programas e evolução da carteira.</p>
          <small>Última atualização: {formatDate(dashboard.client.lastUpdatedAt)}</small>
        </div>
        <div className="dashboard-public-seal" aria-hidden>
          <span>MRL</span>
          <small>Travel</small>
        </div>
      </header>

      <section className="dashboard-kpis" aria-label="Resumo do painel">
        <SummaryCard icon={<Coins aria-hidden />} label="Saldo de Pontos/Milhas" value={formatPoints(dashboard.summary.totalPoints)} />
        <SummaryCard icon={<WalletCards aria-hidden />} label="Patrimônio" value={formatCurrency(dashboard.summary.estimatedPatrimony)} />
        <SummaryCard icon={<PiggyBank aria-hidden />} label="Economia" value={formatCurrency(dashboard.summary.generatedSavings)} />
        <SummaryCard icon={<PlaneTakeoff aria-hidden />} label="Emissões/Economias" value={formatPoints(dashboard.summary.redemptionsCount)} />
      </section>

      {dashboard.summary.expiringIn90Days > 0 && (
        <div className="dashboard-alert" role="status">
          <AlertTriangle size={18} aria-hidden />
          <span>{formatPoints(dashboard.summary.expiringIn90Days)} pontos vencem nos próximos 90 dias.</span>
        </div>
      )}

      <section className="dashboard-section" aria-labelledby="programs-title">
        <SectionHeading eyebrow="Carteira do cliente" title="Milhas por Programa" id="programs-title" />
        {dashboard.programs.length === 0 ? (
          <div className="panel-state">Nenhum programa ativo cadastrado para este cliente.</div>
        ) : (
          <div className="public-program-grid">
            {dashboard.programs.map((program) => (
              <ProgramCard program={program} key={`${program.slug}-${program.name}`} />
            ))}
          </div>
        )}
      </section>

      <section className="dashboard-section chart-card chart-card-wide" aria-labelledby="balance-chart-title">
        <SectionHeading eyebrow={<><LineChartIcon size={14} aria-hidden /> Histórico</>} title="Saldo Acumulado" id="balance-chart-title" />
        {hasBalanceHistory ? (
          <div className="chart-container balance-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={balanceHistory} margin={balanceChartMargin}>
                <CartesianGrid strokeDasharray="2 6" stroke="rgba(252,213,138,.13)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fill: "#c8beb0", fontSize: 12 }} axisLine={{ stroke: "rgba(252,213,138,.18)" }} tickLine={false} />
                <YAxis tickFormatter={(value) => formatCompactNumber(Number(value))} tick={{ fill: "#c8beb0", fontSize: 12 }} axisLine={false} tickLine={false} width={62} />
                <Tooltip formatter={(value, name) => name === "Custo médio" ? formatCurrency(Number(value)) : formatPoints(Number(value))} labelFormatter={formatMonth} contentStyle={tooltipStyle} />
                <Legend verticalAlign="top" align="right" iconType="plainline" wrapperStyle={{ color: "#d9d2c8", paddingBottom: 12 }} />
                <Line type={balanceHistory.length === 1 ? "linear" : "monotone"} dataKey="balance" stroke="#fcd58a" strokeWidth={3.4} dot={{ r: 4, strokeWidth: 2, fill: "#050709", stroke: "#fcd58a" }} activeDot={{ r: 6 }} name="Saldo" isAnimationActive={false}>
                  <LabelList dataKey="balance" position="top" formatter={formatChartLabel} fill="#f7f0df" fontSize={12} />
                </Line>
                {hasAverageCost(balanceHistory) && (
                  <Line type={balanceHistory.length === 1 ? "linear" : "monotone"} dataKey="averageCostPerThousand" stroke="#8f6b36" strokeWidth={2} strokeDasharray="7 6" dot={{ r: 3, fill: "#8f6b36" }} name="Custo médio" yAxisId={0} isAnimationActive={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="panel-state">Sem histórico de saldo suficiente para exibir gráfico.</div>
        )}
      </section>

      <section className="dashboard-section chart-card chart-card-wide" aria-labelledby="movement-chart-title">
        <SectionHeading eyebrow={<><BarChart3 size={14} aria-hidden /> Movimentações</>} title="Movimentação Mensal" id="movement-chart-title" />
        {hasMonthlyMovements ? (
          <div className="chart-container movement-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyMovements} margin={movementChartMargin}>
                <defs>
                  <linearGradient id="movementGoldGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#fcd58a" />
                    <stop offset="100%" stopColor="#b47a2d" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 6" stroke="rgba(252,213,138,.13)" vertical={false} />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fill: "#c8beb0", fontSize: 12 }} axisLine={{ stroke: "rgba(252,213,138,.18)" }} tickLine={false} />
                <YAxis tickFormatter={(value) => formatCompactNumber(Number(value))} tick={{ fill: "#c8beb0", fontSize: 12 }} axisLine={false} tickLine={false} width={62} />
                <Tooltip formatter={(value) => formatPoints(Number(value))} labelFormatter={formatMonth} contentStyle={tooltipStyle} />
                <Bar dataKey="points" fill="url(#movementGoldGradient)" radius={[12, 12, 3, 3]} name="Pontos" isAnimationActive={false}>
                  <LabelList dataKey="points" position="top" formatter={formatChartLabel} fill="#f7f0df" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="panel-state">Sem movimentações mensais registradas.</div>
        )}
      </section>

      {dashboard.cardStatements && dashboard.cardStatements.length > 0 && (
        <section className="dashboard-section statement-section" aria-labelledby="cards-title">
          <SectionHeading eyebrow="Cartões" title="Faturas e Pontos Esperados" id="cards-title" />
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
        <section className="public-contract-card" aria-label="Plano e vigência">
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

      <footer className="dashboard-footer" aria-label="Assinatura MRL Travel">
        <span>MRL</span>
        <strong>MRL Travel</strong>
      </footer>
    </ClientDashboardShell>
  );
}

export function ClientDashboardSkeleton() {
  return (
    <ClientDashboardShell>
      <header className="dashboard-public-header dashboard-skeleton" aria-label="Carregando painel">
        <div>
          <span className="skeleton-title" />
          <span className="skeleton-line medium" />
          <span className="skeleton-line short" />
        </div>
        <div className="dashboard-public-seal skeleton-panel" />
      </header>
      <section className="dashboard-kpis" aria-hidden>
        <article><span className="skeleton-dot" /><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
        <article><span className="skeleton-dot" /><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
        <article><span className="skeleton-dot" /><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
        <article><span className="skeleton-dot" /><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
      </section>
      <section className="dashboard-section">
        <span className="skeleton-title small" />
        <div className="public-program-grid">
          <div className="public-program-card skeleton-panel" />
          <div className="public-program-card skeleton-panel" />
          <div className="public-program-card skeleton-panel" />
          <div className="public-program-card skeleton-panel" />
        </div>
      </section>
      <section className="dashboard-section chart-card chart-card-wide"><span className="skeleton-title small" /><div className="chart-container balance-chart-container skeleton-panel" /></section>
      <section className="dashboard-section chart-card chart-card-wide"><span className="skeleton-title small" /><div className="chart-container movement-chart-container skeleton-panel" /></section>
    </ClientDashboardShell>
  );
}

export function ClientDashboardErrorState() {
  return (
    <ClientDashboardShell>
      <section className="dashboard-unavailable" aria-live="polite">
        <h1>Painel indisponível</h1>
        <p>Não foi possível carregar este painel. Solicite um novo link à equipe MRL Travel.</p>
      </section>
    </ClientDashboardShell>
  );
}

function SectionHeading({ eyebrow, title, id }: { eyebrow: ReactNode; title: string; id: string }) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article>
      <div className="summary-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ProgramCard({ program }: { program: PublicClientProgram }) {
  const brand = resolveLoyaltyProgramBrand(program);
  const [imageAvailable, setImageAvailable] = useState(Boolean(brand.assetPath));

  function handleMissingAsset() {
    setImageAvailable(false);
    if (import.meta.env.DEV) {
      console.warn(`Logo local não encontrado para programa: ${brand.key}`);
    }
  }

  return (
    <article className="public-program-card">
      <div className="program-logo-stage">
        {brand.assetPath && imageAvailable ? (
          <img src={brand.assetPath} alt={`Logo ${brand.displayName}`} loading="lazy" onError={handleMissingAsset} />
        ) : (
          <div className="program-logo-fallback" aria-label={`Logo indisponível para ${program.name}`}>
            <strong>{brand.monogram}</strong>
            <span>{brand.known ? brand.displayName : program.name}</span>
          </div>
        )}
      </div>

      <div className="program-card-title">
        <h3>{program.name}</h3>
        <span>Atualizado em {formatDate(program.capturedAt)}</span>
      </div>

      <dl className="program-card-metrics">
        <div className="primary">
          <dt>Saldo</dt>
          <dd>{formatPoints(program.balance)}</dd>
        </div>
        <div className="primary">
          <dt>Custo médio/milheiro</dt>
          <dd>{formatCurrency(program.averageCostPerThousand)}</dd>
        </div>
        <div>
          <dt>Valor estimado</dt>
          <dd>{formatCurrency(program.estimatedValue)}</dd>
        </div>
        <div>
          <dt>Vencendo</dt>
          <dd>{formatPoints(program.expiringPoints)}</dd>
        </div>
      </dl>
    </article>
  );
}

function ClientDashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className="client-dashboard-shell">
      {children}
    </div>
  );
}

function orderBalanceHistory(points: PublicClientBalanceHistoryPoint[]) {
  return [...points].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
}

function orderMonthlyMovements(points: PublicClientMonthlyMovement[]) {
  return [...points].sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
}

function hasAverageCost(points: PublicClientBalanceHistoryPoint[]) {
  return points.some((point) => typeof point.averageCostPerThousand === "number" && point.averageCostPerThousand > 0);
}

function formatMonth(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(value));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatChartLabel(value: unknown) {
  return typeof value === "number" ? formatCompactNumber(value) : "";
}

const tooltipStyle = {
  background: "#0b0c0e",
  border: "1px solid rgba(216,169,115,.38)",
  borderRadius: "14px",
  color: "#f7f3ed",
  boxShadow: "0 18px 48px rgba(0,0,0,.42)",
};
