import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArchiveRestore, CheckCircle2, Database, Download, FileArchive, FileWarning, Link2, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { getAdminFormOptions } from "@/services/admin-options";
import { commitImportBatch, getImportBatch, listImportBatches, resolveImportRow, rollbackImportBatch, uploadImport } from "@/services/imports";
import type { ImportBatchDetail, ImportPreviewRow } from "@/types/imports";

const entityLabels: Record<string, string> = { client: "Cliente", task: "Demanda", onboarding: "Onboarding", program: "Programa", passage: "Passagem" };

export function AdminImportsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const batches = useQuery({ queryKey: ["import-batches"], queryFn: listImportBatches });
  const detail = useQuery({ queryKey: ["import-batch", selectedId], queryFn: () => getImportBatch(selectedId!), enabled: Boolean(selectedId) });
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const uploadMutation = useMutation({
    mutationFn: uploadImport,
    onSuccess: async (result) => { setSelectedId(result.batchId); setFile(null); await queryClient.invalidateQueries({ queryKey: ["import-batches"] }); },
  });
  const resolveMutation = useMutation({
    mutationFn: ({ rowId, resolution, targetId }: { rowId: string; resolution: string; targetId?: string }) => resolveImportRow(rowId, resolution, targetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["import-batch", selectedId] }),
  });
  const commitMutation = useMutation({
    mutationFn: () => commitImportBatch(selectedId!),
    onSuccess: async () => { setConfirmOpen(false); await Promise.all([queryClient.invalidateQueries({ queryKey: ["import-batch", selectedId] }), queryClient.invalidateQueries({ queryKey: ["import-batches"] }), queryClient.invalidateQueries({ queryKey: ["management-tasks"] }), queryClient.invalidateQueries({ queryKey: ["admin-clients"] })]); },
  });
  const rollbackMutation = useMutation({
    mutationFn: (reason: string) => rollbackImportBatch(selectedId!, reason),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ["import-batch", selectedId] }), queryClient.invalidateQueries({ queryKey: ["import-batches"] })]),
  });
  const visibleRows = useMemo(() => detail.data?.rows.filter((row) => !onlyConflicts || row.resolutionStatus === "pending" || row.validationStatus === "invalid") ?? [], [detail.data, onlyConflicts]);
  const blocking = detail.data?.rows.filter((row) => row.resolutionStatus === "pending" || (["client", "task"].includes(row.entityType) && row.validationStatus === "invalid" && row.resolutionStatus !== "skip")).length ?? 0;

  function submit(event: FormEvent) { event.preventDefault(); if (file) uploadMutation.mutate(file); }

  return <AppShell title="Importações" hideHeading>
    <PageHeader eyebrow="Migração controlada" title="Importações" description="Pré-visualize, resolva conflitos e confirme dados legados sem alterar saldos automaticamente." />
    <section className="import-security-strip"><ShieldCheck /><div><strong>Dry-run obrigatório</strong><span>ZIP e CSV são analisados no backend, em staging privado. Nenhuma linha desta tela já foi gravada nas tabelas oficiais.</span></div></section>
    <div className="imports-layout">
      <aside className="import-batch-sidebar">
        <form className="import-upload-card" onSubmit={submit}><FileArchive /><h2>Novo lote</h2><p>ZIP do Notion ou CSV UTF-8, até 15 MB.</p><label className="file-drop"><Upload /><span>{file?.name ?? "Selecionar arquivo"}</span><input type="file" accept=".zip,.csv,application/zip,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><button className="primary-button" disabled={!file || uploadMutation.isPending}>{uploadMutation.isPending ? "Analisando..." : "Enviar e analisar"}</button>{uploadMutation.isError && <div className="form-error">{uploadMutation.error.message}</div>}{uploadMutation.data?.duplicate && <div className="form-warning">Upload idêntico detectado. Abrimos o lote existente.</div>}</form>
        <div className="batch-history"><div className="section-heading"><h2>Lotes recentes</h2><button aria-label="Atualizar lotes" onClick={() => batches.refetch()}><RefreshCw size={15} /></button></div>{batches.isLoading && <span>Carregando...</span>}{batches.data?.map((batch) => <button key={batch.id} className={selectedId === batch.id ? "active" : ""} onClick={() => setSelectedId(batch.id)}><span className={`batch-status status-${batch.status}`}>{batch.status}</span><strong>{batch.original_filename}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(batch.created_at))}</small></button>)}</div>
      </aside>
      <main className="import-preview-area">
        {!selectedId && <EmptyState title="Selecione ou envie um lote" description="A prévia mostrará contagens canônicas, avisos e decisões pendentes." />}
        {detail.isLoading && <LoadingState label="Carregando staging protegido..." />}
        {detail.isError && <ErrorState message={detail.error.message} retry={() => detail.refetch()} />}
        {detail.data && <>
          <header className="import-batch-header"><div><span className="eyebrow">{detail.data.batch.adapterVersion}</span><h2>{detail.data.batch.originalFilename}</h2><p>Request ID: <code>{detail.data.batch.requestId}</code></p></div><span className={`batch-status status-${detail.data.batch.status}`}>{detail.data.batch.status}</span></header>
          <ImportSummaryCards detail={detail.data} />
          <div className="import-notice"><Database /><p><strong>Nenhum saldo oficial será lançado automaticamente.</strong> Programas, onboarding e passagens permanecem declaratórios até uma revisão específica.</p></div>
          <section className="import-files"><h3>Arquivos reconhecidos</h3><div>{detail.data.files.filter((item) => item.isCanonical || item.ignoredReason === "FILTERED_RELATIONAL_VIEW").map((item) => <article key={item.fileId} className={item.ignoredReason ? "ignored" : "canonical"}><span>{item.logicalType}</span><strong>{item.rowCount} linhas</strong><small>{item.ignoredReason === "FILTERED_RELATIONAL_VIEW" ? "Ignorado: visão relacional duplicada" : "Fonte canônica"}</small></article>)}</div></section>
          <div className="preview-toolbar"><label><input type="checkbox" checked={onlyConflicts} onChange={(event) => setOnlyConflicts(event.target.checked)} /> Mostrar somente conflitos</label><button className="secondary-button" onClick={() => downloadSafeIssues(detail.data)}><Download size={15} /> Baixar CSV de erros</button></div>
          <div className="import-row-table" role="table" aria-label="Prévia das linhas"><div className="import-row-head" role="row"><span>Entidade / linha</span><span>Prévia segura</span><span>Validação</span><span>Decisão</span></div>{visibleRows.map((row) => <ImportRow key={row.rowId} row={row} clients={options.data?.clients ?? []} busy={resolveMutation.isPending} onResolve={(resolution, targetId) => resolveMutation.mutate({ rowId: row.rowId, resolution, targetId })} />)}</div>
          {resolveMutation.isError && <div className="form-error">{resolveMutation.error.message}</div>}
          <footer className="import-commit-bar"><div><strong>{blocking ? `${blocking} decisão(ões) bloqueante(s)` : "Lote pronto para confirmação"}</strong><span>{detail.data.batch.summary.canonical.clients} clientes · {detail.data.batch.summary.canonical.tasks} demandas · {detail.data.batch.summary.taskRelations.needsDecision} demandas originalmente sem cliente</span></div><div>{detail.data.batch.status === "committed" && <button className="secondary-button danger-button" disabled={!detail.data.canManage || rollbackMutation.isPending} onClick={() => { const reason = window.prompt("Motivo para desfazer logicamente este lote:"); if (reason) rollbackMutation.mutate(reason); }}><ArchiveRestore size={15} /> Desfazer lote</button>}<button className="primary-button" disabled={!detail.data.canManage || blocking > 0 || detail.data.batch.status !== "review"} onClick={() => setConfirmOpen(true)}><CheckCircle2 size={15} /> Confirmar importação</button></div></footer>
          {commitMutation.isError && <div className="form-error">{commitMutation.error.message}</div>}{rollbackMutation.isError && <div className="form-error">{rollbackMutation.error.message}</div>}
          {confirmOpen && <CommitDialog detail={detail.data} busy={commitMutation.isPending} onClose={() => setConfirmOpen(false)} onConfirm={() => commitMutation.mutate()} />}
        </>}
      </main>
    </div>
  </AppShell>;
}

