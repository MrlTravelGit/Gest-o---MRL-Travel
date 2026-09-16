import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, CheckCircle2, Eye, ImagePlus, Pencil, PiggyBank, Plus, ReceiptText, Settings2, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { calculateCashbackPreview, calculateSavingsPreview, normalizeMoneyDecimal, normalizePercentageDecimal } from "@/lib/cashback";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { cancelTravelSaving, deleteTravelSaving, getAdminSavingEvidenceUrl, getClientCashback, getTravelSales, previewTravelSavingVoid, recordCashbackRedemption, removeSavingEvidence, removeTravelSaleFromResult, updateClientCashbackConfig, updateTravelSaving, uploadSavingEvidence } from "@/services/travel-economy";
import type { ClientCashbackState, TravelSale, TravelSalesResult } from "@/types/admin-modules";

export function ClientSavingsPanel({ clientId, canWrite }: { clientId: string; clientName: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"active" | "voided" | "all">("active");
  const query = useQuery({ queryKey: ["travel-sales", clientId, status], queryFn: () => getTravelSales({ clientId, status, limit: 100 }) });
  const cashback = useQuery({ queryKey: ["client-cashback", clientId], queryFn: () => getClientCashback(clientId) });
  const [editing, setEditing] = useState<TravelSale | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [useOpen, setUseOpen] = useState(false);
  const [voiding, setVoiding] = useState<TravelSale | null>(null);
  const [deleting, setDeleting] = useState<TravelSale | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(""), 4_000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["travel-sales"] }), qc.invalidateQueries({ queryKey: ["client-cashback", clientId] }), qc.invalidateQueries({ queryKey: ["admin-client-detail", clientId] }), qc.invalidateQueries({ queryKey: ["admin-clients"] }), qc.invalidateQueries({ queryKey: ["admin-overview"] })]);
  const evidenceUpload = useMutation({ mutationFn: ({ sale, file }: { sale: TravelSale; file: File }) => uploadSavingEvidence(sale.id, file), onSuccess: refresh });
  const evidenceRemove = useMutation({ mutationFn: async (sale: TravelSale) => { const reason = window.prompt("Motivo da remoção do comprovante:"); if (!reason) throw new Error("Remoção cancelada."); if (!window.confirm("Remover o comprovante desta economia?")) throw new Error("Remoção cancelada."); return removeSavingEvidence(sale.id, reason); }, onSuccess: refresh });

  return <section className="module-form client-savings-panel">
    <div className="form-title"><PiggyBank /><div><h2>Economias e cashback</h2><p>Histórico financeiro oficial, comprovantes privados e extrato auditável.</p></div></div>
    {successMessage && <div className="form-success saving-delete-success" role="status"><CheckCircle2 size={16}/> {successMessage}</div>}
    {cashback.data && <><div className="cashback-ledger-summary"><Summary label="Total economizado" value={formatCurrency(query.data?.totalSavings ?? 0)}/><Summary label="Cashback gerado" value={formatCurrency(cashback.data.summary.generated)}/><Summary label="Saldo disponível" value={formatCurrency(cashback.data.summary.available)} highlight/><Summary label="Utilizado / pago" value={`${formatCurrency(cashback.data.summary.used)} / ${formatCurrency(cashback.data.summary.paid)}`}/></div><div className="client-savings-toolbar"><span className={`cashback-state ${cashback.data.config.enabled ? "enabled" : "disabled"}`}>{cashback.data.config.enabled ? "Cashback ativo" : "Cashback desabilitado"}{cashback.data.config.defaultPercentage ? ` · padrão ${cashback.data.config.defaultPercentage}%` : ""}</span><div><button className="secondary-button" disabled={!canWrite} onClick={() => setConfigOpen(true)}><Settings2 size={15}/> Configurar</button><button className="secondary-button" disabled={!canWrite || cashback.data.summary.available <= 0} onClick={() => setUseOpen(true)}><Banknote size={15}/> Registrar uso / pagamento</button><Link className="secondary-button" to={`/admin/viagens?clientId=${clientId}`}><Plus size={15}/> Nova economia</Link></div></div></>}
    <div className="saving-status-filter" aria-label="Filtrar economias por situação">{(["active","voided","all"] as const).map((value) => <button key={value} type="button" className={status===value ? "active" : ""} onClick={() => setStatus(value)}>{value==="active" ? "Ativas" : value==="voided" ? "Anuladas" : "Todas"}</button>)}</div>
    {query.isLoading && <div className="panel-state">Carregando economias...</div>}{query.isError && <div className="form-error">{query.error.message}</div>}{query.data?.items.length === 0 && <div className="panel-state">Nenhuma economia registrada.</div>}
    <div className="client-savings-list">{query.data?.items.map((sale) => <article key={sale.id} className={sale.status==="voided" ? "saving-voided" : ""}>
      <div><span>{formatDate(sale.launchedOn)} {sale.migrated && <em>Histórico migrado</em>} {sale.status==="voided" && <em className="voided-label">Operação anulada</em>}</span><strong>{sale.details}</strong><small>Original {formatCurrency(sale.originalValue)} · pago {formatCurrency(sale.paidValue)} · economia {formatCurrency(sale.savingsAmount)}</small><small>{sale.cashbackPercentage ? `Cashback de ${sale.cashbackPercentage}% sobre ${formatCurrency(sale.cashbackBaseAmount ?? sale.paidValue)}: ${formatCurrency(sale.cashbackAmount)}` : "Cashback não aplicado"}</small>{sale.voidReason && <small>Motivo: {sale.voidReason}</small>}</div>
      <b>{formatCurrency(sale.cashbackAmount)}</b>
      <div className="row-actions">{sale.hasEvidence && <button className="icon-button" aria-label="Visualizar comprovante" onClick={async () => { const view = await getAdminSavingEvidenceUrl(sale.id); window.open(view.url, "_blank", "noopener,noreferrer"); }}><Eye size={15}/></button>}{canWrite && sale.status==="active" && <label className="icon-button" aria-label={sale.hasEvidence ? "Substituir comprovante" : "Adicionar comprovante"}><ImagePlus size={15}/><input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) evidenceUpload.mutate({ sale, file }); event.currentTarget.value = ""; }}/></label>}{canWrite && sale.status==="active" && sale.hasEvidence && <button className="icon-button danger-button" aria-label="Remover comprovante" onClick={() => evidenceRemove.mutate(sale)}><ReceiptText size={15}/></button>}{canWrite && sale.status==="active" && sale.paymentMode === "cash" && <><button className="icon-button" aria-label="Editar economia" onClick={() => setEditing(sale)}><Pencil size={15}/></button><button className="icon-button danger-button" aria-label="Anular operação" onClick={() => setVoiding(sale)}><Ban size={15}/></button><button className="icon-button danger-button" aria-label="Excluir economia" onClick={() => setDeleting(sale)}><Trash2 size={15}/></button></>}</div>
    </article>)}</div>
    {(evidenceUpload.isError || evidenceRemove.isError) && <div className="form-error">{evidenceUpload.error?.message ?? evidenceRemove.error?.message}</div>}
    {cashback.data && cashback.data.transactions.length > 0 && <div className="cashback-statement"><div className="section-heading"><div><span className="eyebrow">Ledger</span><h3>Extrato de cashback</h3></div></div>{cashback.data.transactions.map((item) => <article key={item.id}><span className={`ledger-type ${item.type}`}>{ledgerLabel(item.type)}</span><div><strong>{item.description}</strong><small>{formatDate(item.createdAt)}</small></div><b className={item.type === "earning" || (item.type === "adjustment" && item.amount > 0) ? "value-positive" : "value-negative"}>{item.type === "earning" || (item.type === "adjustment" && item.amount > 0) ? "+" : "−"}{formatCurrency(Math.abs(item.amount))}</b></article>)}</div>}
    {editing && <EditSavingDialog sale={editing} cashbackEnabled={Boolean(cashback.data?.config.enabled)} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh(); }}/>} 
    {configOpen && cashback.data && <CashbackConfigDialog clientId={clientId} current={cashback.data.config} onClose={() => setConfigOpen(false)} onSaved={async () => { setConfigOpen(false); await refresh(); }}/>} 
    {useOpen && cashback.data && <CashbackUseDialog clientId={clientId} available={cashback.data.summary.available} onClose={() => setUseOpen(false)} onSaved={async () => { setUseOpen(false); await refresh(); }}/>} 
    {voiding && (
      <VoidSavingDialog sale={voiding} onClose={() => setVoiding(null)} onSaved={async () => { setVoiding(null); await refresh(); }}/>
    )}
    {deleting && (
      <DeleteSavingDialog sale={deleting} onClose={() => setDeleting(null)} onDeleted={async () => {
      setDeleting(null);
      setSuccessMessage("Economia excluída. Lista e totais foram atualizados.");
      await refresh();
      }}/>
    )}
  </section>;
}

