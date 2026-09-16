import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CreditCard, Pencil, ReceiptText } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState } from "@/components/admin/AdminPage";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { getCardStatements } from "@/services/invoices";

export function ClientInvoicesPanel({ clientId }: { clientId: string }) {
  const invoices = useQuery({ queryKey: ["client-invoices", clientId], queryFn: () => getCardStatements({ clientId }) });
  const items = Array.isArray(invoices.data?.items) ? invoices.data.items : [];
  return <section className="data-section client-invoices-panel">
    <div className="section-heading"><div><span className="eyebrow">Faturas</span><h2>Faturas e pontos previstos</h2><p>Somente registros vinculados a este cliente.</p></div><Link className="secondary-button" to={`/admin/faturas?clientId=${clientId}`}><ReceiptText /> Nova fatura</Link></div>
    {invoices.isLoading && <LoadingState />}{invoices.isError && <ErrorState message={invoices.error.message} retry={() => void invoices.refetch()} />}
    {invoices.data && items.length === 0 && <EmptyState title="Nenhuma fatura vinculada" description="Crie a primeira fatura mantendo o contexto deste cliente." />}
    {items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Competência</th><th>Banco / conta</th><th>Cartão</th><th>Valor</th><th>Previsão</th><th>Recebidos</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{items.map((item) => <tr key={item.statementId}><td>{formatDate(item.statementMonth)}</td><td><strong>{item.institutionName || "Vínculo pendente"}</strong><small>{item.accountPersonType || "—"}</small></td><td>{item.cardLabel || <span className="invoice-pending-copy"><AlertTriangle /> Sem cartão</span>}</td><td>{formatCurrency(item.totalSpend)}</td><td>{item.predictedPoints == null ? "—" : formatPoints(item.predictedPoints)}</td><td>{item.receivedPoints == null ? "—" : formatPoints(item.receivedPoints)}</td><td><StatusBadge status={item.predictionStatus} /></td><td><Link className="table-action" to={`/admin/faturas?clientId=${clientId}&statementId=${item.statementId}`}><Pencil /> Editar</Link>{!item.cardId && <Link className="table-action" to={`/admin/faturas?clientId=${clientId}&statementId=${item.statementId}`}><CreditCard /> Associar</Link>}</td></tr>)}</tbody></table></div>}
  </section>;
}
