import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import type { AdminExpirationLot, AdminPointTransaction, PointEntryCategory } from "@/types/admin-clients";

const CATEGORY_LABELS: Record<PointEntryCategory, string> = {
  initial_balance: "Saldo Inicial",
  points_purchase: "Compra de pontos",
  transfer: "Transferência",
  credit_card: "Cartão de Crédito",
  other: "Outros",
};

export function PointTransactionsHistory({ transactions }: { transactions: AdminPointTransaction[] }) {
  return (
    <section className="management-panel history-panel">
      <div className="section-heading compact-heading"><div><span className="eyebrow">Registro imutável</span><h2>Histórico de lançamentos</h2></div></div>
      {transactions.length === 0 ? <div className="panel-state">Nenhum lançamento cadastrado.</div> : (
        <div className="responsive-table"><table><thead><tr><th>Entrada</th><th>Programa</th><th>Tipo</th><th>Pontos</th><th>Valor total</th><th>Milheiro</th><th>Validade</th><th>Detalhamento</th></tr></thead><tbody>
          {transactions.map((transaction) => <tr key={transaction.id}>
            <td>{formatDate(transaction.entryDate ?? transaction.createdAt)}</td>
            <td>{transaction.programName}</td>
            <td>{transaction.entryCategory ? CATEGORY_LABELS[transaction.entryCategory] : "Lançamento anterior"}</td>
            <td>{formatPoints(transaction.pointsAmount)}</td>
            <td>{formatCurrency(transaction.cashTotal ?? 0)}</td>
            <td>{formatCurrency(transaction.costPerThousand ?? 0)}</td>
            <td>{transaction.expiresOn ? formatDate(transaction.expiresOn) : "—"}</td>
            <td className="table-notes">{transaction.description}</td>
          </tr>)}
        </tbody></table></div>
      )}
    </section>
  );
}

export function ExpirationLotsList({ lots }: { lots: AdminExpirationLot[] }) {
  return (
    <section className="management-panel history-panel">
      <div className="section-heading compact-heading"><div><span className="eyebrow">Agenda</span><h2>Vencimentos ativos</h2></div></div>
      {lots.length === 0 ? <div className="panel-state">Nenhum vencimento ativo.</div> : (
        <div className="expiration-list">{lots.map((lot) => <article key={lot.id}>
          <div><strong>{lot.programName}</strong><span>{lot.notes ?? (lot.sourceTransactionId ? "Criado com o lançamento" : "Classificação manual")}</span></div>
          <div><strong>{formatPoints(lot.remainingPoints)}</strong><span>de {formatPoints(lot.pointsAmount)} pontos</span></div>
          <time dateTime={lot.expiresOn}>{formatDate(lot.expiresOn)}</time>
        </article>)}</div>
      )}
    </section>
  );
}