function DeleteSavingDialog({ sale, onClose, onDeleted }: { sale: TravelSale; onClose: () => void; onDeleted: () => Promise<unknown> }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const preview = useQuery({ queryKey: ["saving-delete-preview", sale.id], queryFn: () => previewTravelSavingVoid(sale.id) });
  const mutation = useMutation({
    mutationFn: () => deleteTravelSaving(sale.id, reason, sale.updatedAt),
    onMutate: async () => {
      await Promise.all([queryClient.cancelQueries({ queryKey: ["travel-sales"] }), queryClient.cancelQueries({ queryKey: ["client-cashback", sale.clientId] })]);
      const salesSnapshots = queryClient.getQueriesData<TravelSalesResult>({ queryKey: ["travel-sales"] });
      const cashbackSnapshot = queryClient.getQueryData<ClientCashbackState>(["client-cashback", sale.clientId]);
      queryClient.setQueriesData<TravelSalesResult>({ queryKey: ["travel-sales"] }, (current) => current ? removeTravelSaleFromResult(current, sale.id) : current);
      queryClient.setQueryData<ClientCashbackState>(["client-cashback", sale.clientId], (current) => current ? { ...current, summary: { ...current.summary, generated: current.summary.generated - sale.cashbackAmount, available: current.summary.available - sale.cashbackAmount } } : current);
      return { salesSnapshots, cashbackSnapshot };
    },
    onError: (_error, _variables, context) => {
      context?.salesSnapshots.forEach(([key, value]) => queryClient.setQueryData(key, value));
      if (context?.cashbackSnapshot) queryClient.setQueryData(["client-cashback", sale.clientId], context.cashbackSnapshot);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData<ClientCashbackState>(["client-cashback", sale.clientId], (current) => current ? { ...current, summary: result.summary } : current);
      await onDeleted();
    },
  });
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Excluir economia"><form className="confirm-modal void-saving-dialog" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><span className="eyebrow">Exclusão auditável</span><h2>Excluir economia</h2><p>O item sairá das listas, totais e painel público. O registro permanecerá no banco somente para auditoria.</p>{preview.isLoading && <div className="panel-state">Calculando impacto financeiro...</div>}{preview.data?.blocked && <div className="form-error">A exclusão está bloqueada: {formatCurrency(preview.data.allocated)} de cashback já foi utilizado ou pago.</div>}{preview.isError && <div className="form-error">{preview.error.message}</div>}<label>Motivo da exclusão<textarea minLength={5} required value={reason} onChange={(event) => setReason(event.target.value)}/></label>{mutation.isError && <div className="form-error">{mutation.error.message}</div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="danger-confirm-button" disabled={mutation.isPending || preview.isLoading || preview.data?.blocked || reason.trim().length<5}>{mutation.isPending ? "Excluindo..." : "Confirmar exclusão"}</button></div></form></div>;
}

