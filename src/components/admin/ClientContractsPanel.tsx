import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Copy, Download, ExternalLink, FileText, Plus, RefreshCw, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { openContractDownload } from "@/lib/contracts/downloadContract";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { archiveClientContract, downloadStoredContract, listClientContracts, sendContractToAutentique, syncAutentiqueDocument } from "@/services/contracts";
import type { ClientContract, ContractFilter, ContractSignatureStatus } from "@/types/contracts";

type SignerDraft = { key: string; name: string; email: string; phone: string; cpf: string; deliveryMethod: "link" | "email" | "whatsapp" | "sms" };
type SignatureDraft = { contract: ClientContract; documentName: string; sandbox: boolean; signers: SignerDraft[] };

const signatureLabels: Record<ContractSignatureStatus, string> = {
  draft: "Preparando envio", sent: "Enviado", pending_signature: "Aguardando assinatura",
  partially_signed: "Parcialmente assinado", completed: "Assinado", rejected: "Recusado", failed: "Falha no envio",
};

const newSigner = (contract?: ClientContract): SignerDraft => ({
  key: crypto.randomUUID(), name: contract?.clientName ?? "", email: contract?.email ?? "", phone: "", cpf: contract?.cpf ?? "", deliveryMethod: "link",
});

export function ClientContractsPanel({ clientId, canWrite = true, canManageSignatures = false, compact = false }: { clientId?: string; canWrite?: boolean; canManageSignatures?: boolean; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ContractFilter>("active");
  const [message, setMessage] = useState("");
  const [signatureDraft, setSignatureDraft] = useState<SignatureDraft | null>(null);
  const contracts = useQuery({ queryKey: ["client-contracts", clientId ?? "all", filter], queryFn: () => listClientContracts({ clientId, filter }) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
  const archive = useMutation({ mutationFn: archiveClientContract, onSuccess: async () => { setMessage("Contrato arquivado com sucesso."); await refresh(); } });
  const sendForSignature = useMutation({
    mutationFn: () => {
      if (!signatureDraft) throw new Error("Selecione o contrato para assinatura.");
      return sendContractToAutentique({
        contract: signatureDraft.contract, documentName: signatureDraft.documentName, sandbox: signatureDraft.sandbox,
        signers: signatureDraft.signers.map(({ key: _key, ...signer }) => ({ ...signer, action: "SIGN" })),
      });
    },
    onSuccess: async (request) => {
      setSignatureDraft(null);
      setMessage(request.signers.some((signer) => signer.signatureLink)
        ? "Contrato enviado para assinatura."
        : "Contrato enviado, mas a Autentique não retornou link de assinatura para este signatário.");
      await refresh();
    },
  });
  const syncStatus = useMutation({ mutationFn: syncAutentiqueDocument, onSuccess: async () => { setMessage("Status atualizado com a Autentique."); await refresh(); } });

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
    setSignatureDraft({ contract, documentName: `Contrato MRL Travel - ${contract.clientName}`, sandbox: true, signers: [newSigner(contract)] });
  };
  const updateSigner = (key: string, values: Partial<SignerDraft>) => setSignatureDraft((current) => current && ({
    ...current, signers: current.signers.map((signer) => signer.key === key ? { ...signer, ...values } : signer),
  }));

  return <section className={"client-contracts-panel" + (compact ? " compact" : "")}>
    <div className="section-heading">
      <div><span className="eyebrow">Documentos jurídicos</span><h2>Contratos gerados</h2><p>PDFs privados, auditáveis e vinculados ao cliente.</p></div>
      {clientId && <Link className="primary-button" to={"/admin/contratos?clientId=" + clientId}><Plus size={16} /> Gerar contrato</Link>}
    </div>
    <div className="contract-filter-tabs" role="tablist" aria-label="Filtrar contratos">
      {(["active", "archived", "all"] as ContractFilter[]).map((value) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "active" ? "Ativos" : value === "archived" ? "Arquivados" : "Todos"}</button>)}
    </div>
    {contracts.isLoading && <div className="panel-state">Carregando contratos...</div>}
    {contracts.isError && <div className="form-error">{contracts.error.message}</div>}
    {contracts.data?.length === 0 && <div className="empty-state">Nenhum contrato encontrado neste filtro.</div>}
    <div className="contract-history-list">{contracts.data?.map((contract) => {
      const signature = contract.signatureRequest;
      return <article key={contract.id}>
        <div className="contract-history-icon"><FileText /></div>
        <div className="contract-history-main">
          <small>{contract.contractNumber ?? "Contrato MRL"} · {formatDate(contract.contractDate)}</small>
          <strong>{contract.clientName}</strong>
          <span>{formatCurrency(contract.contractValue)} · {contract.installments}x de {formatCurrency(contract.installmentValue)}</span>
          <p>{contract.includeCashback ? "Cashback " + contract.cashbackPercent + "%" : "Sem cashback"} · {contract.includeRoiGuarantee ? "Com garantia de retorno" : "Sem garantia de retorno"} · {contract.includeCourtesyTicket ? "Com passagem cortesia" : "Sem passagem cortesia"}</p>
          {signature && <div className="contract-signature-summary">
            <div className="contract-signature-state"><ShieldCheck /><span>{signature.sandbox ? "Sandbox" : "Produção"}</span><strong>{signatureLabels[signature.status]}</strong></div>
            {signature.signers.map((signer) => <div className="contract-signer-line" key={signer.id}><span>{signer.name} · {signer.status === "signed" ? `assinado em ${formatDate(signer.signedAt ?? "")}` : signer.email || signer.phone || "link direto"}{!signer.signatureLink && signer.status !== "signed" ? " · link não retornado" : ""}</span>{signer.signatureLink && <button type="button" onClick={() => void copySignatureLink(signer.signatureLink!)}><Copy /> Copiar link</button>}</div>)}
            {signature.errorMessage && <p className="form-error">{signature.errorMessage}</p>}
          </div>}
        </div>
        <span className={"status-badge status-" + (signature?.status ?? contract.status)}>{signature ? signatureLabels[signature.status] : contract.status === "archived" ? "Arquivado" : "Não enviado"}</span>
        <div className="contract-history-actions">
          <button type="button" className="secondary-button" disabled={!contract.pdfPath} onClick={() => void download(contract)}><Download size={15} /> PDF</button>
          {!signature && contract.status !== "archived" && canManageSignatures && <button type="button" className="primary-button" onClick={() => openSignatureModal(contract)}><Send size={15} /> Enviar para assinatura</button>}
          {signature?.providerDocumentId && <>{canManageSignatures && <button type="button" className="secondary-button" disabled={syncStatus.isPending} onClick={() => syncStatus.mutate(signature.id)}><RefreshCw size={15} /> Atualizar status</button>}<a className="secondary-button" href={`https://painel.autentique.com.br/documentos/${signature.providerDocumentId}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Autentique</a></>}
          {(signature?.padesPdfUrl || signature?.signedPdfUrl) && <a className="secondary-button" href={signature.padesPdfUrl || signature.signedPdfUrl || "#"} target="_blank" rel="noreferrer"><CheckCircle2 size={15} /> PDF assinado</a>}
          {contract.status !== "archived" && <button type="button" className="secondary-button" disabled={!canWrite || archive.isPending} onClick={() => { if (window.confirm("Arquivar este contrato? O PDF será preservado para auditoria.")) archive.mutate(contract.id); }}><Archive size={15} /> Arquivar</button>}
        </div>
      </article>;
    })}</div>
    {(archive.isError || syncStatus.isError) && <div className="form-error">{(archive.error ?? syncStatus.error)?.message}</div>}
    {message && <div className="contract-toast" role="status">{message}<button type="button" onClick={() => setMessage("")}>Fechar</button></div>}

    {signatureDraft && <div className="contract-signature-backdrop" role="presentation"><form className="contract-signature-modal" role="dialog" aria-modal="true" aria-labelledby="contract-signature-title" onSubmit={(event) => { event.preventDefault(); sendForSignature.mutate(); }}>
      <header><div><span className="eyebrow">Assinatura eletrônica</span><h2 id="contract-signature-title">Enviar para Autentique</h2><p>Revise o documento e os signatários antes do envio.</p></div><button type="button" className="icon-button" aria-label="Fechar" onClick={() => setSignatureDraft(null)}><X /></button></header>
      <div className="contract-send-facts"><div><span>Cliente</span><strong>{signatureDraft.contract.clientName}</strong></div><div><span>PDF</span><strong>{signatureDraft.contract.contractNumber ?? "Contrato MRL"}.pdf</strong></div><label><span>Ambiente</span><select value={signatureDraft.sandbox ? "sandbox" : "production"} onChange={(event) => setSignatureDraft((current) => current && ({ ...current, sandbox: event.target.value === "sandbox" }))}><option value="sandbox">Sandbox, sem validade jurídica</option><option value="production">Produção</option></select></label></div>
      <label className="field-full">Nome do documento<input value={signatureDraft.documentName} onChange={(event) => setSignatureDraft((current) => current && ({ ...current, documentName: event.target.value }))} required /></label>
      <div className="contract-signers-heading"><div><span className="eyebrow">Signatários</span><strong>{signatureDraft.signers.length} pessoa(s)</strong></div><button type="button" className="secondary-button" onClick={() => setSignatureDraft((current) => current && ({ ...current, signers: [...current.signers, newSigner()] }))}><Plus /> Adicionar signatário</button></div>
      <div className="contract-signer-editor-list">{signatureDraft.signers.map((signer, index) => <fieldset key={signer.key}><legend>Signatário {index + 1}</legend>{signatureDraft.signers.length > 1 && <button type="button" className="contract-remove-signer" aria-label={`Remover signatário ${index + 1}`} onClick={() => setSignatureDraft((current) => current && ({ ...current, signers: current.signers.filter((item) => item.key !== signer.key) }))}><Trash2 /></button>}<div className="form-grid">
        <label>Nome<input value={signer.name} onChange={(event) => updateSigner(signer.key, { name: event.target.value })} required /></label>
        <label>Método<select value={signer.deliveryMethod} onChange={(event) => updateSigner(signer.key, { deliveryMethod: event.target.value as SignerDraft["deliveryMethod"] })}><option value="link">Gerar link</option><option value="email">Enviar por e-mail</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select></label>
        <label>E-mail<input type="email" value={signer.email} onChange={(event) => updateSigner(signer.key, { email: event.target.value })} required={signer.deliveryMethod === "email"} /></label>
        <label>Telefone<input value={signer.phone} onChange={(event) => updateSigner(signer.key, { phone: event.target.value })} placeholder="+5537999999999" required={signer.deliveryMethod === "whatsapp" || signer.deliveryMethod === "sms"} /></label>
        <label>CPF <small>(opcional)</small><input value={signer.cpf} onChange={(event) => updateSigner(signer.key, { cpf: event.target.value })} /></label>
      </div></fieldset>)}</div>
      <div className={`contract-environment-warning ${signatureDraft.sandbox ? "sandbox" : "production"}`}><ShieldCheck /><div><strong>{signatureDraft.sandbox ? "Envio de teste" : "Envio real"}</strong><span>{signatureDraft.sandbox ? "Documentos sandbox são removidos pela Autentique após alguns dias e não têm validade jurídica." : "Este envio pode consumir créditos e criará um documento válido para assinatura."}</span></div></div>
      {sendForSignature.isError && <div className="form-error">{sendForSignature.error.message}</div>}
      <footer><button type="button" className="secondary-button" onClick={() => setSignatureDraft(null)}>Cancelar</button><button className="primary-button" disabled={sendForSignature.isPending}><Send /> {sendForSignature.isPending ? "Enviando PDF..." : "Enviar para Autentique"}</button></footer>
    </form></div>}
  </section>;
}
