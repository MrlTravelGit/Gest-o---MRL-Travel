import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, ImagePlus, Paperclip, PlaneTakeoff, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ClientSelect, ProgramAccountSelect, StatusBadge } from "@/components/admin/AdminFields";
import { IddasSavingsImportPanel } from "@/components/admin/IddasSavingsImportPanel";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { parsePointsPtBr } from "@/lib/admin-inputs";
import { calculateCashbackPreview, calculateSavingsPreview, normalizeMoneyDecimal, normalizePercentageDecimal } from "@/lib/cashback";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { buildInsufficientPointsMessage } from "@/lib/friendly-errors";
import { getAdminFormOptions } from "@/services/admin-options";
import { applyCashbackPaidAmountReconciliation, getAdminSavingEvidenceUrl, getClientCashback, getTravelSales, previewCashbackPaidAmountReconciliation, recordTravelSale, SAVINGS_EVIDENCE_MAX_BYTES, uploadSavingEvidence } from "@/services/travel-economy";

const today = new Date().toISOString().slice(0, 10);
const numeric = z.string().refine((value) => { try { return Number(normalizeMoneyDecimal(value)) >= 0; } catch { return false; } }, "Informe um valor válido com até duas casas decimais");
const schema = z.object({ clientId: z.string().uuid("Selecione o cliente"), launchedOn: z.string().min(1).refine((value) => value <= today, "A data não pode estar no futuro"), paymentMode: z.enum(["cash", "miles"]), travelType: z.enum(["flight", "hotel", "other"]), details: z.string().trim().min(3, "Descreva a viagem"), originalValue: numeric, paidValue: numeric, accountId: z.string(), pointsUsed: z.string(), cashbackPercentage: z.string().refine((value) => !value.trim() || (() => { try { const parsed = Number(normalizePercentageDecimal(value)); return parsed > 0 && parsed <= 100; } catch { return false; } })(), "Use um percentual maior que zero e de até 100") }).refine((value) => value.paymentMode !== "miles" || (Boolean(value.accountId) && (() => { try { return parsePointsPtBr(value.pointsUsed) > 0; } catch { return false; } })()), { path: ["pointsUsed"], message: "Informe conta e pontos utilizados" });
type FormData = z.infer<typeof schema>;