function Summary({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) { return <article className={highlight ? "highlight" : ""}><span>{label}</span><strong>{value}</strong></article>; }
function ledgerLabel(type: string) { return ({ earning: "Crédito", redemption: "Utilização", reversal: "Estorno", adjustment: "Ajuste" } as Record<string,string>)[type] ?? type; }

function CashbackConfigDialog({ clientId, current, onClose, onSaved }: { clientId: string; current: { enabled: boolean; defaultPercentage: number | null; updatedAt: string | null; updatedBy: string | null }; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [enabled, setEnabled] = useState(current.enabled); const [percentage, setPercentage] = useState(current.defaultPercentage ? String(current.defaultPercentage) : ""); const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => updateClientCashbackConfig({ clientId, enabled, defaultPercentage: enabled && percentage ? normalizePercentageDecimal(percentage) : null, reason }), onSuccess: onSaved });
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="confirm-modal" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}><h2>Configurar cashback</h2><p>Habilitar não cria créditos retroativos. Desabilitar preserva todo o extrato e o saldo existente.</p><label className="check-field"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}/> Habilitar cashback para novas economias</label>{enabled && <label>Percentual padrão opcional<input type="number" min="0.01" max="100" step="0.01" value={percentage} onChange={(e) => setPercentage(e.target.value)} placeholder="10,00"/></label>}<label>Motivo da alteração<textarea minLength={5} required value={reason} onChange={(e) => setReason(e.target.value)}/></label>{current.updatedAt && <small>Última alteração: {formatDate(current.updatedAt)} · responsável {current.updatedBy ?? "não identificado"}</small>}{mutation.isError && <div className="form-error">{mutation.error.message}</div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={mutation.isPending || reason.trim().length < 5}>{mutation.isPending ? "Salvando..." : "Salvar configuração"}</button></div></form></div>;
}

