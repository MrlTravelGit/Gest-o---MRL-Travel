import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseZap, Link2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "@/lib/formatters";
import { commitIddasSavingsImport, getIddasSavingsImport, prepareIddasSavingsImport, resolveIddasSavingsRow } from "@/services/travel-economy";

export function IddasSavingsImportPanel() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["iddas-savings-import"], queryFn: getIddasSavingsImport });
  const [choices, setChoices] = useState<Record<string, { clientId: string; reason: string }>>({});
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["iddas-savings-import"] }), qc.invalidateQueries({ queryKey: ["travel-sales"] }), qc.invalidateQueries({ queryKey: ["admin-overview"] })]);
  const prepare = useMutation({ mutationFn: prepareIddasSavingsImport, onSuccess: refresh });
  const resolve = useMutation({ mutationFn: ({ rowId, clientId, reason }: { rowId: string; clientId: string; reason: string }) => resolveIddasSavingsRow(rowId, clientId, reason), onSuccess: refresh });
  const commit = useMutation({ mutationFn: (batchId: string) => commitIddasSavingsImport(batchId), onSuccess: refresh });
  const state = query.data;
  if (query.isLoading) return <section className="module-form"><div className="panel-state">Carregando conciliação Iddas...</div></section>;
  if (query.isError) return <section className="module-form"><div className="form-error">{query.error.message}</div></section>;
  if (!state) return null;
  const pending = state.rows.filter((row) => row.status === "pending" || row.status === "conflict");
  return <section className="module-form iddas-import-panel">
    <div className="form-title"><DatabaseZap/><div><h2>Importação das economias Iddas</h2><p>Conciliação exata e auditável. Nenhum vínculo é criado por similaridade de nome.</p></div></div>
    <div className="iddas-source-totals"><article><span>Linhas da fonte</span><strong>{state.sourceSummary.rows}</strong></article><article><span>Valor original</span><strong>{formatCurrency(state.sourceSummary.originalValue)}</strong></article><article><span>Valor pago</span><strong>{formatCurrency(state.sourceSummary.paidValue)}</strong></article><article><span>Economia</span><strong>{formatCurrency(state.sourceSummary.savingsValue)}</strong></article></div>
    <div className="reconciliation-rail"><span>{state.counts.ready} prontas</span><span>{state.counts.committed} aplicadas</span><span>{state.counts.pending} pendentes</span><span>{state.counts.conflict} conflitos</span></div>
    {!state.batch && <button className="primary-button" disabled={!state.canManage || prepare.isPending} onClick={() => prepare.mutate()}><ShieldCheck size={16}/>{prepare.isPending ? "Preparando..." : "Preparar lote de 68 linhas"}</button>}
    {pending.length > 0 && <div className="iddas-pending-list">{pending.map((row) => {
      const key = row.rowId ?? row.externalKey; const choice = choices[key] ?? { clientId: "", reason: "" };
      return <article key={row.externalKey}><div><span>Linha {row.sourceRowNumber} · {row.legacyPersonId ?? "sem ID"}</span><strong>{row.legacyName}</strong><small>{row.reason ?? row.issueCode ?? "Revisão necessária"}</small></div>{row.rowId && row.status === "pending" && <div className="iddas-resolution"><select aria-label={`Cliente para ${row.legacyName}`} value={choice.clientId} onChange={(e) => setChoices((old) => ({ ...old, [key]: { ...choice, clientId: e.target.value } }))}><option value="">Selecione explicitamente</option>{state.clientOptions.map((client) => <option key={client.clientId} value={client.clientId}>{client.fullName} · {client.status}</option>)}</select><input aria-label={`Justificativa para ${row.legacyName}`} placeholder="Justificativa do vínculo" value={choice.reason} onChange={(e) => setChoices((old) => ({ ...old, [key]: { ...choice, reason: e.target.value } }))}/><button className="secondary-button" disabled={!choice.clientId || choice.reason.trim().length < 5 || resolve.isPending} onClick={() => resolve.mutate({ rowId: row.rowId!, ...choice })}><Link2 size={15}/> Vincular</button></div>}</article>;
    })}</div>}
    {state.batch && <div className="iddas-commit-bar"><div><span>Aplicado</span><strong>{state.appliedSummary.rows} registros · {formatCurrency(state.appliedSummary.savingsValue)}</strong></div><button className="primary-button" disabled={!state.canManage || state.counts.ready === 0 || commit.isPending} onClick={() => { if (window.confirm(`Aplicar ${state.counts.ready} linhas conciliadas?`)) commit.mutate(state.batch!.batchId); }}>{commit.isPending ? "Aplicando..." : "Aplicar linhas conciliadas"}</button></div>}
    {(prepare.isError || resolve.isError || commit.isError) && <div className="form-error">{prepare.error?.message ?? resolve.error?.message ?? commit.error?.message}</div>}
  </section>;
}