export function AdminTravelEconomyPage() {
  const [params] = useSearchParams();
  const initialClient = params.get("clientId") ?? "";
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const [filterClient, setFilterClient] = useState(initialClient);
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [filterType, setFilterType] = useState<"" | "flight" | "hotel" | "other">("");
  const [filterCashback, setFilterCashback] = useState<"" | "yes" | "no">("");
  const [filterStatus, setFilterStatus] = useState<"active" | "voided" | "all">("active");
  const [offset, setOffset] = useState(0);
  const [evidence, setEvidence] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const evidencePreview = useMemo(() => evidence ? URL.createObjectURL(evidence) : "", [evidence]);
  useEffect(() => () => { if (evidencePreview) URL.revokeObjectURL(evidencePreview); }, [evidencePreview]);

  const sales = useQuery({ queryKey: ["travel-sales", filterClient, filterStart, filterEnd, filterType, filterCashback, filterStatus, offset], queryFn: () => getTravelSales({ clientId: filterClient || undefined, startDate: filterStart || undefined, endDate: filterEnd || undefined, travelType: filterType || undefined, hasCashback: filterCashback ? filterCashback === "yes" : undefined, status: filterStatus, offset }) });
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { clientId: initialClient, launchedOn: today, paymentMode: "cash", travelType: "flight", details: "", originalValue: "", paidValue: "", accountId: "", pointsUsed: "", cashbackPercentage: "" } });
  const clientId = form.watch("clientId");
  const paymentMode = form.watch("paymentMode");
  const client = options.data?.clients.find((item) => item.clientId === clientId);
  const accountId = form.watch("accountId");
  const pointsInput = form.watch("pointsUsed");
  const selectedAccount = client?.accounts.find((account) => account.accountId === accountId);
  const requestedPoints = safePoints(pointsInput);
  const hasInsufficientPoints = paymentMode === "miles" && Boolean(selectedAccount) && requestedPoints > Number(selectedAccount?.balance ?? 0);
  const cashback = useQuery({ queryKey: ["client-cashback", clientId], queryFn: () => getClientCashback(clientId), enabled: Boolean(clientId) });
  useEffect(() => { form.setValue("cashbackPercentage", cashback.data?.config.enabled && cashback.data.config.defaultPercentage ? String(cashback.data.config.defaultPercentage).replace(".", ",") : ""); }, [cashback.data?.config.defaultPercentage, cashback.data?.config.enabled, clientId, form]);
  const savings = useMemo(() => { try { return calculateSavingsPreview(form.watch("originalValue"), form.watch("paidValue")); } catch { return 0; } }, [form.watch("originalValue"), form.watch("paidValue")]);
  const estimatedCashback = useMemo(() => { const percentage = form.watch("cashbackPercentage"); try { return cashback.data?.config.enabled && percentage.trim() ? calculateCashbackPreview(form.watch("paidValue"), percentage) : 0; } catch { return 0; } }, [cashback.data?.config.enabled, form.watch("cashbackPercentage"), form.watch("paidValue")]);
  const mutation = useMutation({
    mutationFn: async (value: FormData) => {
      const mutationClient = options.data?.clients.find((item) => item.clientId === value.clientId);
      const mutationAccount = mutationClient?.accounts.find((account) => account.accountId === value.accountId);
      const result = await recordTravelSale({ clientId: value.clientId, launchedOn: value.launchedOn, paymentMode: value.paymentMode, travelType: value.travelType, details: value.details, originalValue: normalizeMoneyDecimal(value.originalValue), paidValue: normalizeMoneyDecimal(value.paidValue), accountId: value.paymentMode === "miles" ? value.accountId : undefined, pointsUsed: value.paymentMode === "miles" ? parsePointsPtBr(value.pointsUsed) : undefined, operationId, cashbackPercentage: cashback.data?.config.enabled && value.cashbackPercentage.trim() ? normalizePercentageDecimal(value.cashbackPercentage) : null, programName: mutationAccount?.programName, availablePoints: mutationAccount?.balance, clientName: mutationClient?.fullName });
      if (evidence) await uploadSavingEvidence(String((result as { saleId: string }).saleId), evidence);
      return result as { saleId: string; savingsAmount: number; cashbackAmount: number; idempotentReplay: boolean };
    },
    onSuccess: () => { setFormError(""); setOperationId(crypto.randomUUID()); setEvidence(null); form.reset({ ...form.getValues(), details: "", originalValue: "", paidValue: "", pointsUsed: "", cashbackPercentage: cashback.data?.config.defaultPercentage ? String(cashback.data.config.defaultPercentage).replace(".", ",") : "" }); void Promise.all([queryClient.invalidateQueries({ queryKey: ["travel-sales"] }), queryClient.invalidateQueries({ queryKey: ["client-cashback"] }), queryClient.invalidateQueries({ queryKey: ["admin-overview"] }), queryClient.invalidateQueries({ queryKey: ["admin-form-options"] })]); },
  });

  const submit = (value: FormData) => {
    const account = options.data?.clients.find((item) => item.clientId === value.clientId)?.accounts.find((item) => item.accountId === value.accountId);
    const points = value.paymentMode === "miles" ? safePoints(value.pointsUsed) : 0;
    if (value.paymentMode === "miles" && account && points > Number(account.balance || 0)) {
      const message = buildInsufficientPointsMessage({ programName: account.programName, availablePoints: account.balance, requestedPoints: points, clientName: client?.fullName });
      form.setError("pointsUsed", { type: "validate", message: `Saldo disponível: ${formatPoints(account.balance)} pontos. Use no máximo esse valor.` });
      setFormError(message);
      return;
    }
    setFormError("");
    mutation.mutate(value);
  };
  const clearTravelError = () => { setFormError(""); mutation.reset(); form.clearErrors("pointsUsed"); };

  return <AppShell title="Viagens e Economia" hideHeading>
    <PageHeader eyebrow="Operação comercial" title="Viagens de Clientes / Economia" description="Economia e cashback fecham no backend; o comprovante é opcional e permanece privado." />
    {options.isLoading && <LoadingState />}{options.isError && <ErrorState message={options.error.message} />}
    {options.data && <form className="module-form operation-form cashback-operation-form" onSubmit={form.handleSubmit(submit)}>
      <div className="form-title"><PlaneTakeoff /><div><h2>Novo lançamento</h2><p>A confirmação cria economia, baixa de pontos e crédito de cashback em uma única operação financeira.</p></div></div>
      <div className="form-grid">
        <label>Cliente<ClientSelect clients={options.data.clients} value={clientId} onChange={(value) => { clearTravelError(); form.setValue("clientId", value, { shouldValidate: true }); form.setValue("accountId", ""); }} /></label>
        <label>Data<input type="date" max={today} {...form.register("launchedOn")} /></label>
        <label>Forma<select {...form.register("paymentMode", { onChange: clearTravelError })}><option value="cash">Dinheiro</option><option value="miles">Milhas</option></select></label>
        <label>Categoria<select {...form.register("travelType")}><option value="flight">Voo</option><option value="hotel">Hotel</option><option value="other">Outro</option></select></label>
        {paymentMode === "miles" && <><label>Programa<ProgramAccountSelect client={client} value={accountId} onChange={(value) => { clearTravelError(); form.setValue("accountId", value, { shouldValidate: true }); }} /></label><label>Pontos utilizados<input inputMode="numeric" placeholder="20.000" aria-invalid={hasInsufficientPoints || Boolean(form.formState.errors.pointsUsed)} aria-describedby="travel-points-help" className={hasInsufficientPoints ? "input-invalid" : undefined} {...form.register("pointsUsed", { onChange: clearTravelError })} />{selectedAccount && !form.formState.errors.pointsUsed && <small id="travel-points-help" className={hasInsufficientPoints ? "field-error" : "field-help"}>Saldo disponível: {formatPoints(selectedAccount.balance)} pontos. Use no máximo esse valor.</small>}{form.formState.errors.pointsUsed && <small id="travel-points-help" className="field-error">{form.formState.errors.pointsUsed.message}</small>}</label></>}
        <label>Valor original<input inputMode="decimal" placeholder="5.000,00" {...form.register("originalValue")} /></label>
        <label>Valor pago<input inputMode="decimal" placeholder="3.200,00" {...form.register("paidValue")} /></label>
        {cashback.data?.config.enabled && <label>Percentual de cashback desta reserva<input inputMode="decimal" placeholder="10,00" {...form.register("cashbackPercentage")} />{form.formState.errors.cashbackPercentage && <small className="field-error">{form.formState.errors.cashbackPercentage.message}</small>}</label>}
        <label className="field-full">Detalhes do voo / viagem<textarea {...form.register("details")} /></label>
      </div>
      <EvidencePicker file={evidence} preview={evidencePreview} onChange={setEvidence} />
      <div className="cashback-confirmation-strip"><div><span>Valor original</span><strong>{safeMoney(form.watch("originalValue"))}</strong></div><div><span>Valor pago pelo cliente</span><strong>{safeMoney(form.watch("paidValue"))}</strong></div><div><span>Economia gerada</span><strong>{formatCurrency(savings)}</strong></div>{cashback.data?.config.enabled && <><div><span>Percentual de cashback</span><strong>{form.watch("cashbackPercentage") || "—"}%</strong></div><div><span>Base do cashback</span><strong>Valor pago · {safeMoney(form.watch("paidValue"))}</strong></div><div className="cashback-highlight"><span>Cashback estimado</span><strong>{formatCurrency(estimatedCashback)}</strong></div></>}</div>
      {(formError || mutation.isError) && <div className="form-error operation-error" role="alert"><AlertTriangle aria-hidden /><div><strong>{formError ? "Saldo insuficiente" : "A viagem não foi registrada"}</strong><span>{formError || mutation.error?.message}</span></div></div>}{mutation.isSuccess && <div className="form-success">Economia confirmada. Cashback oficial sobre o valor pago: {formatCurrency(mutation.data.cashbackAmount ?? 0)}.</div>}
      <button className="primary-button" disabled={!options.data.canWrite || mutation.isPending}>{mutation.isPending ? "Confirmando..." : "Registrar viagem"}</button>
    </form>}
    <section className="data-section"><div className="section-heading"><div><span className="eyebrow">Histórico</span><h2>Lançamentos recentes</h2><p>{sales.data ? `${sales.data.total} registros · ${formatCurrency(sales.data.totalSavings)} de economia · ${formatCurrency(sales.data.totalCashback)} em cashback` : "Dados oficiais"}</p></div></div>
      {options.data && <div className="data-filters"><ClientSelect clients={options.data.clients} value={filterClient} onChange={(value) => { setFilterClient(value); setOffset(0); }} id="travel-filter-client" /><input aria-label="Data inicial" type="date" value={filterStart} onChange={(event) => { setFilterStart(event.target.value); setOffset(0); }} /><input aria-label="Data final" type="date" value={filterEnd} onChange={(event) => { setFilterEnd(event.target.value); setOffset(0); }} /><select aria-label="Filtrar categoria" value={filterType} onChange={(e) => { setFilterType(e.target.value as typeof filterType); setOffset(0); }}><option value="">Todas as categorias</option><option value="flight">Voo</option><option value="hotel">Hotel</option><option value="other">Outro</option></select><select aria-label="Filtrar cashback" value={filterCashback} onChange={(e) => { setFilterCashback(e.target.value as typeof filterCashback); setOffset(0); }}><option value="">Com e sem cashback</option><option value="yes">Com cashback</option><option value="no">Sem cashback</option></select><select aria-label="Filtrar situação" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value as typeof filterStatus); setOffset(0); }}><option value="active">Operações ativas</option><option value="voided">Operações anuladas</option><option value="all">Todas as operações</option></select></div>}
      {sales.isLoading && <LoadingState />}{sales.isError && <ErrorState message={sales.error.message} retry={() => void sales.refetch()} />}{sales.data?.items.length === 0 && <EmptyState title="Nenhuma viagem registrada" description="Use o formulário para criar o primeiro lançamento." />}
      {sales.data && sales.data.items.length > 0 && <><div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Data</th><th>Situação</th><th>Forma</th><th>Valores</th><th>Economia</th><th>Cashback</th><th>Comprovante</th><th>Detalhes</th></tr></thead><tbody>{sales.data.items.map((item) => <tr key={item.id} className={item.status==="voided" ? "saving-voided" : ""}><td><strong>{item.clientName}</strong>{item.programName && <small>{item.programName} · {formatPoints(item.pointsUsed ?? 0)} pts</small>}</td><td>{formatDate(item.launchedOn)}</td><td><StatusBadge status={item.status}/>{item.voidReason && <small>{item.voidReason}</small>}</td><td><StatusBadge status={item.paymentMode} /></td><td><strong>{formatCurrency(item.originalValue)}</strong><small>Pago {formatCurrency(item.paidValue)}</small></td><td className={item.savingsAmount < 0 ? "value-negative" : "value-positive"}>{formatCurrency(item.savingsAmount)}</td><td><strong>{formatCurrency(item.cashbackAmount)}</strong><small>{item.cashbackPercentage ? `${item.cashbackPercentage}% sobre ${formatCurrency(item.cashbackBaseAmount ?? item.paidValue)}` : "Sem cashback"}</small></td><td>{item.hasEvidence ? <button className="table-action" onClick={async () => { const view = await getAdminSavingEvidenceUrl(item.id); window.open(view.url, "_blank", "noopener,noreferrer"); }}><Eye size={14}/> Ver</button> : <span className="muted-cell">—</span>}</td><td className="table-notes">{item.details}</td></tr>)}</tbody></table></div><Pagination offset={offset} total={sales.data.total} pending={sales.isFetching} setOffset={setOffset} /></>}
    </section>
    <IddasSavingsImportPanel />
    <CashbackFormulaReconciliationPanel />
  </AppShell>;
}