function ImportSummaryCards({ detail }: { detail: ImportBatchDetail }) { const summary = detail.batch.summary; const cards = [["Clientes", summary.canonical.clients], ["Demandas", summary.canonical.tasks], ["Programas", summary.canonical.programs], ["Onboardings", summary.canonical.onboardings], ["Passagens", summary.canonical.passages], ["Conflitos", summary.conflicts]]; return <section className="import-summary-grid">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>; }

function ImportRow({ row, clients, busy, onResolve }: { row: ImportPreviewRow; clients: Array<{ clientId: string; fullName: string }>; busy: boolean; onResolve: (resolution: string, targetId?: string) => void }) {
  const [target, setTarget] = useState(row.targetId ?? ""); const title = row.preview.title || row.preview.fullName || row.preview.programName || "Registro sem título"; const pending = row.resolutionStatus === "pending";
  return <div className={`import-row validation-${row.validationStatus}`} role="row"><div><span className="entity-pill">{entityLabels[row.entityType]}</span><small>Linha {row.rowNumber}</small></div><div><strong>{title}</strong><span>{row.preview.clientLabel || row.preview.status || "—"}</span>{row.issues.slice(0, 2).map((issue) => <small key={`${issue.code}-${issue.fieldName}`} className={`issue-${issue.severity}`}>{issue.code}: {issue.message}</small>)}</div><div><span className={`validation-pill ${row.validationStatus}`}>{row.validationStatus}</span><small>{row.sourceExternalId ? `Page ID •••${row.sourceExternalId.slice(-6)}` : "Sem Page ID"}</small></div><div className="row-resolution"><span>{resolutionLabel(row.resolutionStatus)}</span>{pending && row.entityType === "task" && <><select aria-label="Cliente para a demanda" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Selecionar cliente</option>{clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.fullName}</option>)}</select><button disabled={busy || !target} onClick={() => onResolve("create_new", target)}><Link2 size={13} /> Vincular</button><button disabled={busy} onClick={() => onResolve("import_internal")}>Importar interna</button><button disabled={busy} onClick={() => onResolve("skip")}>Ignorar</button></>}{pending && row.entityType === "client" && <>{row.targetId && <button disabled={busy} onClick={() => onResolve("link_existing", row.targetId!)}>Vincular existente</button>}<button disabled={busy} onClick={() => onResolve("create_new_lead")}>Criar lead</button><button disabled={busy} onClick={() => onResolve("skip")}>Ignorar</button></>}</div></div>;
}

