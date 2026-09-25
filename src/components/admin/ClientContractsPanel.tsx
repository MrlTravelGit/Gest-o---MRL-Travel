import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, CheckCircle2, Copy, Download, ExternalLink, FileText, MessageCircle, Plus, RefreshCw, RotateCcw, Send, ShieldCheck, Trash2, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { openContractDownload } from "@/lib/contracts/downloadContract";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { archiveClientContract, downloadStoredContract, getAutentiqueSendContext, listClientContracts, resendContractApprovedMessage, sendContractToAutentique, syncAutentiqueDocument } from "@/services/contracts";
import type { ClientContract, ContractFilter, ContractSignatureStatus } from "@/types/contracts";

type SignerDraft = { key: string; name: string; email: string; phone: string; cpf: string; deliveryMethod: "link" | "email" | "whatsapp" | "sms" };
type SignatureDraft = { contract: ClientContract; documentName: string; sandbox: boolean; environmentResolved: boolean; signers: SignerDraft[]; excludedWitnessEmails: string[]; overrideMonthlyLimit: boolean };

const signatureLabels: Record<ContractSignatureStatus, string> = {
  draft: "Preparando envio", sent: "Enviado", pending_signature: "Aguardando assinatura",
  partially_signed: "Parcialmente assinado", completed: "Assinado", rejected: "Recusado", failed: "Falha no envio",
};
const notificationLabels = { sending: "enviando", sent: "enviada", pending_manual: "pendente manual", failed: "falhou" } as const;
const newSigner = (contract?: ClientContract): SignerDraft => ({
  key: crypto.randomUUID(), name: contract?.clientName ?? "", email: contract?.email ?? "", phone: "", cpf: contract?.cpf ?? "", deliveryMethod: "link",
});