function CashbackFormulaReconciliationPanel() {
  const queryClient = useQueryClient();
  const preview = useQuery({ queryKey: ["cashback-formula-reconciliation", "paid_amount_v1"], queryFn: previewCashbackPaidAmountReconciliation });
  const apply = useMutation({
    mutationFn: async () => {
      if (!preview.data) throw new Error("Atualize a prévia antes de aplicar.");
      const message = `Aplicar o Patch 024 em ${preview.data.candidateCount} economia(s)?\n\nEstornos e novos créditos: ${preview.data.replaceCount}\nAjustes por cashback utilizado: ${preview.data.adjustmentCount}\nRevisão manual: ${preview.data.reviewCount}\nDiferença líquida: ${formatCurrency(preview.data.totals.difference)}`;
      if (!window.confirm(message)) throw new Error("Reconciliação cancelada.");
      return applyCashbackPaidAmountReconciliation(preview.data.confirmationKey);
    },
    onSuccess: async () => {
      await Promise.all([
        preview.refetch(),
        queryClient.invalidateQueries({ queryKey: ["travel-sales"] }),
        queryClient.invalidateQueries({ queryKey: ["client-cashback"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
      ]);
    },
  });

  if (preview.isLoading) return <section className="module-form cashback-reconciliation-panel"><div className="panel-state">Preparando prévia auditável do Patch 024...</div></section>;
  if (preview.isError) return <section className="module-form cashback-reconciliation-panel"><div className="form-error">{preview.error.message}</div><button className="secondary-button" onClick={() => void preview.refetch()}><RefreshCw size={15}/> Tentar novamente</button></section>;
  if (!preview.data) return null;
  const data = preview.data;

  return <section className="module-form cashback-reconciliation-panel">
    <div className="form-title"><ShieldCheck/><div><h2>Reconciliação do cashback · Patch 024</h2><p>Prévia somente leitura. Nenhuma movimentação é apagada ou sobrescrita.</p></div></div>
    <div className="cashback-ledger-summary"><Summary label="Créditos encontrados" value={String(data.candidateCount)}/><Summary label="Cashback anterior" value={formatCurrency(data.totals.previousCashback)}/><Summary label="Cashback correto" value={formatCurrency(data.totals.correctCashback)} highlight/><Summary label="Diferença líquida" value={formatCurrency(data.totals.difference)}/></div>
    <div className="reconciliation-invariants"><span>Preservação comprovada na prévia</span><strong>{data.preserved.legacySavingsCount} economias · {formatCurrency(data.preserved.legacySavingsTotal)} · {formatPoints(data.preserved.pointsTotal)} pontos</strong></div>
    {data.reviewCount > 0 && <div className="dashboard-alert"><AlertTriangle size={18}/><span>{data.reviewCount} linha(s) ficarão bloqueadas para revisão administrativa; as demais serão processadas normalmente.</span></div>}
    {data.items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Base anterior</th><th>Base correta</th><th>Percentual</th><th>Anterior</th><th>Correto</th><th>Ação</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.reconciliationKey}><td><strong>{item.clientName}</strong><small>{item.description}</small></td><td>{formatCurrency(item.savingsAmount)}</td><td>{formatCurrency(item.paidAmount)}</td><td>{item.cashbackPercentage}%</td><td>{formatCurrency(item.previousCashbackAmount)}</td><td><strong>{formatCurrency(item.correctCashbackAmount)}</strong><small>{item.differenceAmount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(item.differenceAmount))}</small></td><td><StatusBadge status={item.action}/>{item.allocatedAmount > 0 && <small>{formatCurrency(item.allocatedAmount)} utilizado</small>}</td></tr>)}</tbody></table></div>}
    {apply.isError && apply.error.message !== "Reconciliação cancelada." && <div className="form-error">{apply.error.message}</div>}
    {apply.isSuccess && <div className="form-success">Lote aplicado: {apply.data.applied} economia(s), {apply.data.newMovements} nova(s) movimentação(ões), {apply.data.review} em revisão. Candidatos restantes: {apply.data.remainingCandidates}.</div>}
    <div className="dialog-actions"><button className="secondary-button" disabled={preview.isFetching || apply.isPending} onClick={() => void preview.refetch()}><RefreshCw size={15}/> Atualizar prévia</button><button className="primary-button" disabled={!data.canApply || data.candidateCount===0 || apply.isPending} onClick={() => apply.mutate()}>{apply.isPending ? "Aplicando..." : `Aplicar ${data.candidateCount} reconciliação(ões)`}</button></div>
  </section>;
}