function CashbackUseDialog({ clientId, available, onClose, onSaved }: { clientId: string; available: number; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [amount, setAmount] = useState(""); const [description, setDescription] = useState(""); const [mode, setMode] = useState<"usage" | "payment">("usage"); const [operationId] = useState(() => crypto.randomUUID());
  const mutation = useMutation({ mutationFn: () => recordCashbackRedemption({ clientId, amount: normalizeMoneyDecimal(amount), description, operationId, mode }), onSuccess: onSaved });
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="confirm-modal" onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}><h2>Registrar utilização ou pagamento</h2><div className="cashback-available-callout"><span>Saldo disponível</span><strong>{formatCurrency(available)}</strong></div><label>Natureza<select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="usage">Utilização / abatimento</option><option value="payment">Pagamento ao cliente</option></select></label><label>Valor<input type="number" min="0.01" max={available} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)}/></label><label>Descrição<textarea minLength={5} required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Pagamento ao cliente, abatimento..."/></label>{mutation.isError && <div className="form-error">{mutation.error.message}</div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={mutation.isPending}>{mutation.isPending ? "Registrando..." : "Confirmar"}</button></div></form></div>;
}

function VoidSavingDialog({ sale, onClose, onSaved }: { sale: TravelSale; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const preview = useQuery({ queryKey: ["saving-void-preview", sale.id], queryFn: () => previewTravelSavingVoid(sale.id) });
  const mutation = useMutation({ mutationFn: () => cancelTravelSaving(sale.id, reason, sale.updatedAt), onSuccess: onSaved });
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Anular operação de economia"><form className="confirm-modal void-saving-dialog" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><span className="eyebrow">Operação administrativa auditada</span><h2>Anular operação</h2><p>A economia e toda a cadeia técnica de cashback deixarão de aparecer no painel público. O razão administrativo será preservado.</p>{preview.isLoading && <div className="panel-state">Calculando impacto financeiro...</div>}{preview.data && <div className="void-impact-grid"><Summary label="Gerado" value={formatCurrency(preview.data.generated)}/><Summary label="Utilizado" value={formatCurrency(preview.data.used)}/><Summary label="Pago" value={formatCurrency(preview.data.paid)}/><Summary label="Disponível" value={formatCurrency(preview.data.available)} highlight/></div>}{preview.data?.blocked && <div className="form-error">A anulação automática está bloqueada: {formatCurrency(preview.data.allocated)} já foi utilizado ou pago. Faça a regularização financeira auditada antes de continuar.</div>}{preview.isError && <div className="form-error">{preview.error.message}</div>}<label>Motivo da anulação<textarea minLength={5} required value={reason} onChange={(event) => setReason(event.target.value)}/></label>{mutation.isError && <div className="form-error">{mutation.error.message}</div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Voltar</button><button className="danger-confirm-button" disabled={mutation.isPending || preview.isLoading || preview.data?.blocked || reason.trim().length<5}>{mutation.isPending ? "Anulando..." : "Confirmar anulação"}</button></div></form></div>;
}

function EditSavingDialog({ sale, cashbackEnabled, onClose, onSaved }: { sale: TravelSale; cashbackEnabled: boolean; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [date, setDate] = useState(sale.launchedOn); const [type, setType] = useState(sale.travelType); const [details, setDetails] = useState(sale.details); const [original, setOriginal] = useState(String(sale.originalValue)); const [paid, setPaid] = useState(String(sale.paidValue)); const [percentage, setPercentage] = useState(sale.cashbackPercentage ? String(sale.cashbackPercentage) : ""); const [reason, setReason] = useState("");
  const savings = useMemo(() => { try { return calculateSavingsPreview(original, paid); } catch { return 0; } }, [original, paid]);
  const estimatedCashback = useMemo(() => { try { return cashbackEnabled && percentage ? calculateCashbackPreview(paid, percentage) : 0; } catch { return 0; } }, [cashbackEnabled, paid, percentage]);
  const mutation = useMutation({ mutationFn: () => updateTravelSaving({ redemptionId: sale.id, launchedOn: date, travelType: type, details, originalValue: normalizeMoneyDecimal(original), paidValue: normalizeMoneyDecimal(paid), cashbackPercentage: cashbackEnabled && percentage ? normalizePercentageDecimal(percentage) : null, reason, expectedUpdatedAt: sale.updatedAt }), onSuccess: onSaved });
  return <div className="modal-backdrop" role="dialog" aria-modal="true"><form className="confirm-modal" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><h2>Editar economia</h2><p>Alterações no valor pago ou percentual estornam o crédito anterior e criam outro. Alterar apenas o valor original não muda o cashback.</p><div className="form-grid"><label>Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required/></label><label>Tipo<select value={type} onChange={(e) => setType(e.target.value as TravelSale["travelType"])}><option value="flight">Voo</option><option value="hotel">Hotel</option><option value="other">Outro</option></select></label><label>Valor original<input type="number" min="0" step="0.01" value={original} onChange={(e) => setOriginal(e.target.value)} required/></label><label>Valor pago pelo cliente<input type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} required/></label>{cashbackEnabled && <label>Percentual de cashback desta reserva<input type="number" min="0.01" max="100" step="0.01" value={percentage} onChange={(e) => setPercentage(e.target.value)}/></label>}<label className="field-full">Descrição<textarea value={details} onChange={(e) => setDetails(e.target.value)} required/></label><label className="field-full">Motivo da alteração<textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required/></label></div><div className="cashback-confirmation-strip"><div><span>Valor original</span><strong>{formatCurrency(Number(normalizeForDisplay(original)))}</strong></div><div><span>Valor pago</span><strong>{formatCurrency(Number(normalizeForDisplay(paid)))}</strong></div><div><span>Economia gerada</span><strong>{formatCurrency(savings)}</strong></div>{cashbackEnabled && <><div><span>Percentual</span><strong>{percentage || "—"}%</strong></div><div><span>Base do cashback</span><strong>Valor pago</strong></div><div className="cashback-highlight"><span>Cashback estimado</span><strong>{formatCurrency(estimatedCashback)}</strong></div></>}</div>{mutation.isError && <div className="form-error">{mutation.error.message}</div>}<div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={mutation.isPending}>{mutation.isPending ? "Salvando..." : "Salvar alteração"}</button></div></form></div>;
}

function normalizeForDisplay(value: string) {
  try { return normalizeMoneyDecimal(value); } catch { return "0.00"; }
}