export function ClientContractsPanel({ clientId, canWrite = true, canManageSignatures = false, compact = false }: { clientId?: string; canWrite?: boolean; canManageSignatures?: boolean; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ContractFilter>("active");
  const [message, setMessage] = useState("");
  const [signatureDraft, setSignatureDraft] = useState<SignatureDraft | null>(null);
  const contracts = useQuery({ queryKey: ["client-contracts", clientId ?? "all", filter], queryFn: () => listClientContracts({ clientId, filter }) });
  const sendContext = useQuery({ queryKey: ["autentique-send-context"], queryFn: getAutentiqueSendContext, enabled: Boolean(signatureDraft && canManageSignatures), staleTime: 30_000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["client-contracts"] });

  useEffect(() => {
    if (!signatureDraft || signatureDraft.environmentResolved || !sendContext.data) return;
    setSignatureDraft((current) => current && ({ ...current, sandbox: sendContext.data.sandbox, environmentResolved: true }));
  }, [sendContext.data, signatureDraft]);

  const archive = useMutation({ mutationFn: archiveClientContract, onSuccess: async () => { setMessage("Contrato arquivado com sucesso."); await refresh(); } });
  const sendForSignature = useMutation({
    mutationFn: () => {
      if (!signatureDraft) throw new Error("Selecione o contrato para assinatura.");
      return sendContractToAutentique({
        contract: signatureDraft.contract, documentName: signatureDraft.documentName, sandbox: signatureDraft.sandbox,
        signers: signatureDraft.signers.map(({ key: _key, ...signer }) => ({ ...signer, action: "SIGN" })),
        excludedWitnessEmails: signatureDraft.excludedWitnessEmails, overrideMonthlyLimit: signatureDraft.overrideMonthlyLimit,
      });
    },
    onSuccess: async (request) => {
      setSignatureDraft(null);
      setMessage(request.signers.some((signer) => signer.signatureLink)
        ? "Contrato enviado para assinatura."
        : "Contrato enviado, mas a Autentique não retornou link de assinatura para este signatário.");
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["autentique-send-context"] })]);
    },
  });
  const syncStatus = useMutation({ mutationFn: syncAutentiqueDocument, onSuccess: async () => { setMessage("Status atualizado com a Autentique."); await refresh(); } });
  const resendMessage = useMutation({
    mutationFn: resendContractApprovedMessage,
    onSuccess: async (status) => {
      setMessage(status === "sent" ? "Mensagem enviada ao cliente." : status === "pending_manual" ? "Pendência manual registrada para contato com o cliente." : "A mensagem falhou; confira a integração e tente novamente.");
      await refresh();
    },
  });

  const download = async (contract: ClientContract) => {
    try { const signedUrl = await downloadStoredContract(contract); openContractDownload(signedUrl); setMessage("Download iniciado."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível baixar o contrato."); }
  };
  const copySignatureLink = async (link: string) => {
    try { await navigator.clipboard.writeText(link); setMessage("Link de assinatura copiado."); }
    catch { setMessage("Não foi possível copiar o link. Abra-o e copie pela barra do navegador."); }
  };
  const openSignatureModal = (contract: ClientContract) => {
    sendForSignature.reset();
    setSignatureDraft({ contract, documentName: `Contrato MRL Travel - ${contract.clientName}`, sandbox: sendContext.data?.sandbox ?? true, environmentResolved: Boolean(sendContext.data), signers: [newSigner(contract)], excludedWitnessEmails: [], overrideMonthlyLimit: false });
  };
  const updateSigner = (key: string, values: Partial<SignerDraft>) => setSignatureDraft((current) => current && ({ ...current, signers: current.signers.map((signer) => signer.key === key ? { ...signer, ...values } : signer) }));
  const monthlyLimitReached = Boolean(!signatureDraft?.sandbox && sendContext.data && sendContext.data.productionUsed >= sendContext.data.monthlyLimit);
  const visibleWitnesses = (sendContext.data?.witnesses ?? []).filter((witness) => !signatureDraft?.excludedWitnessEmails.includes(witness.email));

  return <section className={"client-contracts-panel" + (compact ? " compact" : "")}>
    <div className="section-heading"><div><span className="eyebrow">Documentos jurídicos</span><h2>Contratos gerados</h2><p>PDFs privados, auditáveis e vinculados ao cliente.</p></div>{clientId && <Link className="primary-button" to={"/admin/contratos?clientId=" + clientId}><Plus size={16} /> Gerar contrato</Link>}</div>
    <div className="contract-filter-tabs" role="tablist" aria-label="Filtrar contratos">{(["active", "archived", "all"] as ContractFilter[]).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "active" ? "Ativos" : value === "archived" ? "Arquivados" : "Todos"}</button>)}</div>
    {contracts.isLoading && <div className="panel-state">Carregando contratos...</div>}
    {contracts.isError && <div className="form-error">{contracts.error.message}</div>}
    {contracts.data?.length === 0 && <div className="empty-state">Nenhum contrato encontrado neste filtro.</div>}
    <div className="contract-history-list">{contracts.data?.map((contract) => {
      const signature = contract.signatureRequest;
      const displayStatus = signature?.approvedAt ? "Aprovado" : signature ? signatureLabels[signature.status] : contract.status === "archived" ? "Arquivado" : "Não enviado";
      return <article key={contract.id}>
        <div className="contract-history-icon"><FileText /></div>
        <div className="contract-history-main">
          <small>{contract.contractNumber ?? "Contrato MRL"} · {formatDate(contract.contractDate)}</small><strong>{contract.clientName}</strong>
          <span>{formatCurrency(contract.contractValue)} · {contract.installments}x de {formatCurrency(contract.installmentValue)}</span>
          <p>{contract.includeCashback ? "Cashback " + contract.cashbackPercent + "%" : "Sem cashback"} · {contract.includeRoiGuarantee ? "Com garantia de retorno" : "Sem garantia de retorno"} · {contract.includeCourtesyTicket ? "Com passagem cortesia" : "Sem passagem cortesia"}</p>
          {signature && <div className="contract-signature-summary">
            <div className="contract-signature-state"><ShieldCheck /><span>{signature.sandbox ? "Sandbox" : "Produção"}</span><strong>{displayStatus}</strong>{signature.approvedAt && <small>{formatDate(signature.approvedAt)}</small>}</div>
            {signature.signers.map((signer) => <div className="contract-signer-line" key={signer.id}><span><b>{signer.name}</b> · {signer.action === "SIGN_AS_A_WITNESS" ? "testemunha" : "assinante principal"} · {signer.status === "signed" ? `assinado em ${formatDate(signer.signedAt ?? signature.approvedAt ?? "")}` : signer.status === "failed" ? "falha de entrega" : signer.status}</span>{signer.signatureLink && <button type="button" onClick={() => void copySignatureLink(signer.signatureLink!)}><Copy /> Copiar link</button>}</div>)}
            {signature.customerNotificationStatus && <div className={`contract-notification-state ${signature.customerNotificationStatus}`}><MessageCircle /><span>Mensagem ao cliente: <strong>{notificationLabels[signature.customerNotificationStatus]}</strong></span>{signature.customerNotificationError && <small>{signature.customerNotificationError}</small>}</div>}
            {signature.errorMessage && <p className="form-error">{signature.errorMessage}</p>}
          </div>}
        </div>
        <span className={"status-badge status-" + (signature?.approvedAt ? "completed" : signature?.status ?? contract.status)}>{displayStatus}</span>
        <div className="contract-history-actions">
          <button type="button" className="secondary-button" disabled={!contract.pdfPath} onClick={() => void download(contract)}><Download size={15} /> PDF</button>
          {!signature && contract.status !== "archived" && canManageSignatures && <button type="button" className="primary-button" onClick={() => openSignatureModal(contract)}><Send size={15} /> Enviar para assinatura</button>}
          {signature?.providerDocumentId && <>{canManageSignatures && <button type="button" className="secondary-button" disabled={syncStatus.isPending} onClick={() => syncStatus.mutate(signature.id)}><RefreshCw size={15} /> Atualizar status</button>}<a className="secondary-button" href={`https://painel.autentique.com.br/documentos/${signature.providerDocumentId}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Autentique</a></>}
          {(signature?.padesPdfUrl || signature?.signedPdfUrl) && <a className="secondary-button" href={signature.padesPdfUrl || signature.signedPdfUrl || "#"} target="_blank" rel="noreferrer"><CheckCircle2 size={15} /> PDF assinado</a>}
          {signature?.approvedAt && signature.customerNotificationStatus !== "sent" && canManageSignatures && <button type="button" className="secondary-button" disabled={resendMessage.isPending} onClick={() => resendMessage.mutate(signature.id)}><MessageCircle size={15} /> Reenviar mensagem</button>}
          {contract.status !== "archived" && <button type="button" className="secondary-button" disabled={!canWrite || archive.isPending} onClick={() => { if (window.confirm("Arquivar este contrato? O PDF será preservado para auditoria.")) archive.mutate(contract.id); }}><Archive size={15} /> Arquivar</button>}
        </div>
      </article>;
    })}</div>
    {(archive.isError || syncStatus.isError || resendMessage.isError) && <div className="form-error">{(archive.error ?? syncStatus.error ?? resendMessage.error)?.message}</div>}
    {message && <div className="contract-toast" role="status">{message}<button type="button" onClick={() => setMessage("")}>Fechar</button></div>}

    {signatureDraft && <div className="contract-signature-backdrop" role="presentation"><form className="contract-signature-modal" role="dialog" aria-modal="true" aria-labelledby="contract-signature-title" onSubmit={(event) => { event.preventDefault(); sendForSignature.mutate(); }}>
      <header><div><span className="eyebrow">Assinatura eletrônica</span><h2 id="contract-signature-title">Enviar para Autentique</h2><p>Revise o assinante, as testemunhas e a cota antes do envio.</p></div><button type="button" className="icon-button" aria-label="Fechar" onClick={() => setSignatureDraft(null)}><X /></button></header>
      <div className="contract-send-facts"><div><span>Cliente</span><strong>{signatureDraft.contract.clientName}</strong></div><div><span>PDF</span><strong>{signatureDraft.contract.contractNumber ?? "Contrato MRL"}.pdf</strong></div><label><span>Ambiente</span><select value={signatureDraft.sandbox ? "sandbox" : "production"} onChange={(event) => setSignatureDraft((current) => current && ({ ...current, sandbox: event.target.value === "sandbox", overrideMonthlyLimit: false }))}><option value="sandbox">Sandbox, sem validade jurídica</option><option value="production">Produção</option></select></label></div>
      <label className="field-full">Nome do documento<input value={signatureDraft.documentName} onChange={(event) => setSignatureDraft((current) => current && ({ ...current, documentName: event.target.value }))} required /></label>
      <div className="contract-signers-heading"><div><span className="eyebrow">Assinante principal</span><strong>{signatureDraft.signers.length} pessoa(s)</strong></div><button type="button" className="secondary-button" onClick={() => setSignatureDraft((current) => current && ({ ...current, signers: [...current.signers, newSigner()] }))}><Plus /> Adicionar assinante</button></div>
      <div className="contract-signer-editor-list">{signatureDraft.signers.map((signer, index) => <fieldset key={signer.key}><legend>{index === 0 ? "Cliente" : `Assinante ${index + 1}`}</legend>{signatureDraft.signers.length > 1 && <button type="button" className="contract-remove-signer" aria-label={`Remover assinante ${index + 1}`} onClick={() => setSignatureDraft((current) => current && ({ ...current, signers: current.signers.filter((item) => item.key !== signer.key) }))}><Trash2 /></button>}<div className="form-grid">
        <label>Nome<input value={signer.name} onChange={(event) => updateSigner(signer.key, { name: event.target.value })} required /></label><label>Método<select value={signer.deliveryMethod} onChange={(event) => updateSigner(signer.key, { deliveryMethod: event.target.value as SignerDraft["deliveryMethod"] })}><option value="link">Gerar link</option><option value="email">Enviar por e-mail</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select></label>
        <label>E-mail<input type="email" value={signer.email} onChange={(event) => updateSigner(signer.key, { email: event.target.value })} required={signer.deliveryMethod === "email"} /></label><label>Telefone<input value={signer.phone} onChange={(event) => updateSigner(signer.key, { phone: event.target.value })} placeholder="+5537999999999" required={signer.deliveryMethod === "whatsapp" || signer.deliveryMethod === "sms"} /></label><label>CPF <small>(opcional)</small><input value={signer.cpf} onChange={(event) => updateSigner(signer.key, { cpf: event.target.value })} /></label>
      </div></fieldset>)}</div>

      <section className="contract-witnesses-section"><div className="contract-signers-heading"><div><span className="eyebrow">Testemunhas padrão</span><strong>{visibleWitnesses.length} incluída(s)</strong></div><button type="button" className="secondary-button" disabled={sendContext.isFetching} onClick={() => { setSignatureDraft((current) => current && ({ ...current, excludedWitnessEmails: [] })); void sendContext.refetch(); }}><RotateCcw /> Recarregar padrão</button></div>
        {sendContext.isLoading && <div className="panel-state">Carregando configuração segura...</div>}
        {sendContext.isError && <div className="form-error">{sendContext.error.message}</div>}
        {sendContext.data && !sendContext.data.witnessesConfigured && <div className="contract-config-warning"><AlertTriangle /><span>As testemunhas padrão ainda não foram configuradas. O envio continuará somente com o cliente.</span></div>}
        <div className="contract-witness-list">{visibleWitnesses.map((witness) => <article key={witness.email}><UserCheck /><div><strong>{witness.name}</strong><span>{witness.email}</span><small>Testemunha · SIGN_AS_A_WITNESS · envio por e-mail</small></div><button type="button" className="icon-button" aria-label={`Remover ${witness.name} deste envio`} onClick={() => setSignatureDraft((current) => current && ({ ...current, excludedWitnessEmails: [...current.excludedWitnessEmails, witness.email] }))}><X /></button></article>)}</div>
      </section>

      <div className={`contract-quota-card ${signatureDraft.sandbox ? "sandbox" : monthlyLimitReached ? "limit" : "production"}`}><ShieldCheck /><div><strong>{signatureDraft.sandbox ? "Ambiente de teste" : `Contratos reais enviados neste mês: ${sendContext.data?.productionUsed ?? "—"} de ${sendContext.data?.monthlyLimit ?? "—"}`}</strong><span>{signatureDraft.sandbox ? "Este envio não conta no limite mensal." : monthlyLimitReached ? "O limite mensal foi atingido e o envio está bloqueado por padrão." : "Somente documentos criados em produção entram nesta contagem."}</span></div></div>
      {monthlyLimitReached && sendContext.data?.canOverrideMonthlyLimit && <label className="contract-quota-override"><input type="checkbox" checked={signatureDraft.overrideMonthlyLimit} onChange={(event) => setSignatureDraft((current) => current && ({ ...current, overrideMonthlyLimit: event.target.checked }))} /><span><strong>Autorizar envio acima do limite</strong><small>Este envio pode gerar cobrança adicional na Autentique.</small></span></label>}
      <div className={`contract-environment-warning ${signatureDraft.sandbox ? "sandbox" : "production"}`}><ShieldCheck /><div><strong>{signatureDraft.sandbox ? "Envio de teste" : "Envio real"}</strong><span>{signatureDraft.sandbox ? "Documentos sandbox são removidos após alguns dias e não têm validade jurídica." : "O documento terá validade para assinatura e poderá consumir créditos."}</span></div></div>
      {sendForSignature.isError && <div className="form-error">{sendForSignature.error.message}</div>}
      <footer><button type="button" className="secondary-button" onClick={() => setSignatureDraft(null)}>Cancelar</button><button className="primary-button" disabled={sendForSignature.isPending || sendContext.isLoading || sendContext.isError || (monthlyLimitReached && !signatureDraft.overrideMonthlyLimit)}><Send /> {sendForSignature.isPending ? "Enviando PDF..." : "Enviar para Autentique"}</button></footer>
    </form></div>}
  </section>;
}