function Summary({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <article className={highlight ? "highlight" : ""}><span>{label}</span><strong>{value}</strong></article>;
}

function EvidencePicker({ file, preview, onChange }: { file: File | null; preview: string; onChange: (file: File | null) => void }) {
  return <div className="saving-evidence-picker"><div><Paperclip/><span>Comprovante do valor original</span><small>Opcional · PNG, JPEG ou WebP · até {SAVINGS_EVIDENCE_MAX_BYTES / 1024 / 1024} MB</small></div>{file ? <div className="evidence-preview"><img src={preview} alt="Prévia do comprovante"/><span>{file.name}<small>{(file.size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB</small></span><button type="button" aria-label="Remover comprovante" onClick={() => onChange(null)}><X size={16}/></button></div> : <label className="secondary-button"><ImagePlus size={16}/> Selecionar imagem<input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0] ?? null)}/></label>}</div>;
}

function safeMoney(value: string) { try { return formatCurrency(Number(normalizeMoneyDecimal(value))); } catch { return formatCurrency(0); } }
function safePoints(value: string) { try { return parsePointsPtBr(value); } catch { return 0; } }
function Pagination({ offset, total, pending, setOffset }: { offset: number; total: number; pending: boolean; setOffset: (value: number) => void }) { return <div className="pagination-bar"><span>{offset + 1}–{Math.min(offset + 20, total)} de {total}</span><div><button className="secondary-button" disabled={!offset || pending} onClick={() => setOffset(Math.max(0, offset - 20))}>Anterior</button><button className="secondary-button" disabled={offset + 20 >= total || pending} onClick={() => setOffset(offset + 20)}>Próxima</button></div></div>; }
