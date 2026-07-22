import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, CheckCircle2, Database, Download, FileArchive, FileWarning, Link2, RefreshCw, Scale, ShieldCheck, Upload, WalletCards, X } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { getAdminFormOptions } from "@/services/admin-options";
import { bulkResolveImportRows, commitIddasBalanceBackfill, commitImportBatch, getImportBatch, listImportBatches, materializeMissingIddasLegacyClient, previewIddasBalanceBackfill, resolveImportRow, rollbackIddasBalanceBackfill, rollbackImportBatch, uploadImport, type ImportUploadStage } from "@/services/imports";
import type { IddasBackfillAction, IddasBackfillPreview, ImportBatchDetail, ImportPreviewRow } from "@/types/imports";
import { countBlockingImportRows, filterImportConflicts } from "@/lib/import-resolution";

const entityLabels: Record<string, string> = { client: "Cliente", task: "Demanda", onboarding: "Onboarding", program: "Programa", passage: "Passagem" };

export function AdminImportsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadStage, setUploadStage] = useState<ImportUploadStage | null>(null);
  const [fileError, setFileError] = useState("");
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [reportKind, setReportKind] = useState("complete");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const batches = useQuery({ queryKey: ["import-batches"], queryFn: listImportBatches });
  const detail = useQuery({ queryKey: ["import-batch", selectedId], queryFn: () => getImportBatch(selectedId!), enabled: Boolean(selectedId) });
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const uploadMutation = useMutation({
    mutationFn: (selectedFile: File) => uploadImport(selectedFile, setUploadStage),
    onSuccess: async (result) => { setSelectedId(result.batchId); setFile(null); setFileInputKey((value) => value + 1); setUploadStage(null); await queryClient.invalidateQueries({ queryKey: ["import-batches"] }); },
    onError: () => setUploadStage(null),
  });
  const resolveMutation = useMutation({
    mutationFn: ({ rowId, resolution, targetId, reason }: { rowId: string; resolution: string; targetId?: string; reason?: string }) => resolveImportRow(rowId, resolution, targetId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["import-batch", selectedId] }),
  });
  const bulkMutation = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) => bulkResolveImportRows(selectedId!, action, reason),
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
  const visibleRows = useMemo(() => filterImportConflicts(detail.data?.rows ?? [], onlyConflicts), [detail.data, onlyConflicts]);
  const blocking = countBlockingImportRows(detail.data?.rows ?? []);

  function selectFile(nextFile: File | null) {
    setFileError("");
    if (!nextFile) return setFile(null);
    if (!/\.(zip|csv)$/i.test(nextFile.name)) return setFileError("Selecione um arquivo .zip ou .csv.");
    if (nextFile.size > 15 * 1024 * 1024) return setFileError("O arquivo excede o limite de 15 MB.");
    setFile(nextFile);
  }
  function submit(event: FormEvent) { event.preventDefault(); if (file) uploadMutation.mutate(file); }

  return <AppShell title="Importações" hideHeading>
    <PageHeader eyebrow="Migração controlada" title="Importações" description="Pré-visualize, resolva conflitos e confirme dados legados sem alterar saldos automaticamente." />
    <section className="import-security-strip"><ShieldCheck /><div><strong>Dry-run obrigatório</strong><span>ZIP e CSV são analisados no backend, em staging privado. Nenhuma linha desta tela já foi gravada nas tabelas oficiais.</span></div></section>
    <IddasBackfillPanel />
    <div className="imports-layout">
      <aside className="import-batch-sidebar">
        <form className="import-upload-card" onSubmit={submit}><FileArchive /><h2>Novo lote</h2><p>ZIP do Notion ou CSV UTF-8, até 15 MB.</p><label className="file-drop"><Upload /><span>{file?.name ?? "Selecionar arquivo"}</span><input key={fileInputKey} type="file" accept=".zip,.csv,application/zip,application/x-zip-compressed,text/csv,application/csv" disabled={uploadMutation.isPending} onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /></label>{file && !uploadMutation.isPending && <button type="button" className="remove-upload-file" onClick={() => { setFile(null); setFileInputKey((value) => value + 1); }}><X size={14} /> Remover arquivo</button>}<button className="primary-button" disabled={!file || uploadMutation.isPending}>{uploadMutation.isPending ? uploadStageLabel(uploadStage) : "Enviar e analisar"}</button>{uploadMutation.isPending && <div className="upload-progress" role="status"><span className={`stage-${uploadStage}`} /><small>{uploadStageLabel(uploadStage)}</small></div>}{fileError && <div className="form-error">{fileError}</div>}{uploadMutation.isError && <div className="form-error">{uploadMutation.error.message}<button type="button" onClick={() => file && uploadMutation.mutate(file)}>Tentar novamente</button></div>}{uploadMutation.data?.duplicate && <div className="form-warning">Upload idêntico detectado. Abrimos o dry-run existente.</div>}</form>
        <div className="batch-history"><div className="section-heading"><h2>Lotes recentes</h2><button aria-label="Atualizar lotes" onClick={() => batches.refetch()}><RefreshCw size={15} /></button></div>{batches.isLoading && <span>Carregando...</span>}{batches.data?.map((batch) => <button key={batch.id} className={selectedId === batch.id ? "active" : ""} onClick={() => setSelectedId(batch.id)}><span className={`batch-status status-${batch.status}`}>{batch.status}</span><strong>{batch.original_filename}</strong><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(batch.created_at))}</small></button>)}</div>
      </aside>
      <main className="import-preview-area">
        {!selectedId && <EmptyState title="Selecione ou envie um lote" description="A prévia mostrará contagens canônicas, avisos e decisões pendentes." />}
        {detail.isLoading && <LoadingState label="Carregando staging protegido..." />}
        {detail.isError && <ErrorState message={detail.error.message} retry={() => detail.refetch()} />}
        {detail.data && <>
          <header className="import-batch-header"><div><span className="eyebrow">{detail.data.batch.adapterVersion}</span><h2>{detail.data.batch.originalFilename}</h2><p>Request ID: <code>{detail.data.batch.requestId}</code></p></div><span className={`batch-status status-${detail.data.batch.status}`}>{detail.data.batch.status}</span></header>
          <ImportSummaryCards detail={detail.data} />
          <div className="import-notice"><Database /><p><strong>Dry-run não altera o ledger.</strong> Os saldos abaixo só viram movimentos oficiais depois da decisão administrativa e da confirmação atômica do lote.</p></div>
          <section className="import-files"><h3>Arquivos reconhecidos</h3><div>{detail.data.files.filter((item) => item.isCanonical || item.ignoredReason === "FILTERED_RELATIONAL_VIEW").map((item) => <article key={item.fileId} className={item.ignoredReason ? "ignored" : "canonical"}><span>{item.logicalType}</span><strong>{item.rowCount} linhas</strong><small>{item.ignoredReason === "FILTERED_RELATIONAL_VIEW" ? "Ignorado: visão relacional duplicada" : "Fonte canônica"}</small></article>)}</div></section>
          <BalanceReconciliation detail={detail.data} busy={resolveMutation.isPending || bulkMutation.isPending} onResolve={(rowId, action, reason) => resolveMutation.mutate({ rowId, resolution: action, reason })} onBulk={(action) => bulkMutation.mutate({ action })} />
          <div className="preview-toolbar"><label><input type="checkbox" checked={onlyConflicts} onChange={(event) => setOnlyConflicts(event.target.checked)} /> Mostrar somente conflitos</label><select aria-label="Conteúdo do relatório" value={reportKind} onChange={(event) => setReportKind(event.target.value)}><option value="complete">Relatório completo</option><option value="blocking">Erros bloqueantes</option><option value="pending">Decisões pendentes</option><option value="warning">Avisos</option><option value="info">Informações</option></select><button className="secondary-button" onClick={() => downloadSafeIssues(detail.data, reportKind)}><Download size={15} /> Baixar relatório de validação</button></div>
          <div className="import-row-table" role="table" aria-label="Prévia das linhas"><div className="import-row-head" role="row"><span>Entidade / linha</span><span>Prévia segura</span><span>Validação</span><span>Decisão</span></div>{visibleRows.map((row) => <ImportRow key={row.rowId} row={row} clients={options.data?.clients ?? []} busy={resolveMutation.isPending} onResolve={(resolution, targetId) => resolveMutation.mutate({ rowId: row.rowId, resolution, targetId })} />)}</div>
          {(resolveMutation.isError || bulkMutation.isError) && <div className="form-error">{resolveMutation.error?.message ?? bulkMutation.error?.message}</div>}
          <footer className="import-commit-bar"><div><strong>{blocking ? `${blocking} decisão(ões) bloqueante(s)` : "Lote pronto para confirmação"}</strong><span>{detail.data.batch.summary.canonical.clients} clientes · {detail.data.batch.summary.canonical.tasks} demandas · {detail.data.batch.summary.taskRelations.needsDecision} demandas originalmente sem cliente</span></div><div>{detail.data.batch.status === "committed" && <button className="secondary-button danger-button" disabled={!detail.data.canManage || rollbackMutation.isPending} onClick={() => { const reason = window.prompt("Motivo para desfazer logicamente este lote:"); if (reason) rollbackMutation.mutate(reason); }}><ArchiveRestore size={15} /> Desfazer lote</button>}<button className="primary-button" disabled={!detail.data.canManage || blocking > 0 || detail.data.batch.status !== "review"} onClick={() => setConfirmOpen(true)}><CheckCircle2 size={15} /> Confirmar importação</button></div></footer>
          {commitMutation.isError && <div className="form-error">{commitMutation.error.message}</div>}{rollbackMutation.isError && <div className="form-error">{rollbackMutation.error.message}</div>}
          {confirmOpen && <CommitDialog detail={detail.data} busy={commitMutation.isPending} onClose={() => setConfirmOpen(false)} onConfirm={() => commitMutation.mutate()} />}
        </>}
      </main>
    </div>
  </AppShell>;
}

