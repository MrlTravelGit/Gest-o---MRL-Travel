import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CalendarClock, Coins, LineChart as LineChartIcon, PiggyBank, PlaneTakeoff, WalletCards } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { LoyaltyProgramLogo } from "@/components/brand/LoyaltyProgramLogo";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { normalizeBalanceHistory, normalizeMonthlyMovements, numericDomain, type BalanceHistoryPoint } from "@/lib/dashboard-chart-data";
import type { PublicClientDashboard, PublicClientProgram } from "@/types/dashboard";

const balanceChartMargin = { top: 16, right: 10, bottom: 8, left: 0 };
const movementChartMargin = { top: 16, right: 10, bottom: 8, left: 0 };

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
  const balanceHistory = normalizeBalanceHistory(dashboard.balanceHistory);
  const monthlyMovements = normalizeMonthlyMovements(dashboard.monthlyMovements);
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
        <BrandLogo size="medium" className="dashboard-public-brand" />
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
          <MeasuredChart className="balance-chart-container" height={360} ariaLabel={`Evolução do saldo em ${balanceHistory.length} período(s).`}>
            {(width, height) => <>
              <span className="sr-only">Saldo mais recente: {formatPoints(balanceHistory.at(-1)?.points ?? 0)} pontos.</span>
              <LineChart width={width} height={height} data={balanceHistory} margin={balanceChartMargin}>
                <CartesianGrid strokeDasharray="2 6" stroke="rgba(252,213,138,.13)" vertical={false} />
                <XAxis dataKey="period" tickFormatter={formatMonth} tick={{ fill: "#c8beb0", fontSize: 11 }} axisLine={{ stroke: "rgba(252,213,138,.18)" }} tickLine={false} minTickGap={22} />
                <YAxis yAxisId="points" domain={numericDomain(balanceHistory.map((point) => point.points))} tickFormatter={(value) => formatCompactNumber(Number(value))} tick={{ fill: "#c8beb0", fontSize: 11 }} axisLine={false} tickLine={false} width={58} allowDecimals={false} />
                {hasAverageCost(balanceHistory) && <YAxis yAxisId="cost" orientation="right" domain={numericDomain(balanceHistory.flatMap((point) => point.averageCost === null ? [] : [point.averageCost]))} tickFormatter={(value) => `R$ ${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} tick={{ fill: "#a98f69", fontSize: 10 }} axisLine={false} tickLine={false} width={56} />}
                <Tooltip formatter={(value, name) => name === "Custo médio" ? formatCurrency(Number(value)) : formatPoints(Number(value))} labelFormatter={formatMonth} contentStyle={tooltipStyle} />
                <Legend verticalAlign="top" align="right" iconType="plainline" height={32} wrapperStyle={{ color: "#d9d2c8", fontSize: 11 }} />
                <Line yAxisId="points" type={balanceHistory.length === 1 ? "linear" : "monotone"} dataKey="points" stroke="#fcd58a" strokeWidth={3.4} dot={{ r: balanceHistory.length === 1 ? 6 : 4, strokeWidth: 2, fill: "#050709", stroke: "#fcd58a" }} activeDot={{ r: 6 }} name="Saldo" isAnimationActive={false} />
                {hasAverageCost(balanceHistory) && (
                  <Line yAxisId="cost" connectNulls type={balanceHistory.length === 1 ? "linear" : "monotone"} dataKey="averageCost" stroke="#b48645" strokeWidth={2} strokeDasharray="7 6" dot={{ r: 3, fill: "#b48645" }} name="Custo médio" isAnimationActive={false} />
                )}
              </LineChart>
            </>}
          </MeasuredChart>
        ) : (
          <div className="chart-empty-state">O histórico aparecerá após os primeiros lançamentos.</div>
        )}
      </section>

      <section className="dashboard-section chart-card chart-card-wide" aria-labelledby="movement-chart-title">
        <SectionHeading eyebrow={<><BarChart3 size={14} aria-hidden /> Movimentações</>} title="Movimentação Mensal" id="movement-chart-title" />
        {hasMonthlyMovements ? (
          <MeasuredChart className="movement-chart-container" height={340} ariaLabel={`Entradas e saídas de pontos em ${monthlyMovements.length} período(s).`}>
            {(width, height) => <>
              <span className="sr-only">Movimentação líquida mais recente: {formatPoints(monthlyMovements.at(-1)?.netPoints ?? 0)} pontos.</span>
              <ComposedChart width={width} height={height} data={monthlyMovements} margin={movementChartMargin}>
                <defs>
                  <linearGradient id="movementGoldGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#fcd58a" />
                    <stop offset="100%" stopColor="#b47a2d" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 6" stroke="rgba(252,213,138,.13)" vertical={false} />
                <XAxis dataKey="period" tickFormatter={formatMonth} tick={{ fill: "#c8beb0", fontSize: 11 }} axisLine={{ stroke: "rgba(252,213,138,.18)" }} tickLine={false} minTickGap={22} />
                <YAxis domain={numericDomain(monthlyMovements.flatMap((point) => [point.pointsIn, point.pointsOut, point.netPoints]))} tickFormatter={(value) => formatCompactNumber(Number(value))} tick={{ fill: "#c8beb0", fontSize: 11 }} axisLine={false} tickLine={false} width={58} allowDecimals={false} />
                <Tooltip formatter={(value, name) => [formatPoints(Number(value)), name]} labelFormatter={formatMonth} contentStyle={tooltipStyle} />
                <Legend verticalAlign="top" align="right" height={32} wrapperStyle={{ color: "#d9d2c8", fontSize: 11 }} />
                <Bar dataKey="pointsIn" fill="url(#movementGoldGradient)" radius={[8, 8, 2, 2]} name="Entradas" isAnimationActive={false} maxBarSize={46} />
                <Bar dataKey="pointsOut" fill="#7f4d43" radius={[8, 8, 2, 2]} name="Saídas" isAnimationActive={false} maxBarSize={46} />
                <Line type="monotone" dataKey="netPoints" stroke="#f4eee5" strokeWidth={2} dot={{ r: 3 }} name="Líquido" isAnimationActive={false} />
              </ComposedChart>
            </>}
          </MeasuredChart>
        ) : (
          <div className="chart-empty-state">O histórico aparecerá após os primeiros lançamentos.</div>
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
            <strong>{formatDate(dashboard.contract.startsOn)} — {dashboard.contract.endsOn ? formatDate(dashboard.contract.endsOn) : "Prazo indeterminado"}</strong>
          </div>
          <div>
            <span>Dias restantes</span>
            <strong>{dashboard.contract.daysRemaining == null ? "Sem término" : formatPoints(dashboard.contract.daysRemaining)}</strong>
          </div>
        </section>
      )}

      <footer className="dashboard-footer" aria-label="Assinatura MRL Travel">
        <BrandLogo size="small" />
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
        <BrandLogo size="medium" className="dashboard-public-brand" />
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
        <BrandLogo size="medium" />
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
  return (
    <article className="public-program-card">
      <div className="program-logo-stage">
        <LoyaltyProgramLogo program={program} />
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

function MeasuredChart({
  ariaLabel,
  children,
  className,
  height,
}: {
  ariaLabel: string;
  children: (width: number, height: number) => ReactNode;
  className: string;
  height: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateSize = () => {
      const measuredWidth = Math.floor(frame.getBoundingClientRect().width || frame.clientWidth);
      const measuredHeight = Math.floor(frame.getBoundingClientRect().height || frame.clientHeight);
      if (measuredWidth > 0 && measuredHeight > 0) {
        setSize({ width: Math.max(240, measuredWidth), height: Math.max(260, measuredHeight) });
      }
    };

    updateSize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateSize);
    observer?.observe(frame);
    window.addEventListener("resize", updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  return (
    <div ref={frameRef} className={`chart-container ${className}`} role="img" aria-label={ariaLabel}>
      {children(size.width, size.height)}
    </div>
  );
}

function hasAverageCost(points: BalanceHistoryPoint[]) {
  return points.some((point) => point.averageCost !== null);
}

function formatMonth(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(value));
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const tooltipStyle = {
  background: "#0b0c0e",
  border: "1px solid rgba(216,169,115,.38)",
  borderRadius: "14px",
  color: "#f7f3ed",
  boxShadow: "0 18px 48px rgba(0,0,0,.42)",
};
