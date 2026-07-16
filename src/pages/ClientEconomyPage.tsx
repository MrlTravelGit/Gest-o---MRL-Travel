import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, PiggyBank, PlaneTakeoff, ReceiptText, ShieldCheck, TrendingUp } from "lucide-react";
import { useParams } from "react-router-dom";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { getPublicClientEconomyByLink } from "@/services/dashboard";
import type { ClientEconomy } from "@/types/dashboard";

export function ClientEconomyPage() {
  const { token } = useParams();
  useEffect(() => {
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.appendChild(referrer);

    const cacheControl = document.createElement("meta");
    cacheControl.httpEquiv = "Cache-Control";
    cacheControl.content = "no-store";
    document.head.appendChild(cacheControl);

    return () => {
      referrer.remove();
      cacheControl.remove();
    };
  }, []);

  const economy = useQuery({
    queryKey: ["public-client-economy", token],
    queryFn: () => getPublicClientEconomyByLink(token!),
    enabled: Boolean(token),
    retry: 1,
  });

  return (
    <main className="client-economy-page">
      {economy.isLoading && <ClientEconomySkeleton />}
      {(economy.isError || !token) && <ClientEconomyUnavailable />}
      {economy.data && <ClientEconomyContent economy={economy.data} onRefresh={() => void economy.refetch()} refreshing={economy.isFetching} />}
    </main>
  );
}

export function ClientEconomyContent({
  economy,
  adminPreview = false,
  onRefresh,
  refreshing = false,
}: {
  economy: ClientEconomy;
  adminPreview?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const displayName = economy.client.displayName ?? economy.client.fullName ?? "Cliente MRL";

  return (
    <ClientEconomyShell>
      <section className="economy-hero" aria-labelledby="economy-title">
        <div>
          <span className="eyebrow">{adminPreview ? "Prévia administrativa" : "Página exclusiva de economia"}</span>
          <h1 id="economy-title">Economia MRL Travel</h1>
          <p>
            {displayName}, esta página mostra somente a economia registrada nas suas emissões.
            Nenhum dado administrativo, senha, fatura ou movimentação interna é exibido aqui.
          </p>
          <small>Última atualização: {formatDate(economy.client.lastUpdatedAt)}</small>
        </div>
        <div className="economy-hero-card">
          <PiggyBank aria-hidden />
          <span>Economia acumulada</span>
          <strong>{formatCurrency(economy.summary.generatedSavings)}</strong>
        </div>
      </section>

      <section className="economy-kpis" aria-label="Resumo de economia">
        <article><PlaneTakeoff aria-hidden /><span>Emissões contabilizadas</span><strong>{formatPoints(economy.summary.redemptionsCount)}</strong></article>
        <article><TrendingUp aria-hidden /><span>Com economia positiva</span><strong>{formatPoints(economy.summary.positiveSavingsCount)}</strong></article>
        <article><ShieldCheck aria-hidden /><span>Escopo da página</span><strong>Somente economia</strong></article>
      </section>

      <section className="economy-history" aria-labelledby="economy-history-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Histórico</span>
            <h2 id="economy-history-title">Viagens e emissões</h2>
          </div>
          {onRefresh && <button className="secondary-button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={15} /> Atualizar</button>}
        </div>
        {economy.items.length === 0 ? (
          <div className="panel-state">Nenhuma economia registrada ainda.</div>
        ) : (
          <div className="economy-list">
            {economy.items.map((item, index) => (
              <article className="economy-item" key={`${item.issuedAt}-${index}`}>
                <div className="economy-item-icon"><ReceiptText aria-hidden /></div>
                <div>
                  <span>{formatDate(item.launchedOn ?? item.issuedAt)}</span>
                  <h3>{item.details}</h3>
                  <p>
                    Valor original {formatCurrency(item.originalValue)} · Valor pago {formatCurrency(item.paidValue)}
                    {item.programName ? ` · ${item.programName}` : ""}
                    {item.pointsUsed ? ` · ${formatPoints(item.pointsUsed)} pontos` : ""}
                  </p>
                </div>
                <strong className={item.savingsAmount < 0 ? "value-negative" : "value-positive"}>{formatCurrency(item.savingsAmount)}</strong>
              </article>
            ))}
          </div>
        )}
      </section>
    </ClientEconomyShell>
  );
}

function ClientEconomySkeleton() {
  return (
    <ClientEconomyShell>
      <section className="economy-hero economy-skeleton" aria-label="Carregando economia">
        <div>
          <span className="skeleton-line short" />
          <span className="skeleton-title" />
          <span className="skeleton-line" />
          <span className="skeleton-line medium" />
        </div>
        <div className="economy-hero-card">
          <span className="skeleton-line short" />
          <span className="skeleton-title small" />
        </div>
      </section>
      <section className="economy-kpis" aria-hidden>
        <article><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
        <article><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
        <article><span className="skeleton-line short" /><span className="skeleton-line medium" /></article>
      </section>
      <section className="economy-history">
        <div className="economy-list">
          <div className="economy-item"><span className="skeleton-dot" /><div><span className="skeleton-line short" /><span className="skeleton-line" /></div><span className="skeleton-line short" /></div>
          <div className="economy-item"><span className="skeleton-dot" /><div><span className="skeleton-line short" /><span className="skeleton-line" /></div><span className="skeleton-line short" /></div>
        </div>
      </section>
    </ClientEconomyShell>
  );
}

function ClientEconomyUnavailable() {
  return (
    <ClientEconomyShell>
      <section className="economy-unavailable">
        <div className="brand-mark">MRL</div>
        <h1>Página indisponível</h1>
        <p>Não foi possível carregar esta página de economia. Solicite um novo link à equipe MRL Travel.</p>
      </section>
    </ClientEconomyShell>
  );
}

function ClientEconomyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="client-economy-shell">
      <div className="brand-lockup economy-brand">
        <div className="brand-mark">MRL</div>
        <div><strong>MRL Travel</strong><span>Economia protegida</span></div>
      </div>
      {children}
    </div>
  );
}