const iddasActionLabels: Record<IddasBackfillAction, string> = {
  insert: "Inserir saldo inicial",
  already_conciliated: "Já conciliado",
  conflict: "Conflito de saldo",
  client_not_found: "Cliente não encontrado",
  ambiguous_client: "Cliente ambíguo",
  program_not_found: "Programa não encontrado",
};

function IddasBackfillPanel() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [lastResult, setLastResult] = useState<IddasBackfillPreview | null>(null);
  const preview = useQuery({ queryKey: ["iddas-balance-backfill"], queryFn: previewIddasBalanceBackfill, retry: false });
  const commit = useMutation({
    mutationFn: ({ batchId, key }: { batchId: string; key: string }) => commitIddasBalanceBackfill(batchId, key),
    onSuccess: async (result) => {
      setLastResult(result); setConfirmOpen(false); setConfirmation("");
      queryClient.setQueryData(["iddas-balance-backfill"], result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["import-batches"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-client-points"] }),
        queryClient.invalidateQueries({ queryKey: ["public-client-dashboard"] }),
      ]);
    },
  });
  const rollback = useMutation({
    mutationFn: ({ batchId, reason }: { batchId: string; reason: string }) => rollbackIddasBalanceBackfill(batchId, reason),
    onSuccess: async () => { setLastResult(null); await Promise.all([preview.refetch(), queryClient.invalidateQueries({ queryKey: ["import-batches"] }), queryClient.invalidateQueries({ queryKey: ["admin-clients"] })]); },
  });
  const data = preview.data;
  const missingClients = data?.clients.filter((client) => !client.clientId) ?? [];
  const recoverableMissingClient = missingClients.length === 1 && missingClients[0].legacyPersonId === 9485 ? missingClients[0] : null;
  const materialize = useMutation({
    mutationFn: () => materializeMissingIddasLegacyClient(recoverableMissingClient!.legacyPersonId, data!.sourceKey),
    onSuccess: async () => {
      setLastResult(null);
      await Promise.all([
        preview.refetch(),
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-form-options"] }),
      ]);
    },
  });
  const points = new Intl.NumberFormat("pt-BR");
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  return <section className="iddas-backfill" aria-labelledby="iddas-backfill-title">
    <header>
      <div><span className="eyebrow"><Database size={14} /> Conciliação oficial</span><h2 id="iddas-backfill-title">Saldos Iddas · 21 jul 2026</h2><p>Manifesto imutável, conferência exata e lançamentos no ledger por cliente.</p></div>
      <div className="iddas-header-actions"><span className={`batch-status status-${data?.status ?? "review"}`}>{data?.status ?? "prévia"}</span><button className="icon-button" aria-label="Atualizar prévia Iddas" disabled={preview.isFetching} onClick={() => preview.refetch()}><RefreshCw size={15} /></button></div>
    </header>
    {preview.isLoading && <LoadingState label="Conferindo 44 contas no ledger..." />}
    {preview.isError && <div className="iddas-restricted"><ShieldCheck /><div><strong>Operação restrita a superadministrador</strong><span>{preview.error.message}</span></div></div>}
    {data && <>
      <div className="iddas-signature-grid">
        <article><span>Clientes conciliáveis</span><strong>{data.summary.matchedClients}<small>/ {data.summary.expectedClients}</small></strong></article>
        <article><span>Contas no manifesto</span><strong>{data.summary.accounts}<small>/ {data.summary.expectedAccounts}</small></strong></article>
        <article><span>Pontos oficiais</span><strong>{points.format(data.summary.points)}</strong></article>
        <article><span>Patrimônio Iddas</span><strong>{money.format(data.summary.bookValue)}</strong></article>
      </div>
      <div className={`iddas-verdict ${data.canCommit ? "ready" : "blocked"}`}>
        {data.canCommit ? <CheckCircle2 /> : <FileWarning />}
        <div><strong>{data.canCommit ? "Manifesto íntegro e pronto" : "Confirmação bloqueada"}</strong><span>{data.summary.toInsert} para inserir · {data.summary.alreadyConciliated} já conciliadas · {data.summary.conflicts} conflitos · {data.summary.notFound} não localizadas</span></div>
      </div>
      {recoverableMissingClient && <div className="iddas-restricted"><ShieldCheck /><div><strong>Cadastro legado localizado no staging</strong><span>{recoverableMissingClient.targetName} não tem contato verificável na fonte. Crie um lead com contato pendente, sem inventar dados e sem ativá-lo.</span></div><button className="secondary-button" disabled={materialize.isPending} onClick={() => materialize.mutate()}>{materialize.isPending ? "Recuperando..." : "Criar lead legado ausente"}</button></div>}
      {lastResult && <div className="iddas-run-result" role="status"><ShieldCheck /><span>{lastResult.idempotentReplay ? `Reexecução comprovada: ${lastResult.newTransactions ?? 0} novo lançamento.` : `${lastResult.succeededClients ?? 0} clientes processados; ${lastResult.newTransactions ?? 0} lançamentos criados.`}</span></div>}
      <details className="iddas-manifest"><summary><span>Revisar os 13 vínculos e as 44 contas</span><small>nome do sistema × nome Iddas × saldo atual × fonte</small></summary>
        <div className="iddas-table"><div className="iddas-table-head"><span>Cliente</span><span>Programa</span><span>Atual</span><span>Fonte</span><span>Custo / mil</span><span>Patrimônio</span><span>Ação</span></div>{data.rows.map((row) => <article key={row.idempotencyKey} className={`action-${row.action}`}><div><strong>{row.systemName ?? row.targetName}</strong><small>Iddas: {row.legacyName} · ID {row.legacyPersonId}</small></div><span>{row.programName ?? row.programSlug}</span><span>{points.format(row.currentPoints)}</span><span>{points.format(row.sourcePoints)}</span><span>{money.format(row.costPerThousand)}</span><span>{money.format(row.bookValue)}</span><span className="iddas-action">{iddasActionLabels[row.action]}</span></article>)}</div>
      </details>
      <footer className="iddas-footer"><div><ShieldCheck size={16} /><span>Somente o backend financeiro grava os lançamentos. Status dos clientes são preservados.</span></div><div>{data.canRollback && <button className="secondary-button danger-button" disabled={rollback.isPending} onClick={() => { const reason = window.prompt("Motivo do estorno contábil (mínimo de 8 caracteres):"); if (reason) rollback.mutate({ batchId: data.batchId, reason }); }}><ArchiveRestore size={15} /> Estornar lote</button>}{data.status === "committed" ? <button className="secondary-button" disabled={commit.isPending} onClick={() => commit.mutate({ batchId: data.batchId, key: data.sourceKey })}><RefreshCw size={15} /> Verificar idempotência</button> : <button className="primary-button" disabled={!data.canCommit || commit.isPending} onClick={() => setConfirmOpen(true)}><CheckCircle2 size={15} /> Confirmar 44 contas</button>}</div></footer>
      {(commit.isError || rollback.isError || materialize.isError) && <div className="form-error">{commit.error?.message ?? rollback.error?.message ?? materialize.error?.message}</div>}
      {confirmOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="iddas-confirm-title"><div className="confirm-modal iddas-confirm-modal"><button className="dialog-close" onClick={() => setConfirmOpen(false)}>Fechar</button><Scale /><h2 id="iddas-confirm-title">Confirmar conciliação contábil?</h2><p>O backend tentará gravar <strong>{data.summary.toInsert} saldos iniciais</strong>, totalizando <strong>{points.format(data.summary.points)} pontos</strong> e <strong>{money.format(data.summary.bookValue)}</strong>. Cada cliente é atômico.</p><label>Digite a chave do lote para confirmar<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={data.sourceKey} /></label><div className="dialog-actions"><button className="secondary-button" onClick={() => setConfirmOpen(false)}>Voltar à prévia</button><button className="primary-button" disabled={confirmation !== data.sourceKey || commit.isPending} onClick={() => commit.mutate({ batchId: data.batchId, key: confirmation })}>{commit.isPending ? "Conciliando..." : "Confirmar no ledger"}</button></div></div></div>}
    </>}
  </section>;
}

