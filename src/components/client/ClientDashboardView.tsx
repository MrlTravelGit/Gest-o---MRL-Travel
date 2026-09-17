import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CalendarClock, Coins, Eye, LineChart as LineChartIcon, MapPinned, PiggyBank, PlaneTakeoff, WalletCards } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { LoyaltyProgramLogo } from "@/components/brand/LoyaltyProgramLogo";
import { SavingsDateFilter } from "@/components/shared/SavingsDateFilter";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { normalizeBalanceHistory, normalizeMonthlyMovements, numericDomain, type BalanceHistoryPoint } from "@/lib/dashboard-chart-data";
import { shouldShowClientProgram } from "@/lib/client-program-wallet";
import { calculateSavingsSummary, isWithinSavingsDateRange } from "@/lib/savings-date-filter";
import type { PublicClientDashboard, PublicClientProgram } from "@/types/dashboard";

const balanceChartMargin = { top: 16, right: 10, bottom: 8, left: 0 };
const movementChartMargin = { top: 16, right: 10, bottom: 8, left: 0 };

export function ClientDashboardView({
  dashboard,
  adminPreview = false,
  accessToken,
}: {
  dashboard: PublicClientDashboard;
  adminPreview?: boolean;
  accessToken?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const displayName = dashboard.client.displayName || "Cliente MRL";
  const balanceHistory = normalizeBalanceHistory(dashboard.balanceHistory);
  const monthlyMovements = normalizeMonthlyMovements(dashboard.monthlyMovements);
  const hasBalanceHistory = balanceHistory.length > 0;
  const hasMonthlyMovements = monthlyMovements.length > 0;
  const walletPrograms = dashboard.programs.filter((program) => shouldShowClientProgram(program));
  const [savingsStartDate, setSavingsStartDate] = useState("");
  const [savingsEndDate, setSavingsEndDate] = useState("");
  const hasSavingsHistory = Array.isArray(dashboard.savingsHistory);
  const savingsPeriodActive = Boolean(savingsStartDate || savingsEndDate);
  const dateFilteredSavings = useMemo(() => (dashboard.savingsHistory ?? [])
    .filter((saving) => isWithinSavingsDateRange(saving, savingsStartDate, savingsEndDate)), [dashboard.savingsHistory, savingsStartDate, savingsEndDate]);
  const dateFilteredCashbackTransactions = useMemo(() => (dashboard.cashback?.transactions ?? [])
    .filter((transaction) => isWithinSavingsDateRange(transaction, savingsStartDate, savingsEndDate)), [dashboard.cashback?.transactions, savingsStartDate, savingsEndDate]);
  const savingsPeriodSummary = useMemo(() => calculateSavingsSummary(
    dateFilteredSavings,
    dashboard.cashback?.transactions ?? [],
    savingsStartDate,
    savingsEndDate,
  ), [dateFilteredSavings, dashboard.cashback?.transactions, savingsStartDate, savingsEndDate]);
  const displayedSavingsTotal = hasSavingsHistory ? savingsPeriodSummary.totalSaved : dashboard.summary.generatedSavings;
  const displayedSavingsCount = hasSavingsHistory ? dateFilteredSavings.length : dashboard.summary.redemptionsCount;
  const displayedCashbackBalance = hasSavingsHistory ? savingsPeriodSummary.availableBalance : dashboard.cashback?.availableBalance ?? 0;
  const displayedCashbackSummary = hasSavingsHistory ? savingsPeriodSummary : {
    totalSaved: dashboard.summary.generatedSavings,
    cashbackGenerated: dashboard.cashback?.summary.generated ?? 0,
    availableBalance: dashboard.cashback?.summary.available ?? 0,
    usedAmount: dashboard.cashback?.summary.used ?? 0,
    paidAmount: dashboard.cashback?.summary.paid ?? 0,
  };
  const invoiceGroups = useMemo(() => {
    const grouped = new Map<string, NonNullable<PublicClientDashboard["cardStatements"]>>();
    for (const statement of dashboard.cardStatements ?? []) grouped.set(statement.month, [...(grouped.get(statement.month) ?? []), statement]);
    return Array.from(grouped.entries());
  }, [dashboard.cardStatements]);

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
        <SummaryCard
          icon={<PiggyBank aria-hidden />}
          label="Economia"
          value={formatCurrency(displayedSavingsTotal)}
          badge={dashboard.cashback?.enabled === true
            ? { label: "Cashback", value: formatCurrency(displayedCashbackBalance) }
            : undefined}
        />
        <SummaryCard icon={<PlaneTakeoff aria-hidden />} label="Emissões/Economias" value={formatPoints(displayedSavingsCount)} />
      </section>

      {dashboard.summary.expiringIn90Days > 0 && (
        <div className="dashboard-alert" role="status">
          <AlertTriangle size={18} aria-hidden />
          <span>{formatPoints(dashboard.summary.expiringIn90Days)} pontos vencem nos próximos 90 dias.</span>
        </div>
      )}

      <section className="dashboard-section" aria-labelledby="programs-title">
        <SectionHeading eyebrow="Carteira do cliente" title="Milhas por Programa" id="programs-title" />
        {walletPrograms.length === 0 ? (
          <div className="panel-state wallet-empty-state"><strong>Nenhum programa vinculado ainda.</strong><span>Use Lançar pontos ou ative um clube para adicionar este cliente a um programa.</span></div>
        ) : (
          <div className="public-program-grid">
            {walletPrograms.map((program) => (
              <ProgramCard program={program} key={`${program.slug}-${program.name}`} />
            ))}
          </div>
        )}
      </section>

      {dashboard.travelInterests && dashboard.travelInterests.length > 0 && (
        <section className="dashboard-section public-interests-section" aria-labelledby="public-interests-title">
          <SectionHeading eyebrow={<><MapPinned size={14} aria-hidden /> Planejamento</>} title="Meus interesses" id="public-interests-title" />
          <div className="public-interest-list">{dashboard.travelInterests.map((interest) => <article key={interest.id}><div><h3>{interest.destination}</h3><span>{publicInterestPeriod(interest.startDate,interest.endDate)}</span></div><span className={`public-interest-status status-${interest.status}`}>{interest.statusLabel}</span>{interest.publicNote&&<p>{interest.publicNote}</p>}<small>Atualizado em {formatDate(interest.updatedAt)}</small></article>)}</div>
        </section>
      )}

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
          <SectionHeading eyebrow="Previsão financeira" title="Faturas e pontos previstos" id="cards-title" />
          {dashboard.invoiceSummary && <div className="invoice-public-summary"><article><span>Faturas em {dashboard.invoiceSummary.year}</span><strong>{formatPoints(dashboard.invoiceSummary.invoiceCount)}</strong></article><article><span>Total faturado</span><strong>{formatCurrency(dashboard.invoiceSummary.totalInvoiced)}</strong></article><article><span>Pontos estimados</span><strong>{formatPoints(dashboard.invoiceSummary.estimatedPoints)}</strong></article><article><span>Valor aproximado</span><strong>{formatCurrency(dashboard.invoiceSummary.estimatedPointsValue)}</strong></article><article><span>Pontos recebidos</span><strong>{formatPoints(dashboard.invoiceSummary.receivedPoints)}</strong></article><article><span>Diferença acumulada</span><strong>{formatPoints(dashboard.invoiceSummary.accumulatedDifference)}</strong></article></div>}
          <div className="statement-month-groups">{invoiceGroups.slice(0, 6).map(([month, monthStatements]) => <section key={month} className="statement-month-group"><header><CalendarClock aria-hidden /><div><span>Competência</span><strong>{formatMonth(month)}</strong></div><small>{monthStatements.length} {monthStatements.length === 1 ? "fatura" : "faturas"}</small></header><div className="statement-list">{monthStatements.map((statement, index) => (
            <article key={`${statement.month}-${statement.cardName}-${statement.invoiceSequence ?? index}`}>
              <div className="statement-public-main"><span>{statement.invoiceLabel || `Fatura ${statement.invoiceSequence ?? index + 1}`} · {statement.institutionName || "Instituição não informada"}</span><strong>{statement.cardName}</strong><small>{formatCurrency(statement.totalSpend)}{statement.programName ? ` · ${statement.programName}` : ""}</small></div>
              <dl><div><dt>Estimados</dt><dd>{statement.estimatedPoints == null ? "—" : formatPoints(statement.estimatedPoints)}</dd></div><div><dt>Valor aproximado</dt><dd>{statement.estimatedPointsValue == null ? "Não configurado" : formatCurrency(statement.estimatedPointsValue)}</dd></div><div><dt>Recebidos</dt><dd>{statement.receivedPoints == null ? "A confirmar" : formatPoints(statement.receivedPoints)}</dd></div></dl>
              <span className={`invoice-public-status status-${statement.status}`}>{statement.status === "missing_fx" ? "Sem cotação" : statement.status === "divergent" ? "Divergente" : statement.status === "received" ? "Recebido" : "Previsto"}</span>
            </article>
          ))}</div></section>)}</div>
        </section>
      )}

      {hasSavingsHistory && ((dashboard.savingsHistory?.length ?? 0) > 0 || savingsPeriodActive) && (
        <section className="dashboard-section public-savings-section" aria-labelledby="savings-history-title">
          <SectionHeading eyebrow={<><PiggyBank size={14} aria-hidden /> Economia comprovada</>} title="Histórico de Economias" id="savings-history-title" />
          <SavingsDateFilter startDate={savingsStartDate} endDate={savingsEndDate} onStartDateChange={setSavingsStartDate} onEndDateChange={setSavingsEndDate} idPrefix="public-savings"/>
          {dateFilteredSavings.length === 0 ? <div className="panel-state">Nenhuma economia encontrada neste período.</div> : <div className="public-savings-list">
            {dateFilteredSavings.map((saving) => (
              <article key={saving.id}>
                <div className="public-saving-main">
                  <span>{formatDate(saving.date)}{saving.migrated && <em>Histórico migrado</em>}</span>
                  <strong>{saving.description}</strong>
                </div>
                <dl>
                  <div><dt>Valor original</dt><dd>{formatCurrency(saving.originalValue)}</dd></div>
                  <div><dt>Valor pago</dt><dd>{formatCurrency(saving.paidValue)}</dd></div>
                  <div className="public-saving-earned"><dt>Economia</dt><dd>{formatCurrency(saving.savingsValue)}</dd></div>
                  {dashboard.cashback?.enabled === true && saving.cashbackAmount > 0 && <div className="public-saving-cashback"><dt>Cashback de {saving.cashbackPercentage}% sobre {formatCurrency(saving.cashbackBaseAmount ?? saving.paidValue)}</dt><dd>{formatCurrency(saving.cashbackAmount)}</dd></div>}
                </dl>
                {saving.hasEvidence && accessToken && <button className="public-evidence-button" onClick={async () => { const { getPublicSavingEvidenceUrl } = await import("@/services/travel-economy"); const view = await getPublicSavingEvidenceUrl(saving.id, accessToken); window.open(view.url, "_blank", "noopener,noreferrer"); }}><Eye size={15}/> Ver comprovante</button>}
              </article>
            ))}
          </div>}
        </section>
      )}

      {dashboard.cashback?.enabled === true && (
        <section className="dashboard-section public-cashback-section" aria-labelledby="cashback-title">
          <SectionHeading eyebrow={<><PiggyBank size={14} aria-hidden /> Benefício financeiro</>} title="Cashback MRL Travel" id="cashback-title" />
          {dashboard.cashback.notice && <div className="dashboard-alert"><AlertTriangle size={18}/><span>{dashboard.cashback.notice}</span></div>}
          <div className="public-cashback-summary"><SummaryCard icon={<PiggyBank/>} label="Saldo disponível" value={formatCurrency(displayedCashbackSummary.availableBalance)}/><SummaryCard icon={<Coins/>} label="Total gerado" value={formatCurrency(displayedCashbackSummary.cashbackGenerated)}/><SummaryCard icon={<WalletCards/>} label="Utilizado / pago" value={`${formatCurrency(displayedCashbackSummary.usedAmount)} / ${formatCurrency(displayedCashbackSummary.paidAmount)}`}/></div>
          <div className="public-cashback-statement">{dateFilteredCashbackTransactions.map((transaction) => <article key={transaction.id}><span>{formatDate(transaction.createdAt)}</span><div><strong>{transaction.description}</strong><small>{cashbackTypeLabel(transaction.type)}</small></div><b className={transaction.type === "earning" || (transaction.type === "adjustment" && transaction.amount > 0) ? "value-positive" : "value-negative"}>{transaction.type === "earning" || (transaction.type === "adjustment" && transaction.amount > 0) ? "+" : "−"}{formatCurrency(Math.abs(transaction.amount))}</b></article>)}</div>
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

function SummaryCard({
  icon,
  label,
  value,
  badge,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  badge?: { label: string; value: string };
}) {
  return (
    <article>
      <div className="summary-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {badge && (
        <div className="summary-cashback-badge" aria-label={`${badge.label}: ${badge.value}`}>
          <span>{badge.label}</span>
          <strong>{badge.value}</strong>
        </div>
      )}
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
        <div><h3>{program.name}</h3>{program.catalogActive !== false && <small className="catalog-active-badge">Ativo no catálogo</small>}</div>
        <span>{program.hasMovements === false ? "Sem lançamentos" : `Atualizado em ${formatDate(program.capturedAt)}`}</span>
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
          <dd>{program.expiringPoints > 0 ? formatPoints(program.expiringPoints) : "Sem vencimento futuro"}</dd>
        </div>
      </dl>
    </article>
  );
}

function cashbackTypeLabel(type: string) { return ({ earning: "Crédito sobre o valor pago", redemption: "Utilização ou pagamento", reversal: "Estorno", adjustment: "Ajuste administrativo" } as Record<string,string>)[type] ?? type; }
function publicInterestPeriod(start:string|null,end:string|null){if(!start&&!end)return"Período em definição";if(start&&end)return `${formatDate(start)} — ${formatDate(end)}`;return start?`A partir de ${formatDate(start)}`:`Até ${formatDate(end)}`;}

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
