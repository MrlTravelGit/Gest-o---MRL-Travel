import { useQuery } from "@tanstack/react-query";
import { PiggyBank, PlaneTakeoff, ReceiptText, ShieldCheck, TrendingUp } from "lucide-react";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { getMyClientEconomy } from "@/services/dashboard";
import type { ClientEconomy } from "@/types/dashboard";

export function ClientEconomyPage() {
  const economy = useQuery({ queryKey: ["client-economy"], queryFn: getMyClientEconomy, retry: 1 });

  return (
    <main className="client-economy-page">
      {economy.isLoading && <ClientEconomyShell><div className="panel-state">Carregando sua economia...</div></ClientEconomyShell>}
      {economy.isError && <ClientEconomyShell><div className="panel-state error-state">{economy.error.message}</div></ClientEconomyShell>}
      {economy.data && <ClientEconomyContent economy={economy.data} />}
    </main>
  );
}

export function ClientEconomyContent({ economy, adminPreview = false }: { economy: ClientEconomy; adminPreview?: boolean }) {
  return (
    <ClientEconomyShell>
      <section className="economy-hero" aria-labelledby="economy-title">
        <div>
          <span className="eyebrow">{adminPreview ? "Prévia administrativa" : "Página exclusiva de economia"}</span>
          <h1 id="economy-title">Economia MRL Travel</h1>
          <p>
            {economy.client.fullName}, esta página mostra somente a economia registrada nas suas emissões.
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
        </div>
        {economy.items.length === 0 ? (
          <div className="panel-state">Nenhuma economia registrada ainda.</div>
        ) : (
          <div className="economy-list">
            {economy.items.map((item) => (
              <article className="economy-item" key={item.id}>
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
