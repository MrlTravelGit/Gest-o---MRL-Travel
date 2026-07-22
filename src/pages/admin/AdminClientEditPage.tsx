import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarRange, CheckCircle2, Copy, ExternalLink, FileKey2, RotateCw, Save, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate, formatPoints } from "@/lib/formatters";
import { openClientPanel, validateClientPanelUrl } from "@/lib/client-panel-link";
import { clientStatusLabel, contractDatesAreValid, requiresContractChangeReason } from "@/lib/client-admin";
import { getAdminClientManagement, updateClientContract, updateClientProfile } from "@/services/admin-clients";
import { getDirectAccessLink, registerDirectAccessCopy, revokeDirectAccessLink, rotateDirectAccessLink } from "@/services/direct-access";
import type { AdminClientManagement } from "@/types/admin-clients";

const emptyAddress = { postalCode: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "", countryCode: "BR" };

export function AdminClientEditPage() {
  const { clientId } = useParams();
  const query = useQuery({ queryKey: ["admin-client-management",clientId], queryFn:()=>getAdminClientManagement(clientId!),enabled:Boolean(clientId) });
  if (!clientId) return <Navigate to="/admin/clientes" replace />;
  return <AppShell title={query.data?.client.fullName ?? "Editar cadastro"} subtitle="Dados pessoais, situação, contrato e acesso">
    {query.isLoading&&<div className="panel-state">Carregando cadastro completo...</div>}
    {query.isError&&<div className="panel-state error-state">{query.error.message}</div>}
    {query.data&&<ClientEditWorkspace key={`${query.data.client.rowVersion}-${query.data.contract?.updatedAt??"new"}`} data={query.data}/>} 
  </AppShell>;
}