function CommitDialog({ detail, busy, onClose, onConfirm }: { detail: ImportBatchDetail; busy: boolean; onClose: () => void; onConfirm: () => void }) { const clientCreates = detail.rows.filter((row) => row.entityType === "client" && row.resolutionStatus === "create_new_lead").length; const tasks = detail.rows.filter((row) => row.entityType === "task" && ["create_new", "import_internal"].includes(row.resolutionStatus)).length; const linked = detail.rows.filter((row) => row.resolutionStatus === "link_existing").length; const skipped = detail.rows.filter((row) => ["skip", "declared_pending"].includes(row.resolutionStatus)).length; return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="confirm-modal import-confirm-modal"><button className="dialog-close" onClick={onClose}>Fechar</button><FileWarning /><h2>Confirmar importação revisada?</h2><p>Serão criados <strong>{clientCreates} leads</strong> e <strong>{tasks} demandas</strong>; {linked} registros serão ligados a existentes; {skipped} linhas ficarão ignoradas ou apenas declaradas.</p><div className="import-zero-balance"><ShieldCheck /> Nenhum saldo oficial será lançado automaticamente.</div><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Voltar à revisão</button><button className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? "Importando..." : "Confirmar lote"}</button></div></div></div>; }

function resolutionLabel(value: string) { return ({ pending: "Decisão necessária", create_new_lead: "Criar lead", create_new: "Criar demanda", link_existing: "Vincular existente", import_internal: "Demanda interna", declared_pending: "Declarado / pendente", skip: "Ignorar", committed: "Confirmado", rolled_back: "Desfeito" } as Record<string, string>)[value] ?? value; }

function downloadSafeIssues(detail: ImportBatchDetail) { const lines = [["entidade", "linha", "severidade", "codigo", "campo", "mensagem"], ...detail.rows.flatMap((row) => row.issues.map((issue) => [row.entityType, String(row.rowNumber), issue.severity, issue.code, issue.fieldName ?? "", issue.message]))]; const csv = lines.map((line) => line.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")).join("\r\n"); const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `erros-importacao-${detail.batch.batchId.slice(0, 8)}.csv`; anchor.click(); URL.revokeObjectURL(url); }