function ImportSummaryCards({ detail }: { detail: ImportBatchDetail }) { const summary = detail.batch.summary; const cards = [["Clientes", summary.canonical.clients], ["Demandas", summary.canonical.tasks], ["Programas", summary.canonical.programs], ["Onboardings", summary.canonical.onboardings], ["Passagens", summary.canonical.passages], ["Conflitos", summary.conflicts]]; return <section className="import-summary-grid">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>; }

function BalanceReconciliation({ detail, busy, onResolve, onBulk }: { detail: ImportBatchDetail; busy: boolean; onResolve: (rowId: string, action: string, reason?: string) => void; onBulk: (action: string) => void }) {
  if (!detail.balances?.length) return null;
  const fmt = new Intl.NumberFormat("pt-BR");
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  return <section className="balance-reconciliation" aria-labelledby="balance-reconciliation-title">
    <header><div><span className="eyebrow"><Scale size={14} /> Reconciliação contábil</span><h3 id="balance-reconciliation-title">Saldos de programas</h3><p>O valor atual vem do ledger. Escolha como tratar somente as divergências.</p></div><WalletCards /></header>
    <div className="balance-bulk-actions"><span>Ações seguras em lote</span><button disabled={busy} onClick={() => onBulk("import_zero_system_balances")}>Importar onde o sistema está zerado</button><button disabled={busy} onClick={() => onBulk("keep_equal_balances")}>Confirmar saldos iguais</button><button onClick={() => document.querySelector(".balance-conflict")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Revisar divergências</button><button disabled={busy} onClick={() => onBulk("create_zero_wallets")}>Criar carteiras zeradas</button><button disabled={busy} onClick={() => onBulk("skip_balances")}>Não importar saldos</button></div>
    {detail.batch.summary.balancePreview && <div className="balance-preview-summary"><span><b>{detail.batch.summary.balancePreview.initialBalances}</b> saldos iniciais</span><span><b>{detail.batch.summary.balancePreview.equalBalances}</b> iguais</span><span><b>{detail.batch.summary.balancePreview.divergences}</b> divergências</span><span><b>{fmt.format(detail.batch.summary.balancePreview.ledgerPoints)}</b> pontos no ledger</span><span><b>{money.format(detail.batch.summary.balancePreview.patrimony)}</b> patrimônio</span></div>}
    <div className="balance-table"><div className="balance-head"><span>Programa</span><span>Atual</span><span>Importado</span><span>Diferença</span><span>Patrimônio</span><span>Decisão</span></div>{detail.balances.map((balance) => {
      const row = detail.rows.find((item) => item.rowId === balance.rowId);
      const requiresReason = (action: string) => { const reason = window.prompt("Justificativa obrigatória para alterar o ledger:"); if (reason?.trim()) onResolve(balance.rowId, action, reason); };
      return <article key={balance.reconciliationId} className={row?.blocksCommit ? "balance-conflict" : ""}><strong>{row?.preview.programName ?? "Programa"}<small>{balance.clientSourceSuffix ? `Cliente •••${balance.clientSourceSuffix}` : "Cliente vinculado"}</small></strong><span>{fmt.format(balance.currentPoints)}</span><span>{fmt.format(balance.importedPoints)}</span><span className={balance.differencePoints ? "difference" : "equal"}>{balance.differencePoints > 0 ? "+" : ""}{fmt.format(balance.differencePoints)}</span><span>{money.format(balance.estimatedValue)}</span><div><small>{balanceActionLabel(balance.chosenAction ?? balance.suggestedAction)}</small>{row?.blocksCommit && <><button disabled={busy} onClick={() => onResolve(balance.rowId, "keep_current")}>Manter atual</button><button disabled={busy} onClick={() => requiresReason("adjust_to_imported_snapshot")}>Ajustar ao importado</button><button disabled={busy} onClick={() => requiresReason("treat_imported_as_additional_entry")}>Somar como entrada</button></>}</div></article>;
    })}</div>
  </section>;
}

function ImportRow({ row, clients, busy, onResolve }: { row: ImportPreviewRow; clients: Array<{ clientId: string; fullName: string }>; busy: boolean; onResolve: (resolution: string, targetId?: string) => void }) {
  const [target, setTarget] = useState(row.targetId ?? ""); const title = row.preview.title || row.preview.fullName || row.preview.programName || "Registro sem título"; const pending = row.blocksCommit && row.entityType !== "program";
  return <div className={`import-row validation-${row.validationStatus}`} role="row"><div><span className="entity-pill">{entityLabels[row.entityType]}</span><small>Linha {row.rowNumber}</small></div><div><strong>{title}</strong><span>{row.preview.clientLabel || row.preview.status || "—"}</span>{row.issues.slice(0, 2).map((issue) => <small key={`${issue.code}-${issue.fieldName}`} className={`issue-${issue.severity}`}>{issue.code}: {issue.message}</small>)}</div><div><span className={`validation-pill ${row.validationStatus}`}>{row.validationStatus}</span><small>{row.sourceExternalId ? `Page ID •••${row.sourceExternalId.slice(-6)}` : "Sem Page ID"}</small></div><div className="row-resolution"><span>{resolutionLabel(row.resolutionStatus)}</span>{pending && row.entityType === "task" && <><select aria-label="Cliente para a demanda" value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Selecionar cliente</option>{clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.fullName}</option>)}</select><button disabled={busy || !target} onClick={() => onResolve("ready_create", target)}><Link2 size={13} /> Vincular</button><button disabled={busy} onClick={() => onResolve("ready_import_internal")}>Importar interna</button><button disabled={busy} onClick={() => onResolve("ignored_by_admin")}>Ignorar</button></>}{pending && row.entityType === "client" && <>{row.targetId && <button disabled={busy} onClick={() => onResolve("ready_link_existing", row.targetId!)}>Vincular existente</button>}<button disabled={busy} onClick={() => onResolve("ready_create")}>Criar lead</button><button disabled={busy} onClick={() => onResolve("ignored_by_admin")}>Ignorar</button></>}</div></div>;
}