function ClientEditWorkspace({data}:{data:AdminClientManagement}) {
  const qc=useQueryClient();
  const client=data.client;
  const isActive=client.status==="active";
  const today=new Date().toISOString().slice(0,10);
  const hasActiveContract=Boolean(data.contract&&data.contract.status==="active"&&data.contract.startsOn<=today&&(!data.contract.endsOn||data.contract.endsOn>=today));
  const contractPending=isActive&&(client.contractReviewStatus==="pending_review"||!hasActiveContract);
  const [message,setMessage]=useState("");
  const [profile,setProfile]=useState({
    fullName:client.fullName,displayName:client.displayName??"",documentNumber:"",birthDate:client.birthDate??"",email:client.email??"",phone:client.phone??"",whatsapp:client.whatsapp??"",notes:client.notes??"",
    address:{...emptyAddress,...(data.address??{})},
  });
  const [contract,setContract]=useState({
    startsOn:data.contract?.startsOn??"",endsOn:data.contract?.endsOn??"",planName:data.contract?.planName??"Gestão MRL Travel",contractValue:data.contract?.contractValue==null?"":String(data.contract.contractValue),status:data.contract?.status??"active",autoRenew:data.contract?.autoRenew??false,notes:data.contract?.notes??"",reason:"",
  });
  const hasAddress=Boolean(data.address)||Object.entries(profile.address).some(([key,value])=>key!=="countryCode"&&Boolean(value));
  const invalidate=async()=>Promise.all([qc.invalidateQueries({queryKey:["admin-client-management",client.clientId]}),qc.invalidateQueries({queryKey:["admin-client-detail",client.clientId]}),qc.invalidateQueries({queryKey:["admin-clients"]}),qc.invalidateQueries({queryKey:["admin-overview"]})]);
  const profileMutation=useMutation({mutationFn:updateClientProfile,onSuccess:async(result)=>{setMessage(`Cadastro atualizado. ${result.changedFields.length} campo(s) auditado(s).`);await invalidate();}});
  const contractMutation=useMutation({mutationFn:updateClientContract,onSuccess:async()=>{setMessage("Contrato atualizado com histórico preservado.");await invalidate();}});
  const directLink=useQuery({queryKey:["direct-access-link",client.clientId],queryFn:()=>getDirectAccessLink(client.clientId),enabled:client.status!=="lead"});
  const rotate=useMutation({mutationFn:()=>rotateDirectAccessLink({clientId:client.clientId,notes:"Rotação explícita na edição administrativa"}),onSuccess:()=>qc.invalidateQueries({queryKey:["direct-access-link",client.clientId]})});
  const revoke=useMutation({mutationFn:(id:string)=>revokeDirectAccessLink(id,"Revogado explicitamente na edição administrativa."),onSuccess:()=>qc.invalidateQueries({queryKey:["direct-access-link",client.clientId]})});
  const contractDatesChanged=requiresContractChangeReason(data.contract?{startsOn:data.contract.startsOn,endsOn:data.contract.endsOn}:null,{startsOn:contract.startsOn,endsOn:contract.endsOn||null});
  const statusLabel=clientStatusLabel(client.status);
  const sourceLabel={manual:"Manual",onboarding:"Onboarding",notion:"Notion",iddas:"Iddas",other:"Outra"}[client.registrationSource]??client.registrationSource;

  useEffect(()=>{
    if(window.location.hash!=="#contrato") return;
    window.requestAnimationFrame(()=>document.getElementById("contrato")?.scrollIntoView({behavior:"smooth",block:"start"}));
  },[]);

  function submitProfile(event:FormEvent){
    event.preventDefault();setMessage("");
    profileMutation.mutate({clientId:client.clientId,expectedVersion:client.rowVersion,fullName:profile.fullName.trim(),displayName:profile.displayName.trim()||null,documentNumber:profile.documentNumber.replace(/\D/g,"")||null,birthDate:profile.birthDate||null,email:profile.email.trim().toLowerCase()||null,phone:profile.phone.trim()||null,whatsapp:profile.whatsapp.trim()||null,notes:profile.notes.trim()||null,address:hasAddress?{...profile.address,complement:profile.address.complement||null}:null});
  }
  function submitContract(event:FormEvent){
    event.preventDefault();setMessage("");
    if(!contract.startsOn){setMessage("Informe a data inicial do contrato.");return;}
    if(!contractDatesAreValid(contract.startsOn,contract.endsOn)){setMessage("O término não pode ser anterior ao início.");return;}
    if(contractDatesChanged&&contract.reason.trim().length<5){setMessage("Informe o motivo da alteração da vigência.");return;}
    contractMutation.mutate({clientId:client.clientId,contractId:data.contract?.contractId??null,startsOn:contract.startsOn,endsOn:contract.endsOn||null,planName:contract.planName.trim()||null,contractValue:contract.contractValue===""?null:Number(contract.contractValue),status:contract.status,autoRenew:contract.autoRenew,notes:contract.notes.trim()||null,reason:contract.reason.trim()||null,expectedClientVersion:client.rowVersion,expectedContractUpdatedAt:data.contract?.updatedAt??null});
  }

  return <div className="client-edit-workspace">
    <aside className="client-edit-rail">
      <Link className="secondary-button" to={`/admin/clientes/${client.clientId}`}><ArrowLeft size={16}/> Voltar ao cliente</Link>
      <div className="client-edit-identity"><span>{(client.displayName||client.fullName).slice(0,2).toUpperCase()}</span><strong>{client.fullName}</strong><small>{statusLabel}</small></div>
      <nav aria-label="Seções da edição"><a href="#dados">Dados principais</a><a href="#situacao">Situação</a><a href="#contrato">Contrato</a><a href="#acesso">Acesso</a><a href="#financeiro">Financeiro</a></nav>
    </aside>
    <main className="client-edit-main">
      <section id="dados" className="client-edit-card">
        <header><UserRound/><div><span className="eyebrow">Identidade administrativa</span><h2>Dados principais</h2><p>Dados privados, nunca exibidos no dashboard público.</p></div></header>
        <form onSubmit={submitProfile} className="form-grid">
          <label className="field-wide">Nome completo ou razão social<input value={profile.fullName} onChange={e=>setProfile({...profile,fullName:e.target.value})} required minLength={2}/></label>
          <label>Nome de exibição<input value={profile.displayName} onChange={e=>setProfile({...profile,displayName:e.target.value})}/></label>
          <label>CPF ou CNPJ<input inputMode="numeric" value={profile.documentNumber} onChange={e=>setProfile({...profile,documentNumber:e.target.value})} placeholder={client.documentMasked??"Informe apenas para cadastrar ou substituir"}/><small>{client.documentMasked?`Atual: ${client.documentMasked}`:"Nenhum documento protegido cadastrado"}</small></label>
          <label>Data de nascimento<input type="date" value={profile.birthDate} onChange={e=>setProfile({...profile,birthDate:e.target.value})}/></label>
          <label>E-mail<input type="email" value={profile.email} onChange={e=>setProfile({...profile,email:e.target.value})}/></label>
          <label>Telefone<input placeholder="+5537999999999" value={profile.phone} onChange={e=>setProfile({...profile,phone:e.target.value})}/></label>
          <label>WhatsApp<input placeholder="+5537999999999" value={profile.whatsapp} onChange={e=>setProfile({...profile,whatsapp:e.target.value})}/></label>
          <label>CEP<input value={profile.address.postalCode} onChange={e=>setProfile({...profile,address:{...profile.address,postalCode:e.target.value}})}/></label>
          <label className="field-wide">Logradouro<input value={profile.address.street} onChange={e=>setProfile({...profile,address:{...profile.address,street:e.target.value}})}/></label>
          <label>Número<input value={profile.address.number} onChange={e=>setProfile({...profile,address:{...profile.address,number:e.target.value}})}/></label>
          <label>Complemento<input value={profile.address.complement??""} onChange={e=>setProfile({...profile,address:{...profile.address,complement:e.target.value}})}/></label>
          <label>Bairro<input value={profile.address.neighborhood} onChange={e=>setProfile({...profile,address:{...profile.address,neighborhood:e.target.value}})}/></label>
          <label>Cidade<input value={profile.address.city} onChange={e=>setProfile({...profile,address:{...profile.address,city:e.target.value}})}/></label>
          <label>Estado<input value={profile.address.state} onChange={e=>setProfile({...profile,address:{...profile.address,state:e.target.value.toUpperCase()}})}/></label>
          <label>País<input value={profile.address.countryCode} maxLength={2} onChange={e=>setProfile({...profile,address:{...profile.address,countryCode:e.target.value.toUpperCase()}})}/></label>
          <label className="field-full">Observações internas<textarea rows={4} value={profile.notes} onChange={e=>setProfile({...profile,notes:e.target.value})}/></label>
          <div className="field-full form-actions"><button className="primary-button" disabled={!data.canEdit||profileMutation.isPending}><Save size={16}/>{profileMutation.isPending?"Salvando...":"Salvar cadastro"}</button></div>
        </form>
        {profileMutation.isError&&<div className="form-error">{profileMutation.error.message}</div>}
      </section>

      <section id="situacao" className="client-edit-card compact-card">
        <header><ShieldCheck/><div><span className="eyebrow">Estado operacional</span><h2>Situação do cliente</h2></div></header>
        <div className="situation-grid"><Info label="Status atual" value={statusLabel}/><Info label="Origem" value={sourceLabel}/><Info label="Cadastro" value={formatDate(client.createdAt)}/><Info label="Ativação" value={formatDate(client.activatedAt)}/><Info label="Arquivamento" value={formatDate(client.archivedAt)}/><Info label="Revisão contratual" value={contractPending?"Contrato pendente de revisão":"Concluída"}/></div>
        {client.archiveReason&&<p className="archive-note">Motivo do arquivamento: {client.archiveReason}</p>}
        <p className="helper-text">Mudanças de status usam ações próprias no detalhe ou na lista; este formulário não contorna as confirmações.</p>
      </section>

      <section id="contrato" className="client-edit-card">
        <header><CalendarRange/><div><span className="eyebrow">Vigência auditável</span><h2>Contrato</h2><p>Datas anteriores permanecem na auditoria. O término pode ficar vazio para prazo indeterminado.</p></div></header>
        {contractPending&&<div className="contract-review-warning">Contrato pendente de revisão — nenhuma data foi inventada para este cliente.</div>}
        <form onSubmit={submitContract} className="form-grid">
          <label>Início<input type="date" value={contract.startsOn} onChange={e=>setContract({...contract,startsOn:e.target.value})} required/></label>
          <label>Término<input type="date" min={contract.startsOn} value={contract.endsOn} onChange={e=>setContract({...contract,endsOn:e.target.value})}/><small>Vazio = prazo indeterminado</small></label>
          <label className="field-wide">Plano<input value={contract.planName} onChange={e=>setContract({...contract,planName:e.target.value})}/></label>
          <label>Valor contratual<input type="number" min="0" step="0.01" value={contract.contractValue} onChange={e=>setContract({...contract,contractValue:e.target.value})}/></label>
          <label>Situação<select value={contract.status} onChange={e=>setContract({...contract,status:e.target.value})}><option value="draft">Rascunho</option><option value="active">Ativo</option><option value="paused">Pausado</option><option value="ended">Encerrado</option><option value="cancelled">Cancelado</option></select></label>
          <label className="check-field"><input type="checkbox" checked={contract.autoRenew} onChange={e=>setContract({...contract,autoRenew:e.target.checked})}/> Renovação automática</label>
          <label className="field-full">Observações do contrato<textarea rows={3} value={contract.notes} onChange={e=>setContract({...contract,notes:e.target.value})}/></label>
          <label className="field-full">Motivo da alteração {contractDatesChanged&&"*"}<textarea rows={2} value={contract.reason} onChange={e=>setContract({...contract,reason:e.target.value})} placeholder="Obrigatório ao corrigir início ou término já salvos"/></label>
          <div className="field-full form-actions"><button className="primary-button" disabled={!data.canEdit||contractMutation.isPending}><Save size={16}/>{contractMutation.isPending?"Salvando...":"Salvar contrato"}</button></div>
        </form>
        {contractMutation.isError&&<div className="form-error">{contractMutation.error.message}</div>}
      </section>

      <section id="acesso" className="client-edit-card compact-card">
        <header><FileKey2/><div><span className="eyebrow">Token bearer protegido</span><h2>Acesso ao painel</h2><p>Editar cadastro ou contrato não gera, rotaciona nem revoga o link.</p></div></header>
        {contractPending&&<div className="contract-review-warning contract-review-callout"><CalendarRange size={18}/><div><strong>Contrato pendente de revisão</strong><span>Isso não bloqueia o painel público de leitura.</span></div><a className="contract-review-action" href="#contrato">Cadastrar vigência</a></div>}
        {!isActive&&<div className="lead-operation-lock"><ShieldCheck size={18}/>{client.status==="lead"?"Ative o cliente para gerar o link público.":"Reative o cliente para gerar, copiar ou abrir o painel público."}</div>}
        <div className="copy-box"><input className="copy-input" readOnly value={isActive?directLink.data?.url??"":""} placeholder={!isActive?"Disponível somente para cliente ativo":directLink.isLoading?"Carregando link...":"Nenhum link recuperável"}/><button className="secondary-button" type="button" disabled={!isActive||!directLink.data?.url} onClick={()=>{const result=openClientPanel(directLink.data?.url);if(!result.opened)setMessage(result.message);}}><ExternalLink size={15}/> Abrir</button></div>
        <div className="economy-admin-actions"><button type="button" className="secondary-button" disabled={!data.canEdit||rotate.isPending||!isActive} onClick={()=>rotate.mutate()}><RotateCw size={15}/>{directLink.data?.hasActiveLink?"Rotacionar link":"Gerar link"}</button><button type="button" className="secondary-button" disabled={!isActive||!directLink.data?.url} onClick={async()=>{const url=validateClientPanelUrl(directLink.data?.url);await navigator.clipboard.writeText(url);if(directLink.data?.linkId)await registerDirectAccessCopy(directLink.data.linkId);setMessage("Link copiado.");}}><Copy size={15}/> Copiar</button><button type="button" className="danger-button" disabled={!data.canEdit||!directLink.data?.linkId||revoke.isPending} onClick={()=>{if(directLink.data?.linkId&&confirm("Revogar o link atual?"))revoke.mutate(directLink.data.linkId);}}>Revogar</button></div>
      </section>

      <section id="financeiro" className="client-edit-card compact-card">
        <header><WalletCards/><div><span className="eyebrow">Somente leitura</span><h2>Informações financeiras</h2><p>Esta edição nunca grava totais nem substitui o ledger.</p></div></header>
        <div className="financial-lock-grid"><Info label="Pontos preservados" value={formatPoints(data.financial.points)}/><Info label="Programas vinculados" value={String(data.financial.programs)}/><Info label="Ajustes de saldo" value="Somente movimentações"/></div>
      </section>
      {(message||rotate.isError||revoke.isError)&&<div className={rotate.isError||revoke.isError?"form-error sticky-feedback":"form-success sticky-feedback"}><CheckCircle2 size={16}/>{message||rotate.error?.message||revoke.error?.message}</div>}
    </main>
  </div>;
}

function Info({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{value}</strong></div>;}
