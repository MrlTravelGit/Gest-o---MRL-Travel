import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Calculator, CreditCard, ExternalLink, FileUp, LoaderCircle, Pencil, ReceiptText, RefreshCw, Save, ScanLine, WalletCards, X } from "lucide-react";
import { ClientSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { parseMoneyPtBr } from "@/lib/admin-inputs";
import { calculateInvoicePoints, isSuspiciousExchangeRate } from "@/lib/invoice-points";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { discardInvoiceImportAttempt, extractInvoiceFromPrint, getCardStatementOptions, getCardStatements, recalculateCardStatement, saveCardStatement } from "@/services/invoices";
import type { InvoicePrintExtractionResult } from "@/services/invoices";
import type { CardStatement } from "@/types/admin-modules";

const currentMonth = new Date().toISOString().slice(0, 7);
const emptyForm = () => ({
  statementId: "", clientId: "", institutionId: "", accountPersonType: "PF" as "PF" | "PJ", cardId: "",
  statementMonth: currentMonth, totalAmount: "", loyaltyProgramId: "", pointsReceived: "", fxRate: "", fxRateDate: "", notes: "",
});
const optionalMoney = (value: string) => {
  try { return value.trim() ? parseMoneyPtBr(value) : null; }
  catch { return null; }
};
const formatDecimalInput = (value: string) => {
  try { return value.trim() ? parseMoneyPtBr(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
  catch { return value; }
};
const normalizeMatch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const looselyMatches = (candidate: string, extracted: string) => {
  const left = normalizeMatch(candidate);
  const right = normalizeMatch(extracted);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
};
const predictionCopy: Record<string, string> = { pending_card: "Previsão pendente, associe um cartão", pending_breakdown: "Regra do cartão não configurada", missing_fx: "Sem cotação", calculated: "Previsão calculada", outdated: "Previsão desatualizada", confirmed: "Pontos confirmados", divergent: "Pontos divergentes", not_applicable: "Previsão não aplicável" };

export function AdminInvoicesPage() {
  const [params] = useSearchParams();
  const initialClient = params.get("clientId") || "";
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const options = useQuery({ queryKey: ["card-statement-options-v4"], queryFn: () => getCardStatementOptions() });
  const [filterClient, setFilterClient] = useState(initialClient);
  const [filterStatus, setFilterStatus] = useState("all");
  const statements = useQuery({ queryKey: ["card-statements", filterClient, filterStatus], queryFn: () => getCardStatements({ clientId: filterClient, status: filterStatus }) });
  const [form, setForm] = useState(() => ({ ...emptyForm(), clientId: initialClient }));
  const [printExtraction, setPrintExtraction] = useState<InvoicePrintExtractionResult | null>(null);
  const [appliedImportAttemptId, setAppliedImportAttemptId] = useState<string | null>(null);
  const [importNotices, setImportNotices] = useState<string[]>([]);
  const clients = Array.isArray(options.data?.clients) ? options.data.clients : [];
  const clientOptions = useMemo(() => clients.map((client) => ({ ...client, accounts: [] })), [clients]);
  const institutions = Array.isArray(options.data?.institutions) ? options.data.institutions : [];
  const allCards = Array.isArray(options.data?.cards) ? options.data.cards : [];
  const programs = Array.isArray(options.data?.programs) ? options.data.programs : [];
  const cards = useMemo(() => allCards.filter((card) => card.clientId === form.clientId).sort((a, b) => Number(b.institutionId === form.institutionId) - Number(a.institutionId === form.institutionId)), [allCards, form.clientId, form.institutionId]);
  const selectedCard = cards.find((card) => card.cardId === form.cardId);
  const selectedProgram = programs.find((program) => program.programId === form.loyaltyProgramId);
  const exchangeRate = optionalMoney(form.fxRate);
  const suspiciousExchangeRate = isSuspiciousExchangeRate(exchangeRate);
  const preview = useMemo(() => calculateInvoicePoints({ invoiceTotal: optionalMoney(form.totalAmount) ?? 0, exchangeRate, cardRule: selectedCard ? { cardName: selectedCard.label, earningType: selectedCard.earningType || selectedCard.basis || "brl", pointsPerUsd: selectedCard.pointsPerUsd, pointsPerBrl: selectedCard.pointsPerBrl } : null, programName: selectedProgram?.name || selectedCard?.programName, programMileValue: selectedProgram?.mileValue ?? selectedCard?.mileValue, actualReceivedPoints: optionalMoney(form.pointsReceived) }), [form.totalAmount, exchangeRate, form.pointsReceived, selectedCard, selectedProgram]);
  const items = Array.isArray(statements.data?.items) ? statements.data.items : [];

  const save = useMutation({
    mutationFn: () => saveCardStatement({ statementId: form.statementId || null, clientId: form.clientId, financialInstitutionId: form.institutionId, accountPersonType: form.accountPersonType, cardId: form.cardId || null, statementMonth: form.statementMonth, totalAmount: optionalMoney(form.totalAmount) ?? 0, loyaltyProgramId: form.loyaltyProgramId || null, pointsReceived: optionalMoney(form.pointsReceived), fxRate: exchangeRate, fxRateDate: form.fxRateDate, notes: form.notes, importAttemptId: appliedImportAttemptId, operationId: crypto.randomUUID() }),
    onSuccess: () => { setPrintExtraction(null); setAppliedImportAttemptId(null); setImportNotices([]); void Promise.all([queryClient.invalidateQueries({ queryKey: ["card-statements"] }), queryClient.invalidateQueries({ queryKey: ["client-invoices"] })]); },
  });
  const recalculate = useMutation({ mutationFn: recalculateCardStatement, onSuccess: () => void Promise.all([queryClient.invalidateQueries({ queryKey: ["card-statements"] }), queryClient.invalidateQueries({ queryKey: ["client-invoices"] })]) });
  const extractPrint = useMutation({
    mutationFn: (file: File) => extractInvoiceFromPrint(form.clientId, file),
    onSuccess: (result) => { setPrintExtraction(result); setAppliedImportAttemptId(null); setImportNotices([]); },
  });
  const discardPrint = useMutation({
    mutationFn: (attemptId: string) => discardInvoiceImportAttempt(attemptId),
    onSuccess: () => { setPrintExtraction(null); setAppliedImportAttemptId(null); setImportNotices([]); },
  });

  const chooseCard = (cardId: string) => { const card = allCards.find((item) => item.cardId === cardId); setForm((current) => ({ ...current, cardId, institutionId: card?.institutionId || current.institutionId, loyaltyProgramId: card?.loyaltyProgramId || current.loyaltyProgramId })); };
  const useExtractedData = () => {
    if (!printExtraction) return;
    const data = printExtraction.extracted_data;
    const institution = institutions.find((item) => looselyMatches(item.name, data.bank_name));
    const clientCards = allCards.filter((card) => card.clientId === form.clientId);
    const card = clientCards.find((item) => (data.card_last_digits && normalizeMatch(item.label).endsWith(normalizeMatch(data.card_last_digits))) || (data.card_name && looselyMatches(item.label, data.card_name)));
    const program = programs.find((item) => data.loyalty_program_name && looselyMatches(item.name, data.loyalty_program_name));
    const notices = [...data.warnings];
    if (!card) notices.push("Cartão não identificado. Selecione manualmente.");
    if (!program) notices.push("Programa não identificado. Selecione manualmente.");
    setForm((current) => ({
      ...current,
      institutionId: card?.institutionId || institution?.institutionId || "",
      cardId: card?.cardId || "",
      statementMonth: /^\d{4}-\d{2}$/.test(data.competency_month) ? data.competency_month : current.statementMonth,
      totalAmount: data.invoice_total == null ? current.totalAmount : formatDecimalInput(String(data.invoice_total)),
      fxRate: data.exchange_rate == null ? current.fxRate : formatDecimalInput(String(data.exchange_rate)),
      fxRateDate: /^\d{4}-\d{2}-\d{2}$/.test(data.exchange_rate_date) ? data.exchange_rate_date : current.fxRateDate,
      loyaltyProgramId: program?.programId || "",
      pointsReceived: data.actual_received_points == null ? current.pointsReceived : String(Math.round(data.actual_received_points)),
    }));
    setAppliedImportAttemptId(printExtraction.attempt_id);
    setImportNotices(Array.from(new Set(notices)));
    setPrintExtraction(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const edit = (item: CardStatement) => {
    setForm({ ...emptyForm(), statementId: item.statementId, clientId: item.clientId || "", institutionId: item.institutionId || "", accountPersonType: item.accountPersonType || "PF", cardId: item.cardId || "", statementMonth: item.statementMonth.slice(0, 7), totalAmount: formatDecimalInput(String(item.totalSpend)), loyaltyProgramId: item.loyaltyProgramId || "", pointsReceived: item.receivedPoints == null ? "" : String(item.receivedPoints).replace(".", ","), fxRate: item.fxRate == null ? "" : formatDecimalInput(String(item.fxRate)), fxRateDate: item.fxRateDate || "", notes: item.notes || "" });
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  useEffect(() => {
    const statementId = params.get("statementId");
    const item = statementId ? items.find((candidate) => candidate.statementId === statementId) : undefined;
    if (item && form.statementId !== statementId) edit(item);
  }, [items, params, form.statementId]);

  return <AppShell title="Faturas" hideHeading>
    <PageHeader eyebrow="Cartões" title="Faturas e pontos previstos" description="Lance a fatura, confira os pontos previstos e acompanhe o recebimento em um único fluxo." />
    {options.isLoading && <LoadingState />}{options.isError && <ErrorState message={options.error.message} retry={() => void options.refetch()} />}
    {options.data && <form ref={formRef} className="module-form invoice-entry-form" onSubmit={(event) => { event.preventDefault(); if (suspiciousExchangeRate && !window.confirm("Confira a cotação. O valor informado parece fora do padrão. Deseja salvar mesmo assim?")) return; save.mutate(); }}>
      <div className="invoice-form-title-row"><div className="form-title"><ReceiptText /><div><h2>{form.statementId ? "Editar fatura" : "Nova fatura"}</h2><p>Preencha os dados essenciais e confira o cálculo antes de salvar.</p></div></div><div className="invoice-print-upload"><input ref={fileInputRef} type="file" hidden accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) extractPrint.mutate(file); }} /><button type="button" className="secondary-button" disabled={!form.clientId || extractPrint.isPending} title={!form.clientId ? "Selecione o cliente antes de enviar o arquivo" : undefined} onClick={() => fileInputRef.current?.click()}>{extractPrint.isPending ? <LoaderCircle className="invoice-upload-spinner" /> : <FileUp />} {extractPrint.isPending ? "Lendo fatura..." : "Preencher com print"}</button><small>PNG, JPG ou PDF · até 15 MB</small></div></div>
      {extractPrint.isError && <div className="form-error">{extractPrint.error.message}</div>}
      {printExtraction && <section className="invoice-extraction-review" aria-labelledby="invoice-extraction-title"><header><div><ScanLine /><span>Leitura concluída</span><h3 id="invoice-extraction-title">Dados encontrados no print</h3></div><strong>{Math.round(printExtraction.extracted_data.confidence_score)}% de confiança</strong></header><p className="invoice-review-warning"><AlertTriangle /> Confira os dados antes de salvar. A leitura não cria a fatura automaticamente.</p><dl><div><dt>Banco</dt><dd>{printExtraction.extracted_data.bank_name || "Não identificado"}</dd></div><div><dt>Cartão</dt><dd>{[printExtraction.extracted_data.card_name, printExtraction.extracted_data.card_last_digits && `final ${printExtraction.extracted_data.card_last_digits}`].filter(Boolean).join(" · ") || "Não identificado"}</dd></div><div><dt>Competência</dt><dd>{printExtraction.extracted_data.competency_month || "Não identificada"}</dd></div><div><dt>Vencimento</dt><dd>{printExtraction.extracted_data.due_date || "Não identificado"}</dd></div><div><dt>Valor da fatura</dt><dd>{printExtraction.extracted_data.invoice_total == null ? "Não identificado" : formatCurrency(printExtraction.extracted_data.invoice_total)}</dd></div><div><dt>Cotação</dt><dd>{printExtraction.extracted_data.exchange_rate == null ? "Não identificada" : formatCurrency(printExtraction.extracted_data.exchange_rate)}</dd></div><div><dt>Programa</dt><dd>{printExtraction.extracted_data.loyalty_program_name || "Não identificado"}</dd></div><div><dt>Pontos recebidos</dt><dd>{printExtraction.extracted_data.actual_received_points == null ? "Não identificados" : formatPoints(printExtraction.extracted_data.actual_received_points)}</dd></div></dl>{printExtraction.extracted_data.warnings.length > 0 && <ul>{printExtraction.extracted_data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}<div className="invoice-extraction-actions"><button type="button" className="secondary-button" disabled={discardPrint.isPending} onClick={() => discardPrint.mutate(printExtraction.attempt_id)}><X /> Descartar leitura</button><button type="button" className="primary-button" onClick={useExtractedData}><ScanLine /> Usar dados</button></div>{discardPrint.isError && <div className="form-error">{discardPrint.error.message}</div>}</section>}
      {appliedImportAttemptId && <div className="invoice-import-applied" role="status"><AlertTriangle /><div><strong>Confira os dados antes de salvar</strong><span>A leitura preencheu o formulário, mas você continua responsável pela conferência e pode corrigir qualquer campo.</span>{importNotices.map((notice) => <small key={notice}>{notice}</small>)}</div></div>}
      <div className="invoice-entry-layout">
        <div className="invoice-form-sections">
          <section className="invoice-form-block"><header><span>01</span><div><h3>Cliente e cartão</h3><p>Defina para quem e para qual cartão esta fatura pertence.</p></div></header><div className="form-grid">
            <label className="field-full">Cliente<ClientSelect clients={clientOptions} value={form.clientId} onChange={(clientId) => { setForm((current) => ({ ...current, clientId, cardId: current.clientId === clientId ? current.cardId : "" })); if (clientId !== form.clientId) { setPrintExtraction(null); setAppliedImportAttemptId(null); setImportNotices([]); } }} /></label>
            <label>Banco ou instituição<select required value={form.institutionId} onChange={(event) => setForm((current) => ({ ...current, institutionId: event.target.value }))}><option value="">Selecione</option>{institutions.map((item) => <option key={item.institutionId} value={item.institutionId}>{item.name}</option>)}</select></label>
            <label>Tipo da conta<select required value={form.accountPersonType} onChange={(event) => setForm((current) => ({ ...current, accountPersonType: event.target.value as "PF" | "PJ" }))}><option value="PF">Pessoa Física (PF)</option><option value="PJ">Pessoa Jurídica (PJ)</option></select></label>
            <label className="field-full">Cartão associado<select required value={form.cardId} disabled={!form.clientId} onChange={(event) => chooseCard(event.target.value)}><option value="">Selecione o cartão</option>{cards.map((item) => <option key={item.cardId} value={item.cardId}>{item.label}{item.institutionId === form.institutionId ? " · mesmo banco" : ""}</option>)}</select></label>
            {selectedCard?.requiresReview && <div className="catalog-contract-warning field-full"><AlertTriangle /><div><strong>Revisão contratual necessária</strong><span>A previsão ficará pendente se a taxa real do cartão ainda não estiver confirmada.</span></div></div>}
          </div></section>
          <section className="invoice-form-block"><header><span>02</span><div><h3>Fatura</h3><p>Informe o total e a cotação considerada pelo banco.</p></div></header><div className="form-grid">
            <label>Competência<input type="month" required value={form.statementMonth} onChange={(event) => setForm((current) => ({ ...current, statementMonth: event.target.value }))} /></label>
            <label>Valor total da fatura<input inputMode="decimal" required placeholder="20.000,00" value={form.totalAmount} onChange={(event) => setForm((current) => ({ ...current, totalAmount: event.target.value }))} onBlur={() => setForm((current) => ({ ...current, totalAmount: formatDecimalInput(current.totalAmount) }))} /></label>
            <label>Cotação do dólar usada<input inputMode="decimal" required placeholder="5,50" value={form.fxRate} onChange={(event) => setForm((current) => ({ ...current, fxRate: event.target.value }))} onBlur={() => setForm((current) => ({ ...current, fxRate: formatDecimalInput(current.fxRate) }))} /><small>Use a cotação do dólar considerada pelo banco na fatura.</small></label>
            <label>Data da cotação<input type="date" required value={form.fxRateDate} onChange={(event) => setForm((current) => ({ ...current, fxRateDate: event.target.value }))} /></label>
            {suspiciousExchangeRate && <div className="invoice-rate-warning field-full" role="alert"><AlertTriangle /><span>Confira a cotação. O valor informado parece fora do padrão.</span></div>}
          </div></section>
          <section className="invoice-form-block"><header><span>03</span><div><h3>Pontuação</h3><p>Escolha o destino dos pontos e registre o valor recebido, quando houver.</p></div></header><div className="form-grid">
            <label className="field-full">Programa que receberá os pontos<select required value={form.loyaltyProgramId} onChange={(event) => setForm((current) => ({ ...current, loyaltyProgramId: event.target.value }))}><option value="">Selecione o programa</option>{programs.map((program) => <option key={program.programId} value={program.programId}>{program.name}</option>)}</select><small>Escolha onde os pontos desta fatura devem cair.</small></label>
            <label className="field-full">Pontos efetivamente recebidos <small>opcional</small><input inputMode="numeric" value={form.pointsReceived} onChange={(event) => setForm((current) => ({ ...current, pointsReceived: event.target.value }))} /></label>
            <label className="field-full">Observação<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
          </div></section>
        </div>
        <aside className={`invoice-prediction-panel invoice-live-preview ${preview.estimatedPoints != null ? "ready" : "pending"}`}><div className="invoice-preview-heading"><Calculator /><div><span>Cálculo em tempo real</span><h3>Prévia dos pontos</h3></div></div><dl><div><dt>Cartão</dt><dd>{selectedCard?.label || "Selecione um cartão"}</dd></div><div><dt>Regra</dt><dd>{selectedCard?.earningType === "usd" || selectedCard?.basis === "usd" ? `${selectedCard?.pointsPerUsd ?? "—"} pontos por dólar` : `${selectedCard?.pointsPerBrl ?? "—"} pontos por real`}</dd></div><div><dt>Valor da fatura</dt><dd>{optionalMoney(form.totalAmount) == null ? "—" : formatCurrency(optionalMoney(form.totalAmount) ?? 0)}</dd></div><div><dt>Cotação</dt><dd>{exchangeRate == null ? "—" : formatCurrency(exchangeRate)}</dd></div><div><dt>Base estimada</dt><dd>{preview.convertedUsd == null ? "—" : `US$ ${preview.convertedUsd.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd></div><div className="invoice-preview-emphasis"><dt>Pontos estimados</dt><dd>{preview.estimatedPoints == null ? "—" : formatPoints(preview.estimatedPoints)}</dd></div><div><dt>Programa</dt><dd>{selectedProgram?.name || selectedCard?.programName || "—"}</dd></div><div className="invoice-preview-value"><dt>Valor aproximado dos pontos</dt><dd>{preview.estimatedPoints != null && preview.estimatedPointsValue == null ? "Milheiro não configurado" : preview.estimatedPointsValue == null ? "—" : formatCurrency(preview.estimatedPointsValue)}</dd></div></dl>{preview.pointsDifference != null && <p className={`invoice-points-difference ${preview.pointsDifference === 0 ? "neutral" : preview.pointsDifference > 0 ? "positive" : "negative"}`}>Diferença: {preview.pointsDifference > 0 ? "+" : ""}{formatPoints(preview.pointsDifference)} pontos</p>}</aside>
      </div>
      {save.isError && <div className="form-error">{save.error.message}</div>}{save.isSuccess && <div className="form-success">Fatura salva. {save.data.warning || predictionCopy[save.data.predictionStatus]}</div>}
      <div className="dialog-actions invoice-submit-actions">{form.statementId && <button type="button" className="secondary-button" onClick={() => { setForm(emptyForm()); save.reset(); }}>Cancelar edição</button>}<button className="primary-button" disabled={save.isPending || !form.clientId || !form.institutionId || !form.cardId || !form.statementMonth || !form.totalAmount || !form.fxRate || !form.fxRateDate || !form.loyaltyProgramId}><Save /> Calcular e salvar fatura</button></div>
    </form>}
    <section className="data-section invoice-recent-section"><div className="section-heading"><div><span className="eyebrow">Histórico administrativo</span><h2>Lançamentos recentes</h2></div>{options.data && <div className="data-filters"><ClientSelect clients={clientOptions} value={filterClient} onChange={setFilterClient} /><select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="all">Todas as situações</option><option value="pending_card">Sem cartão</option><option value="pending_breakdown">Aguardando detalhamento</option><option value="calculated">Calculadas</option><option value="confirmed">Confirmadas</option></select></div>}</div>
      {statements.isLoading && <LoadingState />}{statements.isError && <ErrorState message={statements.error.message} retry={() => void statements.refetch()} />}{statements.data && items.length === 0 && <EmptyState title="Nenhuma fatura" description="Registre a primeira fatura; o cartão pode ser associado mais tarde." />}
      {items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Competência</th><th>Banco / conta</th><th>Cartão</th><th>Valor</th><th>Previstos</th><th>Valor estimado</th><th>Recebidos</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <tr key={item.statementId}><td><strong>{item.clientName}</strong></td><td>{formatDate(item.statementMonth)}</td><td><strong>{item.institutionName || "Vínculo pendente"}</strong><small>{item.accountPersonType || "—"}</small></td><td>{item.cardLabel ? <><strong>{item.cardLabel}</strong><small>{item.programName || item.calculationVersion || "legado"}</small></> : <span className="invoice-pending-copy">Associe um cartão</span>}</td><td>{formatCurrency(item.totalSpend)}</td><td>{item.predictedPoints == null ? "—" : formatPoints(item.predictedPoints)}</td><td>{item.estimatedPointsValue == null ? "—" : formatCurrency(item.estimatedPointsValue)}</td><td>{item.receivedPoints == null ? "—" : formatPoints(item.receivedPoints)}</td><td><StatusBadge status={item.predictionStatus} /></td><td><div className="invoice-row-actions"><button className="table-action" title="Ver detalhes" onClick={() => window.alert(JSON.stringify(item.ruleSnapshot || {}, null, 2))}><ExternalLink /> Detalhes</button><button className="table-action" onClick={() => edit(item)}><Pencil /> Editar</button><button className="table-action" onClick={() => edit(item)}><CreditCard /> {item.cardId ? "Trocar cartão" : "Associar cartão"}</button><button className="table-action" disabled={!item.cardId || recalculate.isPending} onClick={() => recalculate.mutate(item.statementId)}><RefreshCw /> Recalcular</button><button className="table-action" onClick={() => edit(item)}><WalletCards /> Registrar pontos</button></div></td></tr>)}</tbody></table></div>}
      {recalculate.isError && <div className="form-error">{recalculate.error.message}</div>}{recalculate.isSuccess && <div className="form-success">Previsão recalculada sem criar lançamentos de pontos.</div>}
    </section>
    <section className="invoice-secondary-modules" aria-label="Importação e reconciliação"><article><ReceiptText /><div><span>Etapa 5</span><h2>Importação de faturas</h2><p>O fluxo de importação permanece disponível depois dos lançamentos manuais.</p></div><a className="secondary-button" href="/admin/importacoes">Abrir importações</a></article><article><WalletCards /><div><span>Etapa 6</span><h2>Reconciliação de cashback</h2><p>A reconciliação continua isolada da criação e da listagem de faturas.</p></div><a className="secondary-button" href="/admin/viagens-e-economia">Abrir reconciliação</a></article></section>
  </AppShell>;
}