function CommitDialog({ detail, busy, onClose, onConfirm }: { detail: ImportBatchDetail; busy: boolean; onClose: () => void; onConfirm: () => void }) { const clientCreates = detail.rows.filter((row) => row.entityType === "client" && row.resolutionStatus === "ready_create").length; const tasks = detail.rows.filter((row) => row.entityType === "task" && ["ready_create", "ready_import_internal"].includes(row.resolutionStatus)).length; const preview = detail.batch.summary.balancePreview; return <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="confirm-modal import-confirm-modal"><button className="dialog-close" onClick={onClose}>Fechar</button><FileWarning /><h2>Confirmar importação revisada?</h2><p>Serão criados <strong>{clientCreates} leads</strong>, <strong>{tasks} demandas</strong> e <strong>{preview?.initialBalances ?? 0} saldos iniciais</strong>. Variação calculada no backend: {new Intl.NumberFormat("pt-BR").format(preview?.ledgerPoints ?? 0)} pontos e {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(preview?.patrimony ?? 0)}.</p><div className="import-zero-balance"><ShieldCheck /> A operação é atômica, idempotente e auditada. Falhas não deixam saldo parcial.</div><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Voltar à revisão</button><button className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? "Importando..." : "Confirmar lote"}</button></div></div></div>; }

