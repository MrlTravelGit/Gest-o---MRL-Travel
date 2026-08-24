import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Calculator, CreditCard, ExternalLink, Pencil, ReceiptText, RefreshCw, Save, WalletCards } from "lucide-react";
import { ClientSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { parseMoneyPtBr } from "@/lib/admin-inputs";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { getCardStatementOptions, getCardStatements, recalculateCardStatement, saveCardStatement } from "@/services/invoices";
import type { CardStatement } from "@/types/admin-modules";

const currentMonth = new Date().toISOString().slice(0, 7);
const emptyForm = () => ({
  statementId: "", clientId: "", institutionId: "", accountPersonType: "PF" as "PF" | "PJ", cardId: "",
  statementMonth: currentMonth, totalAmount: "", domesticAmount: "", internationalAmount: "", partnerAmount: "",
  partnerScope: "program_partner" as "program_partner" | "airline" | "streaming" | "custom", partnerName: "",
  pointsReceived: "", fxRate: "", fxRateDate: "", fxSource: "", notes: "",
});
const optionalMoney = (value: string) => value.trim() ? parseMoneyPtBr(value) : null;
const predictionCopy: Record<string, string> = { pending_card: "Previsão pendente, associe um cartão", pending_breakdown: "Aguardando detalhamento das compras", calculated: "Previsão calculada", outdated: "Previsão desatualizada", confirmed: "Pontos confirmados", not_applicable: "Previsão não aplicável" };

export function AdminInvoicesPage() {
  const [params] = useSearchParams();
  const initialClient = params.get("clientId") || "";
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const options = useQuery({ queryKey: ["card-statement-options-v3"], queryFn: () => getCardStatementOptions() });
  const [filterClient, setFilterClient] = useState(initialClient);
  const [filterStatus, setFilterStatus] = useState("all");
  const statements = useQuery({ queryKey: ["card-statements", filterClient, filterStatus], queryFn: () => getCardStatements({ clientId: filterClient, status: filterStatus }) });
  const [form, setForm] = useState(() => ({ ...emptyForm(), clientId: initialClient }));
  const clients = Array.isArray(options.data?.clients) ? options.data.clients : [];
  const clientOptions = useMemo(() => clients.map((client) => ({ ...client, accounts: [] })), [clients]);
  const institutions = Array.isArray(options.data?.institutions) ? options.data.institutions : [];
  const allCards = Array.isArray(options.data?.cards) ? options.data.cards : [];
  const cards = useMemo(() => allCards.filter((card) => card.clientId === form.clientId).sort((a, b) => Number(b.institutionId === form.institutionId) - Number(a.institutionId === form.institutionId)), [allCards, form.clientId, form.institutionId]);
  const selectedCard = cards.find((card) => card.cardId === form.cardId);
  const breakdownTotal = useMemo(() => [form.domesticAmount, form.internationalAmount, form.partnerAmount].reduce<number>((sum, value) => sum + (optionalMoney(value) ?? 0), 0), [form.domesticAmount, form.internationalAmount, form.partnerAmount]);
  const items = Array.isArray(statements.data?.items) ? statements.data.items : [];

  const save = useMutation({
    mutationFn: () => saveCardStatement({ statementId: form.statementId || null, clientId: form.clientId, financialInstitutionId: form.institutionId, accountPersonType: form.accountPersonType, cardId: form.cardId || null, statementMonth: form.statementMonth, totalAmount: optionalMoney(form.totalAmount) ?? 0, domesticAmount: optionalMoney(form.domesticAmount), internationalAmount: optionalMoney(form.internationalAmount), partnerAmount: optionalMoney(form.partnerAmount), partnerScope: form.partnerScope, partnerName: form.partnerName, pointsReceived: optionalMoney(form.pointsReceived), fxRate: optionalMoney(form.fxRate), fxRateDate: form.fxRateDate, fxSource: form.fxSource, notes: form.notes, operationId: crypto.randomUUID() }),
    onSuccess: () => void Promise.all([queryClient.invalidateQueries({ queryKey: ["card-statements"] }), queryClient.invalidateQueries({ queryKey: ["client-invoices"] })]),
  });
  const recalculate = useMutation({ mutationFn: recalculateCardStatement, onSuccess: () => void Promise.all([queryClient.invalidateQueries({ queryKey: ["card-statements"] }), queryClient.invalidateQueries({ queryKey: ["client-invoices"] })]) });

  const chooseCard = (cardId: string) => { const card = allCards.find((item) => item.cardId === cardId); setForm((current) => ({ ...current, cardId, institutionId: card?.institutionId || current.institutionId })); };
  const edit = (item: CardStatement) => {
    setForm({ ...emptyForm(), statementId: item.statementId, clientId: item.clientId || "", institutionId: item.institutionId || "", accountPersonType: item.accountPersonType || "PF", cardId: item.cardId || "", statementMonth: item.statementMonth.slice(0, 7), totalAmount: String(item.totalSpend).replace(".", ","), domesticAmount: item.domesticAmount == null ? "" : String(item.domesticAmount).replace(".", ","), internationalAmount: item.internationalAmount == null ? "" : String(item.internationalAmount).replace(".", ","), pointsReceived: item.receivedPoints ? String(item.receivedPoints).replace(".", ",") : "", fxRate: item.fxRate == null ? "" : String(item.fxRate).replace(".", ","), fxRateDate: item.fxRateDate || "", fxSource: item.fxSource || "", notes: item.notes || "" });
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  useEffect(() => {
    const statementId = params.get("statementId");
    const item = statementId ? items.find((candidate) => candidate.statementId === statementId) : undefined;
    if (item && form.statementId !== statementId) edit(item);
  }, [items, params, form.statementId]);

  return <AppShell title="Faturas" hideHeading>
    <PageHeader eyebrow="Cartões" title="Faturas e pontos previstos" description="Cada fatura fica isolada por cliente. O motor v2 calcula no servidor e preserva regra, cotação e memória histórica." />
    <aside className="invoice-engine-note invoice-engine-compact"><Calculator /><div><strong>Motor de regras v2</strong><span>Aplica vigência, origem da compra, parceiro, faixa e condições do cartão. A previsão nunca movimenta saldo real.</span></div><a href="/admin/cartoes">Abrir catálogo</a></aside>
    {options.isLoading && <LoadingState />}{options.isError && <ErrorState message={options.error.message} retry={() => void options.refetch()} />}
    {options.data && <form ref={formRef} className="module-form invoice-entry-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <div className="form-title"><ReceiptText /><div><h2>{form.statementId ? "Editar fatura" : "Nova fatura"}</h2><p>Cliente, banco e tipo da conta são obrigatórios. O cartão pode ser associado depois.</p></div></div>
      <div className="form-grid">
        <label className="field-full">Cliente<ClientSelect clients={clientOptions} value={form.clientId} onChange={(clientId) => setForm((current) => ({ ...current, clientId, cardId: current.clientId === clientId ? current.cardId : "" }))} /></label>
        <label>Banco ou instituição<select required value={form.institutionId} onChange={(event) => setForm((current) => ({ ...current, institutionId: event.target.value }))}><option value="">Selecione</option>{institutions.map((item) => <option key={item.institutionId} value={item.institutionId}>{item.name}</option>)}</select></label>
        <label>Tipo da conta<select required value={form.accountPersonType} onChange={(event) => setForm((current) => ({ ...current, accountPersonType: event.target.value as "PF" | "PJ" }))}><option value="PF">Pessoa Física (PF)</option><option value="PJ">Pessoa Jurídica (PJ)</option></select></label>
        <label className="field-full">Cartão associado <small>opcional</small><select value={form.cardId} disabled={!form.clientId} onChange={(event) => chooseCard(event.target.value)}><option value="">Sem cartão por enquanto</option>{cards.map((item) => <option key={item.cardId} value={item.cardId}>{item.label}{item.institutionId === form.institutionId ? " · mesmo banco" : ""}</option>)}</select></label>
        {selectedCard?.requiresReview && <div className="catalog-contract-warning field-full"><AlertTriangle /><div><strong>Revisão contratual necessária</strong><span>O backend manterá a previsão pendente se a taxa real ainda não estiver confirmada.</span></div></div>}
        <label>Competência<input type="month" required value={form.statementMonth} onChange={(event) => setForm((current) => ({ ...current, statementMonth: event.target.value }))} /></label><label>Total da fatura<input inputMode="decimal" required value={form.totalAmount} onChange={(event) => setForm((current) => ({ ...current, totalAmount: event.target.value }))} /></label>
        <label>Compras nacionais<input inputMode="decimal" value={form.domesticAmount} onChange={(event) => setForm((current) => ({ ...current, domesticAmount: event.target.value }))} /></label><label>Compras internacionais<input inputMode="decimal" value={form.internationalAmount} onChange={(event) => setForm((current) => ({ ...current, internationalAmount: event.target.value }))} /></label>
        <label>Parceiro ou companhia<input inputMode="decimal" value={form.partnerAmount} onChange={(event) => setForm((current) => ({ ...current, partnerAmount: event.target.value }))} /></label><label>Tipo do parceiro<select value={form.partnerScope} onChange={(event) => setForm((current) => ({ ...current, partnerScope: event.target.value as typeof current.partnerScope }))}><option value="program_partner">Parceiro do programa</option><option value="airline">Companhia aérea</option><option value="streaming">Streaming</option><option value="custom">Personalizado</option></select></label>
        <label className="field-full">Nome do parceiro<input value={form.partnerName} onChange={(event) => setForm((current) => ({ ...current, partnerName: event.target.value }))} /></label><label>Pontos efetivamente recebidos<input inputMode="decimal" value={form.pointsReceived} onChange={(event) => setForm((current) => ({ ...current, pointsReceived: event.target.value }))} /></label>
        {selectedCard?.basis === "usd" && <><label>Cotação utilizada<input inputMode="decimal" value={form.fxRate} onChange={(event) => setForm((current) => ({ ...current, fxRate: event.target.value }))} /></label><label>Data da cotação<input type="date" value={form.fxRateDate} onChange={(event) => setForm((current) => ({ ...current, fxRateDate: event.target.value }))} /></label><label>Origem da cotação<input value={form.fxSource} onChange={(event) => setForm((current) => ({ ...current, fxSource: event.target.value }))} /></label></>}
        <label className="field-full">Observação<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
      </div>
      <div className={`invoice-prediction-panel ${form.cardId ? "ready" : "pending"}`}><Calculator /><div><span>Previsão oficial</span><strong>{save.data ? predictionCopy[save.data.predictionStatus] || save.data.predictionStatus : form.cardId ? "Cálculo executado no backend ao salvar" : predictionCopy.pending_card}</strong><small>{save.data?.predictedPoints != null ? `${formatPoints(save.data.predictedPoints)} pontos previstos · base segmentada ${formatCurrency(breakdownTotal)}` : "Pontos previstos e recebidos permanecem separados."}</small></div></div>
      {save.isError && <div className="form-error">{save.error.message}</div>}{save.isSuccess && <div className="form-success">Fatura salva. {save.data.warning || predictionCopy[save.data.predictionStatus]}</div>}
      <div className="dialog-actions">{form.statementId && <button type="button" className="secondary-button" onClick={() => { setForm(emptyForm()); save.reset(); }}>Cancelar edição</button>}<button className="primary-button" disabled={save.isPending || !form.clientId || !form.institutionId || !form.statementMonth || !form.totalAmount}><Save /> {form.cardId ? "Calcular e salvar fatura" : "Salvar fatura"}</button></div>
    </form>}
    <section className="data-section invoice-recent-section"><div className="section-heading"><div><span className="eyebrow">Histórico administrativo</span><h2>Lançamentos recentes</h2></div>{options.data && <div className="data-filters"><ClientSelect clients={clientOptions} value={filterClient} onChange={setFilterClient} /><select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="all">Todas as situações</option><option value="pending_card">Sem cartão</option><option value="pending_breakdown">Aguardando detalhamento</option><option value="calculated">Calculadas</option><option value="confirmed">Confirmadas</option></select></div>}</div>
      {statements.isLoading && <LoadingState />}{statements.isError && <ErrorState message={statements.error.message} retry={() => void statements.refetch()} />}{statements.data && items.length === 0 && <EmptyState title="Nenhuma fatura" description="Registre a primeira fatura; o cartão pode ser associado mais tarde." />}
      {items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Competência</th><th>Banco / conta</th><th>Cartão</th><th>Valor</th><th>Previstos</th><th>Recebidos</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <tr key={item.statementId}><td><strong>{item.clientName}</strong></td><td>{formatDate(item.statementMonth)}</td><td><strong>{item.institutionName || "Vínculo pendente"}</strong><small>{item.accountPersonType || "—"}</small></td><td>{item.cardLabel ? <><strong>{item.cardLabel}</strong><small>{item.calculationVersion || "legado"}</small></> : <span className="invoice-pending-copy">Associe um cartão</span>}</td><td>{formatCurrency(item.totalSpend)}</td><td>{item.predictedPoints == null ? "—" : formatPoints(item.predictedPoints)}</td><td>{formatPoints(item.receivedPoints)}</td><td><StatusBadge status={item.predictionStatus} /></td><td><div className="invoice-row-actions"><button className="table-action" title="Ver detalhes" onClick={() => window.alert(JSON.stringify(item.ruleSnapshot || {}, null, 2))}><ExternalLink /> Detalhes</button><button className="table-action" onClick={() => edit(item)}><Pencil /> Editar</button><button className="table-action" onClick={() => edit(item)}><CreditCard /> {item.cardId ? "Trocar cartão" : "Associar cartão"}</button><button className="table-action" disabled={!item.cardId || recalculate.isPending} onClick={() => recalculate.mutate(item.statementId)}><RefreshCw /> Recalcular</button><button className="table-action" onClick={() => edit(item)}><WalletCards /> Registrar pontos</button></div></td></tr>)}</tbody></table></div>}
      {recalculate.isError && <div className="form-error">{recalculate.error.message}</div>}{recalculate.isSuccess && <div className="form-success">Previsão recalculada sem criar lançamentos de pontos.</div>}
    </section>
    <section className="invoice-secondary-modules" aria-label="Importação e reconciliação"><article><ReceiptText /><div><span>Etapa 5</span><h2>Importação de faturas</h2><p>O fluxo de importação permanece disponível depois dos lançamentos manuais.</p></div><a className="secondary-button" href="/admin/importacoes">Abrir importações</a></article><article><WalletCards /><div><span>Etapa 6</span><h2>Reconciliação de cashback</h2><p>A reconciliação continua isolada da criação e da listagem de faturas.</p></div><a className="secondary-button" href="/admin/viagens-e-economia">Abrir reconciliação</a></article></section>
  </AppShell>;
}
