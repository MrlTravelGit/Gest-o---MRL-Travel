import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Download, FileCheck2, FileText, Search, ShieldCheck, Sparkles } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/admin/AdminPage";
import { ClientContractsPanel } from "@/components/admin/ClientContractsPanel";
import { parseDecimalPtBr, parseMoneyPtBr } from "@/lib/admin-inputs";
import { calculateInstallment, formatContractCurrency, validateContractDraft } from "@/lib/contracts/contractFormat";
import { openContractDownload } from "@/lib/contracts/downloadContract";
import { getAdminClientManagement } from "@/services/admin-clients";
import { getAdminFormOptions } from "@/services/admin-options";
import { createClientContract } from "@/services/contracts";
import type { ContractDraft } from "@/types/contracts";

function localToday(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function joinAddress(address: Awaited<ReturnType<typeof getAdminClientManagement>>["address"]): string {
  if (!address) return "";
  return [address.street + ", " + address.number, address.complement, address.neighborhood, address.city + "/" + address.state, "CEP " + address.postalCode].filter(Boolean).join(". ");
}

function parseMoneyOrZero(value: string): number {
  try { return value.trim() ? parseMoneyPtBr(value) : 0; } catch { return 0; }
}

export function AdminContractsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState(searchParams.get("clientId") ?? "");
  const management = useQuery({
    queryKey: ["admin-client-management", clientId],
    queryFn: () => getAdminClientManagement(clientId),
    enabled: Boolean(clientId),
  });
  const [clientName, setClientName] = useState("");
  const [cpf, setCpf] = useState("");
  const [rg, setRg] = useState("");
  const [email, setEmail] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [profession, setProfession] = useState("");
  const [fullAddress, setFullAddress] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [installments, setInstallments] = useState("1");
  const [installmentValue, setInstallmentValue] = useState("");
  const [manualInstallment, setManualInstallment] = useState(false);
  const [contractDate, setContractDate] = useState(localToday);
  const [signatureCity, setSignatureCity] = useState("POMPÉU");
  const [includeCashback, setIncludeCashback] = useState(false);
  const [cashbackPercent, setCashbackPercent] = useState("2");
  const [includeRoiGuarantee, setIncludeRoiGuarantee] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!management.data) return;
    const data = management.data;
    setClientName(data.client.fullName);
    setEmail(data.client.email ?? "");
    setFullAddress(joinAddress(data.address));
    setSignatureCity(data.address?.city?.toUpperCase() || "POMPÉU");
    if (data.contract?.contractValue != null) setContractValue(formatContractCurrency(data.contract.contractValue));
  }, [management.data]);

  useEffect(() => {
    if (manualInstallment) return;
    const count = Math.max(1, Number.parseInt(installments, 10) || 1);
    const total = parseMoneyOrZero(contractValue);
    setInstallmentValue(total > 0 ? formatContractCurrency(calculateInstallment(total, count)) : "");
  }, [contractValue, installments, manualInstallment]);

  const filteredClients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (options.data?.clients ?? []).filter((client) => !term || client.fullName.toLocaleLowerCase("pt-BR").includes(term));
  }, [options.data?.clients, search]);

  const draft: ContractDraft = {
    clientId,
    clientName,
    cpf,
    rg,
    email,
    maritalStatus,
    profession,
    fullAddress,
    contractValue: parseMoneyOrZero(contractValue),
    installments: Math.max(1, Number.parseInt(installments, 10) || 1),
    installmentValue: parseMoneyOrZero(installmentValue),
    signatureCity,
    contractDate,
    includeCashback,
    cashbackPercent: (() => { try { return parseDecimalPtBr(cashbackPercent); } catch { return 0; } })(),
    includeRoiGuarantee,
  };
  const cpfDigits = cpf.replace(/\D/g, "");
  const validation = !clientId ? "Selecione um cliente." : validateContractDraft(draft);

  const generate = useMutation({
    mutationFn: () => createClientContract(draft),
    onSuccess: async ({ signedUrl }) => {
      openContractDownload(signedUrl);
      setFeedback("Contrato gerado com sucesso.");
      await queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
  });

  return (
    <AppShell title="Contratos" hideHeading>
      <PageHeader eyebrow="Documentos jurídicos" title="Contratos" description="Gere contratos da MRL Travel com dados dos clientes e mantenha um histórico privado e auditável." />
      <div className="contract-workspace">
        <form className="module-form contract-form" onSubmit={(event) => { event.preventDefault(); if (!validation) generate.mutate(); }}>
          <div className="form-title"><FileText /><div><h2>Novo contrato</h2><p>Revise os dados antes de gerar. O cadastro original não será alterado.</p></div></div>
          <section className="contract-form-section">
            <div className="contract-section-title"><span>01</span><div><h3>Contratante</h3><p>Selecione o cliente e complete os dados jurídicos.</p></div></div>
            <label className="field-full contract-client-search">Buscar cliente<div><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Digite o nome do cliente" /></div></label>
            <label className="field-full">Cliente<select value={clientId} onChange={(event) => {
              const next = event.target.value;
              setClientId(next);
              setSearchParams(next ? { clientId: next } : {});
              setCpf(""); setRg(""); setMaritalStatus(""); setProfession("");
            }}><option value="">Selecione</option>{filteredClients.map((client) => <option value={client.clientId} key={client.clientId}>{client.fullName}</option>)}</select></label>
            {management.isLoading && <div className="field-full contract-inline-note">Carregando cadastro do cliente...</div>}
            <div className="form-grid">
              <label className="field-wide">Nome completo<input value={clientName} onChange={(event) => setClientName(event.target.value)} /></label>
              <label>CPF <small>(opcional)</small><input value={cpf} onChange={(event) => setCpf(event.target.value)} placeholder="000.000.000-00" />{cpfDigits.length > 0 && cpfDigits.length !== 11 && <small className="field-error">Confira o CPF: normalmente são 11 dígitos. A geração continua permitida.</small>}</label>
              <label>RG <small>(opcional)</small><input value={rg} onChange={(event) => setRg(event.target.value)} /></label>
              <label>Estado civil<input value={maritalStatus} onChange={(event) => setMaritalStatus(event.target.value)} /></label>
              <label>Profissão<input value={profession} onChange={(event) => setProfession(event.target.value)} /></label>
              <label className="field-wide">E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label className="field-full">Endereço completo<textarea rows={3} value={fullAddress} onChange={(event) => setFullAddress(event.target.value)} /></label>
            </div>
          </section>

          <section className="contract-form-section">
            <div className="contract-section-title"><span>02</span><div><h3>Condições comerciais</h3><p>O valor da parcela acompanha o total até ser editado manualmente.</p></div></div>
            <div className="form-grid">
              <label>Valor total<input inputMode="decimal" value={contractValue} onChange={(event) => setContractValue(event.target.value)} placeholder="R$ 5.000,00" /></label>
              <label>Número de parcelas<input type="number" min="1" max="120" value={installments} onChange={(event) => setInstallments(event.target.value)} /></label>
              <label>Valor da parcela<input inputMode="decimal" value={installmentValue} onChange={(event) => { setManualInstallment(true); setInstallmentValue(event.target.value); }} /></label>
              <button type="button" className="secondary-button contract-recalculate" onClick={() => { setManualInstallment(false); setInstallmentValue(formatContractCurrency(calculateInstallment(parseMoneyOrZero(contractValue), Math.max(1, Number(installments) || 1)))); }}><Calculator size={15} /> Recalcular</button>
              <label>Data do contrato<input type="date" value={contractDate} onChange={(event) => setContractDate(event.target.value)} /></label>
              <label>Cidade da assinatura<input value={signatureCity} onChange={(event) => setSignatureCity(event.target.value.toUpperCase())} /></label>
            </div>
          </section>

          <section className="contract-form-section">
            <div className="contract-section-title"><span>03</span><div><h3>Cláusulas opcionais</h3><p>A numeração é ajustada automaticamente no PDF.</p></div></div>
            <div className="contract-option-grid">
              <label className={includeCashback ? "selected" : ""}><input type="checkbox" checked={includeCashback} onChange={(event) => setIncludeCashback(event.target.checked)} /><span><strong>Cashback por viagens</strong><small>Benefício sobre serviços contratados via MRL Travel.</small></span></label>
              <label className={includeRoiGuarantee ? "selected" : ""}><input type="checkbox" checked={includeRoiGuarantee} onChange={(event) => setIncludeRoiGuarantee(event.target.checked)} /><span><strong>Garantia de retorno</strong><small>Prevê reembolso da diferença conforme as condições.</small></span></label>
            </div>
            {includeCashback && <label className="contract-percent-field">Percentual de cashback<input inputMode="decimal" value={cashbackPercent} onChange={(event) => setCashbackPercent(event.target.value)} /><span>%</span></label>}
          </section>

          {validation && <div className="contract-validation"><ShieldCheck size={16} /> {validation}</div>}
          {generate.isError && <div className="form-error">{generate.error.message}</div>}
          <button className="primary-button contract-generate-button" disabled={Boolean(validation) || !options.data?.canWrite || generate.isPending}>
            {generate.isPending ? <Sparkles size={17} /> : <FileCheck2 size={17} />} {generate.isPending ? "Gerando PDF..." : "Gerar, salvar e baixar PDF"}
          </button>
        </form>

        <aside className="contract-summary-card">
          <header><span>Prévia operacional</span><FileText /></header>
          <div className="contract-summary-value"><small>Valor do contrato</small><strong>R$ {formatContractCurrency(draft.contractValue)}</strong><span>{draft.installments}x de R$ {formatContractCurrency(draft.installmentValue)}</span></div>
          <dl>
            <div><dt>Contratante</dt><dd>{clientName || "Não selecionado"}</dd></div>
            <div><dt>Assinatura</dt><dd>{signatureCity || "POMPÉU"} · {contractDate}</dd></div>
            <div><dt>Cashback</dt><dd>{includeCashback ? cashbackPercent + "%" : "Não incluído"}</dd></div>
            <div><dt>Garantia</dt><dd>{includeRoiGuarantee ? "Incluída" : "Não incluída"}</dd></div>
          </dl>
          <footer><Download /><span>O PDF é gerado no servidor, salvo no histórico privado e liberado por link temporário.</span></footer>
        </aside>
      </div>
      {feedback && <div className="contract-toast" role="status">{feedback}<button type="button" onClick={() => setFeedback("")}>Fechar</button></div>}
      <ClientContractsPanel />
    </AppShell>
  );
}