function resolutionLabel(value: string) { return ({ ready_create: "Pronto para criar", ready_update: "Pronto para completar", ready_link_existing: "Vincular existente", ready_unchanged: "Sem alteração", ready_import_internal: "Demanda interna", pending_decision: "Decisão necessária", blocked_invalid: "Linha inválida", ignored_duplicate_view: "Visão duplicada", ignored_by_admin: "Ignorado", committed: "Confirmado", failed_commit: "Falha no commit" } as Record<string, string>)[value] ?? value; }

function balanceActionLabel(value: string) { return ({ create_imported_initial_balance: "Criar saldo inicial", link_as_unchanged: "Saldo já coincide", keep_current: "Manter saldo atual", adjust_to_imported_snapshot: "Ajustar ao snapshot", treat_imported_as_additional_entry: "Somar como entrada", create_zero_wallet: "Criar carteira zerada", ignore: "Ignorar" } as Record<string, string>)[value] ?? value; }

function uploadStageLabel(stage: ImportUploadStage | null) { return ({ checksum: "Conferindo arquivo...", creating: "Preparando lote privado...", uploading: "Enviando ao Storage...", analyzing: "Analisando dry-run..." } as Record<string, string>)[stage ?? ""] ?? "Processando..."; }

function downloadSafeIssues(detail: ImportBatchDetail, kind: string) { const rows = detail.rows.filter((row) => kind !== "pending" || row.blocksCommit); const lines = [["entidade", "linha", "source_id", "resolution_status", "blocks_commit", "suggested_action", "chosen_action", "issue_count", "severidade", "codigo", "campo", "mensagem"], ...rows.flatMap((row) => row.issues.filter((issue) => kind === "complete" || kind === "pending" || kind === "blocking" ? kind !== "blocking" || row.blocksCommit && ["error", "fatal"].includes(issue.severity) : issue.severity === kind).map((issue) => [row.entityType, String(row.rowNumber), row.sourceExternalId ? `•••${row.sourceExternalId.slice(-6)}` : "", row.resolutionStatus, String(row.blocksCommit), row.suggestedAction ?? "", row.chosenAction ?? "", String(row.issues.length), issue.severity, issue.code, issue.fieldName ?? "", issue.message]))]; const csv = lines.map((line) => line.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")).join("\r\n"); const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `validacao-importacao-${kind}-${detail.batch.batchId.slice(0, 8)}.csv`; anchor.click(); URL.revokeObjectURL(url); }
