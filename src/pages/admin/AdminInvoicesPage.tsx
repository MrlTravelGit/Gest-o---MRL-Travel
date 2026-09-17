import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Calculator, CreditCard, ExternalLink, FileUp, LoaderCircle, Pencil, ReceiptText, RefreshCw, Save, ScanLine, Trash2, WalletCards, X } from "lucide-react";
import { ClientSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { parseMoneyPtBr } from "@/lib/admin-inputs";
import { calculateInvoicePoints, isSuspiciousExchangeRate } from "@/lib/invoice-points";
import { InvoiceOcrStartupError, ocrInvoiceImage } from "@/lib/invoices/ocrInvoiceImage";
import { getDefaultExchangeRateDate } from "@/lib/invoices/exchange-rate-date";
import { hasUsefulInvoiceOcrData, parseInvoiceOcrText } from "@/lib/invoices/parseInvoiceOcrText";
import type { ParsedInvoiceOcrData } from "@/lib/invoices/parseInvoiceOcrText";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { deleteCardStatement, getCardStatementOptions, getCardStatements, recalculateCardStatement, saveCardStatement } from "@/services/invoices";
import type { CardStatement } from "@/types/admin-modules";

const currentMonth = new Date().toISOString().slice(0, 7);
const emptyForm = () => ({
  statementId: "", clientId: "", institutionId: "", accountPersonType: "PF" as "PF" | "PJ", cardId: "",
  statementMonth: currentMonth, dueDate: "", totalAmount: "", loyaltyProgramId: "", pointsReceived: "", fxRate: "", fxRateDate: getDefaultExchangeRateDate(), notes: "",
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
const looselyMatches = (candidate: string, extracted: string | null | undefined) => {
  const left = normalizeMatch(candidate);
  const right = normalizeMatch(extracted || "");
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
};
const formatCompetency = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 7)}-01T12:00:00Z`)) : null;
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
  const [printExtraction, setPrintExtraction] = useState<{ data: ParsedInvoiceOcrData; rawText: string; warnings: string[] } | null>(null);
  const [importNotices, setImportNotices] = useState<string[]>([]);
  const [readingPastedPrint, setReadingPastedPrint] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState("");
  const clients = Array.isArray(options.data?.clients) ? options.data.clients : [];
  const clientOptions = useMemo(() => clients.map((client) => ({ ...client, accounts: [] })), [clients]);
  const institutions = Array.isArray(options.data?.institutions) ? options.data.institutions : [];
  const allCards = Array.isArray(options.data?.cards) ? options.data.cards : [];
  const programs = Array.isArray(options.data?.programs) ? options.data.programs : [];
  const cards = useMemo(() => allCards.filter((card) => card.clientId === form.clientId).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(b.institutionId === form.institutionId) - Number(a.institutionId === form.institutionId)), [allCards, form.clientId, form.institutionId]);
  const selectedCard = cards.find((card) => card.cardId === form.cardId);
  const selectedProgram = programs.find((program) => program.programId === form.loyaltyProgramId);
  const selectedInstitution = institutions.find((institution) => institution.institutionId === form.institutionId);
  const exchangeRate = optionalMoney(form.fxRate);
  const suspiciousExchangeRate = isSuspiciousExchangeRate(exchangeRate);
  const preview = useMemo(() => calculateInvoicePoints({ invoiceTotal: optionalMoney(form.totalAmount) ?? 0, exchangeRate, cardRule: selectedCard ? { cardName: selectedCard.label, earningType: selectedCard.earningType || selectedCard.basis || "brl", pointsPerUsd: selectedCard.pointsPerUsd, pointsPerBrl: selectedCard.pointsPerBrl } : null, programName: selectedProgram?.name || selectedCard?.programName, programMileValue: selectedProgram?.mileValue ?? selectedCard?.mileValue, actualReceivedPoints: optionalMoney(form.pointsReceived) }), [form.totalAmount, exchangeRate, form.pointsReceived, selectedCard, selectedProgram]);
  const items = Array.isArray(statements.data?.items) ? statements.data.items : [];
  const invoiceTotal = optionalMoney(form.totalAmount);
  const unusuallyLargeInvoice = (invoiceTotal ?? 0) > 500_000;
  const unusuallyLargePoints = (preview.estimatedPoints ?? 0) > 1_000_000;

  const save = useMutation({
    mutationFn: () => saveCardStatement({ statementId: form.statementId || null, clientId: form.clientId, financialInstitutionId: form.institutionId, accountPersonType: form.accountPersonType, cardId: form.cardId || null, statementMonth: form.statementMonth, dueDate: form.dueDate || null, totalAmount: optionalMoney(form.totalAmount) ?? 0, loyaltyProgramId: form.loyaltyProgramId || null, pointsReceived: optionalMoney(form.pointsReceived), fxRate: exchangeRate, fxRateDate: form.fxRateDate, notes: form.notes, operationId: crypto.randomUUID() }),
    onSuccess: () => { setPrintExtraction(null); setImportNotices([]); void Promise.all([queryClient.invalidateQueries({ queryKey: ["card-statements"] }), queryClient.invalidateQueries({ queryKey: ["client-invoices"] })]); },
  });
  const recalculate = useMutation({ mutationFn: recalculateCardStatement, onSuccess: () => void Promise.all([queryClient.invalidateQueries({ queryKey: ["card-statements"] }), queryClient.invalidateQueries({ queryKey: ["client-invoices"] })]) });
  const extractPrint = useMutation({
    mutationFn: async (file: File) => {
      try {
        const recognized = await ocrInvoiceImage(file);
        const data = parseInvoiceOcrText(recognized.rawText);
        if (!hasUsefulInvoiceOcrData(data)) throw new Error("Nenhum campo útil foi identificado no print. Tente uma imagem mais nítida ou preencha manualmente.");
        return { data, rawText: recognized.rawText, warnings: Array.from(new Set([...recognized.warnings, ...data.warnings])) };
      } catch (error) {
        if (error instanceof Error && /Nesta versão|PNG|JPEG|15 MB|Nenhum campo útil/.test(error.message)) throw error;
        console.error("[Faturas] erro ao ler print localmente", error);
        if (error instanceof InvoiceOcrStartupError) throw error;
        throw new Error("Não foi possível ler o print. Tente uma imagem mais nítida ou preencha manualmente.");
      }
    },
    onSuccess: (result) => { setPrintExtraction(result); setImportNotices([]); },
    onSettled: () => setReadingPastedPrint(false),
  });
  const deleteInvoice = useMutation({
    mutationFn: deleteCardStatement,
    onMutate: async (statementId) => {
      await queryClient.cancelQueries({ queryKey: ["card-statements"] });
      const previous = queryClient.getQueriesData({ queryKey: ["card-statements"] });
      queryClient.setQueriesData({ queryKey: ["card-statements"] }, (current: unknown) => {
        if (!current || typeof current !== "object" || !Array.isArray((current as { items?: unknown[] }).items)) return current;
        const value = current as { items: CardStatement[]; total?: number };
        const found = value.items.some((item) => item.statementId === statementId);
        return { ...value, items: value.items.filter((item) => item.statementId !== statementId), total: Math.max(0, (value.total ?? value.items.length) - (found ? 1 : 0)) };
      });
      return { previous };
    },
    onError: (_error, _id, context) => context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data)),
    onSuccess: () => { setDeleteNotice("Fatura excluída com sucesso."); window.setTimeout(() => setDeleteNotice(""), 4000); },
    onSettled: () => void Promise.all([queryClient.invalidateQueries({ queryKey: ["card-statements"] }), queryClient.invalidateQueries({ queryKey: ["client-invoices"] })]),
  });

  const chooseCard = (cardId: string) => { const card = allCards.find((item) => item.cardId === cardId); setForm((current) => ({ ...current, cardId, institutionId: card?.institutionId || current.institutionId, accountPersonType: card?.accountPersonType || current.accountPersonType, loyaltyProgramId: card?.loyaltyProgramId || current.loyaltyProgramId })); };
  const handleInvoiceImage = useCallback((file: File) => extractPrint.mutate(file), [extractPrint]);
  const useExtractedData = () => {
    if (!printExtraction) return;
    const data = printExtraction.data;
    const institution = institutions.find((item) => looselyMatches(item.name, data.bankName));
    const clientCards = allCards.filter((card) => card.clientId === form.clientId);
    const card = clientCards.find((item) => (data.cardLastDigits && normalizeMatch(item.label).endsWith(normalizeMatch(data.cardLastDigits))) || (data.cardName && looselyMatches(item.label, data.cardName)));
    const program = programs.find((item) => data.loyaltyProgramName && looselyMatches(item.name, data.loyaltyProgramName));
    const notices = [...printExtraction.warnings];
    if (!card && !form.cardId) notices.push("Cartão não identificado. Selecione manualmente.");
    if (!program && !form.loyaltyProgramId) notices.push("Programa não identificado. Selecione manualmente.");
    setForm((current) => ({
      ...current,
      institutionId: card?.institutionId || institution?.institutionId || current.institutionId,
      cardId: card?.cardId || current.cardId,
      accountPersonType: card?.accountPersonType || current.accountPersonType,
      statementMonth: data.competencyMonth && /^\d{4}-\d{2}(?:-\d{2})?$/.test(data.competencyMonth) ? data.competencyMonth.slice(0, 7) : current.statementMonth,
      dueDate: data.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(data.dueDate) ? data.dueDate : current.dueDate,
      totalAmount: data.invoiceTotal == null ? current.totalAmount : formatDecimalInput(String(data.invoiceTotal)),
      fxRate: data.exchangeRate == null ? current.fxRate : formatDecimalInput(String(data.exchangeRate)),
      fxRateDate: data.exchangeRateDate && /^\d{4}-\d{2}-\d{2}$/.test(data.exchangeRateDate) ? data.exchangeRateDate : current.fxRateDate,
      loyaltyProgramId: program?.programId || current.loyaltyProgramId,
      pointsReceived: data.actualReceivedPoints == null ? current.pointsReceived : String(Math.round(data.actualReceivedPoints)),
    }));
    setImportNotices(Array.from(new Set(notices)));
    setPrintExtraction(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const edit = (item: CardStatement) => {
    setForm({ ...emptyForm(), statementId: item.statementId, clientId: item.clientId || "", institutionId: item.institutionId || "", accountPersonType: item.accountPersonType || "PF", cardId: item.cardId || "", statementMonth: item.statementMonth.slice(0, 7), dueDate: item.dueOn || "", totalAmount: formatDecimalInput(String(item.totalSpend)), loyaltyProgramId: item.loyaltyProgramId || "", pointsReceived: item.receivedPoints == null ? "" : String(item.receivedPoints).replace(".", ","), fxRate: item.fxRate == null ? "" : formatDecimalInput(String(item.fxRate)), fxRateDate: item.fxRateDate || "", notes: item.notes || "" });
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  useEffect(() => {
    const statementId = params.get("statementId");
    const item = statementId ? items.find((candidate) => candidate.statementId === statementId) : undefined;
    if (item && form.statementId !== statementId) edit(item);
  }, [items, params, form.statementId]);

  useEffect(() => {
    if (!form.clientId || form.statementId || (form.cardId && cards.some((card) => card.cardId === form.cardId))) return;
    const preferred = cards.find((card) => card.isPrimary) || (cards.length === 1 ? cards[0] : undefined);
    if (!preferred) return;
    setForm((current) => ({ ...current, cardId: preferred.cardId, institutionId: preferred.institutionId || "", accountPersonType: preferred.accountPersonType || "PF", loyaltyProgramId: preferred.loyaltyProgramId || "" }));
  }, [cards, form.cardId, form.clientId, form.statementId]);

  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable)) return;
      const image = Array.from(event.clipboardData?.items || []).find((item) => item.type === "image/png" || item.type === "image/jpeg")?.getAsFile();
      if (!image) return;
      event.preventDefault();
      setReadingPastedPrint(true);
      handleInvoiceImage(new File([image], `fatura-colada-${Date.now()}.${image.type === "image/png" ? "png" : "jpg"}`, { type: image.type }));
    };
    document.addEventListener("paste", pasteImage);
    return () => document.removeEventListener("paste", pasteImage);
  }, [handleInvoiceImage]);

  const submitInvoice = () => {
    if (suspiciousExchangeRate && !window.confirm("Confira a cotação. O valor informado parece fora do padrão. Deseja salvar mesmo assim?")) return;
    if (unusuallyLargeInvoice && !window.confirm("O valor da fatura é superior a R$ 500.000,00. Confirma o lançamento?")) return;
    if (unusuallyLargePoints && !window.confirm("A previsão ultrapassa 1.000.000 de pontos. Confirma o cálculo e o salvamento?")) return;
    save.mutate();
  };

  const requestDelete = (item: CardStatement) => {
    setDeleteNotice("");
    if (!window.confirm("Deseja excluir esta fatura? Essa ação remove a previsão de pontos vinculada a este lançamento.")) return;
    deleteInvoice.mutate(item.statementId);
  };

  return <AppShell title="Faturas" hideHeading>
    <PageHeader eyebrow="Cartões" title="Faturas e pontos previstos" description="Lance a fatura, confira os pontos previstos e acompanhe o recebimento em um único fluxo." />
    {options.isLoading && <LoadingState />}{options.isError && <ErrorState message={options.error.message} retry={() => void options.refetch()} />}
    {options.data && <form ref={formRef} className="module-form invoice-entry-form" onSubmit={(event) => { event.preventDefault(); submitInvoice(); }}>
      <div className="invoice-form-title-row"><div className="form-title"><ReceiptText /><div><h2>{form.statementId ? "Editar fatura" : "Nova fatura"}</h2><p>Preencha os dados essenciais e confira o cálculo antes de salvar.</p></div></div><div className="invoice-print-upload"><input ref={fileInputRef} type="file" hidden accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { setReadingPastedPrint(false); handleInvoiceImage(file); } }} /><button type="button" className="secondary-button" disabled={extractPrint.isPending} onClick={() => fileInputRef.current?.click()}>{extractPrint.isPending ? <LoaderCircle className="invoice-upload-spinner" /> : <FileUp />} {extractPrint.isPending ? (readingPastedPrint ? "Lendo print colado" : "Lendo imagem...") : "Preencher com print"}</button><small>PNG, JPG ou JPEG · você também pode colar com Ctrl+V</small></div></div>
      {extractPrint.isError && <div className="form-error">{extractPrint.error.message}</div>}
      {printExtraction && <div className="invoice-ocr-modal-backdrop" role="presentation"><section className="invoice-extraction-review invoice-ocr-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-extraction-title"><header><div><ScanLine /><span>OCR local concluído</span><h3 id="invoice-extraction-title">Dados encontrados no print</h3></div><button type="button" className="icon-button" aria-label="Fechar" onClick={() => setPrintExtraction(null)}><X /></button></header><p className="invoice-review-warning"><AlertTriangle /> Conseguimos ler parte do print. Confira os campos preenchidos e complete manualmente o que faltar.</p><dl><div><dt>Banco</dt><dd>{printExtraction.data.bankName || (selectedInstitution ? `${selectedInstitution.name}, vindo do formulário` : "Não identificado")}</dd></div><div><dt>Cartão</dt><dd>{[printExtraction.data.cardName, printExtraction.data.cardLastDigits && `final ${printExtraction.data.cardLastDigits}`].filter(Boolean).join(" · ") || (selectedCard ? `${selectedCard.label}, vindo do formulário` : "Não identificado")}</dd></div><div><dt>Competência</dt><dd>{formatCompetency(printExtraction.data.competencyMonth) || "Não identificada"}</dd></div><div><dt>Vencimento</dt><dd>{printExtraction.data.dueDate ? formatDate(printExtraction.data.dueDate) : "Não identificado"}</dd></div><div><dt>Valor da fatura</dt><dd>{printExtraction.data.invoiceTotal == null ? "Não identificado" : formatCurrency(printExtraction.data.invoiceTotal)}</dd></div><div><dt>Cotação</dt><dd>{printExtraction.data.exchangeRate == null ? "Não identificada" : formatCurrency(printExtraction.data.exchangeRate)}</dd></div><div><dt>Programa</dt><dd>{printExtraction.data.loyaltyProgramName || (selectedProgram ? `${selectedProgram.name}, vindo do formulário` : "Não identificado")}</dd></div><div><dt>Pontos recebidos</dt><dd>{printExtraction.data.actualReceivedPoints == null ? "Não identificados" : formatPoints(printExtraction.data.actualReceivedPoints)}</dd></div></dl>{printExtraction.warnings.length > 0 && <ul>{printExtraction.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}<details className="invoice-ocr-raw"><summary>Texto lido do print</summary><pre>{printExtraction.rawText || "Nenhum texto identificado."}</pre></details><div className="invoice-extraction-actions"><button type="button" className="secondary-button" onClick={() => setPrintExtraction(null)}><X /> Descartar leitura</button><button type="button" className="primary-button" onClick={useExtractedData}><ScanLine /> Usar dados</button></div></section></div>}
      {importNotices.length > 0 && <div className="invoice-import-applied" role="status"><AlertTriangle /><div><strong>Confira os dados antes de salvar</strong><span>Conseguimos ler parte do print. Confira os campos preenchidos e complete manualmente o que faltar.</span>{importNotices.map((notice) => <small key={notice}>{notice}</small>)}</div></div>}
      <div className="invoice-entry-layout">
        <div className="invoice-form-sections">
          <section className="invoice-form-block"><header><span>01</span><div><h3>Cliente e cartão</h3><p>Defina para quem e para qual cartão esta fatura pertence.</p></div></header><div className="form-grid">
            <label className="field-full">Cliente<ClientSelect clients={clientOptions} value={form.clientId} onChange={(clientId) => { setForm((current) => ({ ...current, clientId, cardId: current.clientId === clientId ? current.cardId : "", institutionId: current.clientId === clientId ? current.institutionId : "", loyaltyProgramId: current.clientId === clientId ? current.loyaltyProgramId : "" })); if (clientId !== form.clientId) { setPrintExtraction(null); setImportNotices([]); } }} /></label>
            <label>Banco ou instituição<select required value={form.institutionId} onChange={(event) => setForm((current) => ({ ...current, institutionId: event.target.value }))}><option value="">Selecione</option>{institutions.map((item) => <option key={item.institutionId} value={item.institutionId}>{item.name}</option>)}</select></label>
            <label>Tipo da conta<select required value={form.accountPersonType} onChange={(event) => setForm((current) => ({ ...current, accountPersonType: event.target.value as "PF" | "PJ" }))}><option value="PF">Pessoa Física (PF)</option><option value="PJ">Pessoa Jurídica (PJ)</option></select></label>
            <label className="field-full">Cartão associado<select required value={form.cardId} disabled={!form.clientId} onChange={(event) => chooseCard(event.target.value)}><option value="">Selecione o cartão</option>{cards.map((item) => <option key={item.cardId} value={item.cardId}>{item.label}{item.institutionId === form.institutionId ? " · mesmo banco" : ""}</option>)}</select></label>
            {selectedCard?.requiresReview && <div className="catalog-contract-warning field-full"><AlertTriangle /><div><strong>Revisão contratual necessária</strong><span>A previsão ficará pendente se a taxa real do cartão ainda não estiver confirmada.</span></div></div>}
          </div></section>
          <section className="invoice-form-block"><header><span>02</span><div><h3>Fatura</h3><p>Informe o total e a cotação considerada pelo banco.</p></div></header><div className="form-grid">
            <label>Competência<input type="month" required value={form.statementMonth} onChange={(event) => setForm((current) => ({ ...current, statementMonth: event.target.value }))} /></label>
            <label>Vencimento <small>opcional</small><input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} /></label>
            <label>Valor total da fatura<input inputMode="decimal" required placeholder="20.000,00" value={form.totalAmount} onChange={(event) => setForm((current) => ({ ...current, totalAmount: event.target.value }))} onBlur={() => setForm((current) => ({ ...current, totalAmount: formatDecimalInput(current.totalAmount) }))} /></label>
            <label>Cotação do dólar usada<input inputMode="decimal" required placeholder="5,50" value={form.fxRate} onChange={(event) => setForm((current) => ({ ...current, fxRate: event.target.value }))} onBlur={() => setForm((current) => ({ ...current, fxRate: formatDecimalInput(current.fxRate) }))} /><small>Use a cotação do dólar considerada pelo banco na fatura.</small></label>
            <label>Data da cotação<input type="date" required value={form.fxRateDate} onChange={(event) => setForm((current) => ({ ...current, fxRateDate: event.target.value }))} /></label>
            {suspiciousExchangeRate && <div className="invoice-rate-warning field-full" role="alert"><AlertTriangle /><span>Confira a cotação. O valor informado parece fora do padrão.</span></div>}
            {unusuallyLargeInvoice && <div className="invoice-rate-warning invoice-strong-warning field-full" role="alert"><AlertTriangle /><span>Confira o valor da fatura. O valor parece muito alto.</span></div>}
          </div></section>
          <section className="invoice-form-block"><header><span>03</span><div><h3>Pontuação</h3><p>Escolha o destino dos pontos e registre o valor recebido, quando houver.</p></div></header><div className="form-grid">
            <label className="field-full">Programa que receberá os pontos<select required value={form.loyaltyProgramId} onChange={(event) => setForm((current) => ({ ...current, loyaltyProgramId: event.target.value }))}><option value="">Selecione o programa</option>{programs.map((program) => <option key={program.programId} value={program.programId}>{program.name}</option>)}</select><small>Escolha onde os pontos desta fatura devem cair.</small></label>
            <label className="field-full">Pontos efetivamente recebidos <small>opcional</small><input inputMode="numeric" value={form.pointsReceived} onChange={(event) => setForm((current) => ({ ...current, pointsReceived: event.target.value }))} /></label>
            <label className="field-full">Observação<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
            {unusuallyLargePoints && <div className="invoice-rate-warning invoice-strong-warning field-full" role="alert"><AlertTriangle /><span>Alerta: a previsão ultrapassa 1.000.000 de pontos. Confira a regra e a cotação.</span></div>}
          </div></section>
        </div>
        <aside className={`invoice-prediction-panel invoice-live-preview ${preview.estimatedPoints != null ? "ready" : "pending"}`}><div className="invoice-preview-heading"><Calculator /><div><span>Cálculo em tempo real</span><h3>Prévia dos pontos</h3></div></div><dl><div><dt>Cartão</dt><dd>{selectedCard?.label || "Selecione um cartão"}</dd></div><div><dt>Regra</dt><dd>{selectedCard?.earningType === "usd" || selectedCard?.basis === "usd" ? `${selectedCard?.pointsPerUsd ?? "—"} pontos por dólar` : `${selectedCard?.pointsPerBrl ?? "—"} pontos por real`}</dd></div><div><dt>Valor da fatura</dt><dd>{optionalMoney(form.totalAmount) == null ? "—" : formatCurrency(optionalMoney(form.totalAmount) ?? 0)}</dd></div><div><dt>Cotação</dt><dd>{exchangeRate == null ? "—" : formatCurrency(exchangeRate)}</dd></div><div><dt>Base estimada</dt><dd>{preview.convertedUsd == null ? "—" : `US$ ${preview.convertedUsd.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd></div><div className="invoice-preview-emphasis"><dt>Pontos estimados</dt><dd>{preview.estimatedPoints == null ? "—" : formatPoints(preview.estimatedPoints)}</dd></div><div><dt>Programa</dt><dd>{selectedProgram?.name || selectedCard?.programName || "—"}</dd></div><div className="invoice-preview-value"><dt>Valor aproximado dos pontos</dt><dd>{preview.estimatedPoints != null && preview.estimatedPointsValue == null ? "Milheiro não configurado" : preview.estimatedPointsValue == null ? "—" : formatCurrency(preview.estimatedPointsValue)}</dd></div></dl>{preview.pointsDifference != null && <p className={`invoice-points-difference ${preview.pointsDifference === 0 ? "neutral" : preview.pointsDifference > 0 ? "positive" : "negative"}`}>Diferença: {preview.pointsDifference > 0 ? "+" : ""}{formatPoints(preview.pointsDifference)} pontos</p>}</aside>
      </div>
      {save.isError && <div className="form-error">{save.error.message}</div>}{save.isSuccess && <div className="form-success">Fatura salva. {save.data.warning || predictionCopy[save.data.predictionStatus]}</div>}
      <div className="dialog-actions invoice-submit-actions">{form.statementId && <button type="button" className="secondary-button" onClick={() => { setForm(emptyForm()); save.reset(); }}>Cancelar edição</button>}<button className="primary-button" disabled={save.isPending || !form.clientId || !form.institutionId || !form.cardId || !form.statementMonth || !form.totalAmount || !form.fxRate || !form.fxRateDate || !form.loyaltyProgramId}><Save /> Calcular e salvar fatura</button></div>
    </form>}
    <section className="data-section invoice-recent-section"><div className="section-heading"><div><span className="eyebrow">Histórico administrativo</span><h2>Lançamentos recentes</h2></div>{options.data && <div className="data-filters"><ClientSelect clients={clientOptions} value={filterClient} onChange={setFilterClient} /><select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="all">Todas as situações</option><option value="pending_card">Sem cartão</option><option value="pending_breakdown">Aguardando detalhamento</option><option value="calculated">Calculadas</option><option value="confirmed">Confirmadas</option></select></div>}</div>
      {statements.isLoading && <LoadingState />}{statements.isError && <ErrorState message={statements.error.message} retry={() => void statements.refetch()} />}{statements.data && items.length === 0 && <EmptyState title="Nenhuma fatura" description="Registre a primeira fatura; o cartão pode ser associado mais tarde." />}
      {items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Competência</th><th>Banco / conta</th><th>Cartão</th><th>Valor</th><th>Previstos</th><th>Valor estimado</th><th>Recebidos</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <tr key={item.statementId}><td><strong>{item.clientName}</strong></td><td>{formatDate(item.statementMonth)}<small>{item.invoiceLabel || `Fatura ${item.invoiceSequence || 1}`}</small></td><td><strong>{item.institutionName || "Vínculo pendente"}</strong><small>{item.accountPersonType || "—"}</small></td><td>{item.cardLabel ? <><strong>{item.cardLabel}</strong><small>{item.programName || item.calculationVersion || "legado"}</small></> : <span className="invoice-pending-copy">Associe um cartão</span>}</td><td>{formatCurrency(item.totalSpend)}</td><td>{item.predictedPoints == null ? "—" : formatPoints(item.predictedPoints)}</td><td>{item.estimatedPointsValue == null ? "—" : formatCurrency(item.estimatedPointsValue)}</td><td>{item.receivedPoints == null ? "—" : formatPoints(item.receivedPoints)}</td><td><StatusBadge status={item.predictionStatus} /></td><td><div className="invoice-row-actions"><button className="table-action" title="Ver detalhes" onClick={() => window.alert(JSON.stringify(item.ruleSnapshot || {}, null, 2))}><ExternalLink /> Detalhes</button><button className="table-action" onClick={() => edit(item)}><Pencil /> Editar</button><button className="table-action" onClick={() => edit(item)}><CreditCard /> {item.cardId ? "Trocar cartão" : "Associar cartão"}</button><button className="table-action" disabled={!item.cardId || recalculate.isPending} onClick={() => recalculate.mutate(item.statementId)}><RefreshCw /> Recalcular</button><button className="table-action" onClick={() => edit(item)}><WalletCards /> Registrar pontos</button><button className="table-action danger" disabled={deleteInvoice.isPending} onClick={() => requestDelete(item)}><Trash2 /> Excluir</button></div></td></tr>)}</tbody></table></div>}
      {recalculate.isError && <div className="form-error">{recalculate.error.message}</div>}{recalculate.isSuccess && <div className="form-success">Previsão recalculada sem criar lançamentos de pontos.</div>}
      {deleteInvoice.isError && <div className="form-error">{deleteInvoice.error.message}</div>}{deleteNotice && <div className="form-success contract-toast" role="status">{deleteNotice}</div>}
    </section>
    <section className="invoice-secondary-modules" aria-label="Importação e reconciliação"><article><ReceiptText /><div><span>Etapa 5</span><h2>Importação de faturas</h2><p>O fluxo de importação permanece disponível depois dos lançamentos manuais.</p></div><a className="secondary-button" href="/admin/importacoes">Abrir importações</a></article><article><WalletCards /><div><span>Etapa 6</span><h2>Reconciliação de cashback</h2><p>A reconciliação continua isolada da criação e da listagem de faturas.</p></div><a className="secondary-button" href="/admin/viagens-e-economia">Abrir reconciliação</a></article></section>
  </AppShell>;
}
