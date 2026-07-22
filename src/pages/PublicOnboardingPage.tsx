import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CopyPlus, ShieldCheck, Trash2 } from "lucide-react";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { maskCepInput, maskCpfInput, onboardingDefaultValues, parseMoneyInput, splitList } from "@/lib/onboarding";
import { getPublicOnboardingMetadata, PublicOnboardingError, savePublicOnboardingDraft, submitPublicOnboarding } from "@/services/onboarding";
import type { OnboardingPayload } from "@/types/onboarding";

const steps = [
  "Informações pessoais",
  "Situação atual",
  "Metas e viagens",
  "Expectativas",
] as const;

const months = [
  ["jan", "Janeiro"], ["feb", "Fevereiro"], ["mar", "Março"], ["apr", "Abril"], ["may", "Maio"], ["jun", "Junho"],
  ["jul", "Julho"], ["aug", "Agosto"], ["sep", "Setembro"], ["oct", "Outubro"], ["nov", "Novembro"], ["dec", "Dezembro"],
] as const;

export function PublicOnboardingPage({ legacy = false }: { legacy?: boolean }) {
  const { token, formKey } = useParams();
  const publicKey = legacy ? token : formKey;
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const metadata = useQuery({
    queryKey: ["public-onboarding", legacy ? "legacy" : "entry", publicKey ? `${publicKey.length}:${publicKey.slice(0, 3)}` : "missing"],
    queryFn: () => getPublicOnboardingMetadata(publicKey!, legacy),
    enabled: Boolean(publicKey),
    retry: false,
  });

  const form = useForm<OnboardingPayload>({
    defaultValues: onboardingDefaultValues,
    mode: "onBlur",
  });

  const pfCards = useFieldArray({ control: form.control, name: "technical.pfCards" });
  const pjCards = useFieldArray({ control: form.control, name: "technical.pjCards" });
  const plannedTrips = useFieldArray({ control: form.control, name: "goals.plannedTrips" });
  const loyaltyAccounts = useFieldArray({ control: form.control, name: "technical.loyaltyAccounts" });

  useEffect(() => {
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.appendChild(referrer);
    return () => referrer.remove();
  }, []);

  const draft = useMutation({ mutationFn: (values: OnboardingPayload) => savePublicOnboardingDraft(publicKey!, values, legacy) });
  const submit = useMutation({
    mutationFn: (values: OnboardingPayload) => submitPublicOnboarding(publicKey!, normalizeForSubmit(values), legacy),
    onSuccess: () => setSubmitted(true),
    onError: (error) => {
      if (error instanceof PublicOnboardingError) {
        const firstField = error.fields[0]?.path;
        setGlobalError(`${error.message}${error.requestId ? ` Código de suporte: ${error.requestId}` : ""}`);
        if (firstField) form.setFocus(firstField as Parameters<typeof form.setFocus>[0]);
        return;
      }
      setGlobalError("Não foi possível enviar agora. Revise os campos e tente novamente.");
    },
  });

  const currentTitle = steps[step];
  const progress = useMemo(() => `${step + 1} de ${steps.length}`, [step]);

  async function nextStep() {
    setGlobalError("");
    const valid = await validateCurrentStep();
    if (!valid) {
      setGlobalError("Revise os campos obrigatórios desta etapa.");
      return;
    }
    if (publicKey) void draft.mutateAsync(form.getValues()).catch(() => undefined);
    setStep((value) => Math.min(value + 1, steps.length - 1));
  }

  async function validateCurrentStep() {
    const fields: Record<number, Array<keyof OnboardingPayload | string>> = {
      0: ["personal.fullName", "personal.cpf", "personal.rg", "personal.birthDate", "personal.email", "personal.whatsapp", "personal.address.postalCode", "personal.address.state", "personal.address.city", "personal.address.neighborhood", "personal.address.street", "personal.address.number", "personal.profession", "personal.referralSource"],
      1: ["technical.bestBank", "technical.pfMonthlySpend", "technical.vipLoungeInterest"],
      2: ["goals.domesticTrips12m", "goals.internationalTrips12m", "goals.businessClassInterest", "goals.seatPriority", "goals.preferredSeat", "goals.allInclusiveInterest"],
      3: ["expectations.priorities", "expectations.serviceExpectations", "expectations.privacyAcknowledged"],
    };
    const baseValid = await form.trigger(fields[step] as Parameters<typeof form.trigger>[0], { shouldFocus: true });
    if (!baseValid) return false;
    if (step === 1) return validateTechnicalRepeatables();
    if (step === 2) return validatePlannedTrips();
    return true;
  }

  function validateTechnicalRepeatables() {
    let valid = true;
    form.getValues("technical.pfCards").forEach((card, index) => {
      if (!card.bank.trim()) {
        form.setError(`technical.pfCards.${index}.bank`, { type: "manual", message: "Informe o banco." });
        valid = false;
      }
      if (!card.brand.trim()) {
        form.setError(`technical.pfCards.${index}.brand`, { type: "manual", message: "Informe a bandeira." });
        valid = false;
      }
      if (!card.product.trim()) {
        form.setError(`technical.pfCards.${index}.product`, { type: "manual", message: "Informe o produto." });
        valid = false;
      }
    });

    if (form.getValues("technical.hasPjCard") && form.getValues("technical.pjCards").length < 1) {
      form.setError("technical.pjCards", { type: "manual", message: "Adicione ao menos um cartão PJ." });
      valid = false;
    }

    form.getValues("technical.pjCards").forEach((card, index) => {
      if (!card.bank.trim()) {
        form.setError(`technical.pjCards.${index}.bank`, { type: "manual", message: "Informe o banco." });
        valid = false;
      }
      if (!card.brand.trim()) {
        form.setError(`technical.pjCards.${index}.brand`, { type: "manual", message: "Informe a bandeira." });
        valid = false;
      }
      if (!card.product.trim()) {
        form.setError(`technical.pjCards.${index}.product`, { type: "manual", message: "Informe o produto." });
        valid = false;
      }
    });

    if (!valid) form.setFocus("technical.bestBank");
    return valid;
  }

  function validatePlannedTrips() {
    if (!form.getValues("goals.hasPlannedTrip")) return true;
    let valid = true;
    const trips = form.getValues("goals.plannedTrips");
    if (trips.length < 1) {
      form.setError("goals.plannedTrips", { type: "manual", message: "Adicione ao menos uma viagem planejada." });
      return false;
    }
    trips.forEach((trip, index) => {
      if (!trip.destination.trim()) {
        form.setError(`goals.plannedTrips.${index}.destination`, { type: "manual", message: "Informe o destino." });
        valid = false;
      }
    });
    if (!valid) form.setFocus("goals.plannedTrips.0.destination");
    return valid;
  }

  if (metadata.isLoading) return <OnboardingShell><div className="onboarding-state">Carregando formulário...</div></OnboardingShell>;
  if (metadata.isError || !publicKey) return <OnboardingShell><Unavailable /></OnboardingShell>;
  if (legacy && metadata.data?.status === "submitted") return <OnboardingShell><Submitted submittedAt={metadata.data?.submittedAt} /></OnboardingShell>;
  if (submitted) return <OnboardingShell><Submitted submittedAt={metadata.data?.submittedAt} /></OnboardingShell>;

  return (
    <OnboardingShell>
      <form className="onboarding-card" onSubmit={form.handleSubmit((values) => submit.mutate(values))}>
        <header className="onboarding-intro">
          <span className="eyebrow">Onboarding</span>
          <h1>Onboarding</h1>
          <p>Este formulário foi criado para entender melhor o seu perfil, suas metas e expectativas. Com essas informações, poderemos oferecer uma gestão personalizada e alinhada à sua realidade.</p>
          <ol>
            <li>Informações pessoais</li>
            <li>Situação atual e informações técnicas</li>
            <li>Metas, viagens e objetivos</li>
            <li>Expectativas em relação ao serviço</li>
          </ol>
          <small>Usaremos os dados apenas para execução e personalização do serviço. A política de privacidade final deve ser validada pela MRL Travel.</small>
        </header>

        <div className="onboarding-progress" aria-label={`Etapa ${progress}`}>
          <span>{progress}</span>
          <strong>{currentTitle}</strong>
          <div><i style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
        </div>

        {globalError && <div className="form-error" role="alert" aria-live="polite">{globalError}</div>}

        {step === 0 && <StepPersonal form={form} />}
        {step === 1 && <StepTechnical form={form} pfCards={pfCards} pjCards={pjCards} loyaltyAccounts={loyaltyAccounts} />}
        {step === 2 && <StepGoals form={form} plannedTrips={plannedTrips} />}
        {step === 3 && <StepExpectations form={form} />}

        {step === 3 && <Review values={form.watch()} />}

        <footer className="onboarding-actions">
          <button type="button" className="secondary-button" disabled={step === 0 || submit.isPending} onClick={() => setStep((value) => Math.max(value - 1, 0))}>Voltar</button>
          {step < steps.length - 1 ? (
            <button type="button" className="primary-button" onClick={() => void nextStep()}>Continuar</button>
          ) : (
            <button className="primary-button" disabled={submit.isPending}>{submit.isPending ? "Enviando..." : "Enviar onboarding"}</button>
          )}
        </footer>
      </form>
    </OnboardingShell>
  );
}

function StepPersonal({ form }: { form: ReturnType<typeof useForm<OnboardingPayload>> }) {
  const hasChildren = form.watch("personal.hasChildren");
  return <section className="onboarding-step"><h2>Informações pessoais</h2><div className="onboarding-grid">
    <Field label="Nome completo"><input autoComplete="name" {...form.register("personal.fullName", { required: true, minLength: 3 })} /></Field>
    <Field label="CPF"><input inputMode="numeric" autoComplete="off" {...form.register("personal.cpf", { required: true, onChange: (event) => { event.target.value = maskCpfInput(event.target.value); } })} /></Field>
    <Field label="RG"><input autoComplete="off" {...form.register("personal.rg", { required: true })} /></Field>
    <Field label="Data de nascimento"><input type="date" max={new Date().toISOString().slice(0, 10)} {...form.register("personal.birthDate", { required: true })} /></Field>
    <Field label="E-mail"><input type="email" autoComplete="email" {...form.register("personal.email", { required: true })} /></Field>
    <Field label="WhatsApp"><input inputMode="tel" autoComplete="tel" {...form.register("personal.whatsapp", { required: true })} /></Field>
    <Field label="Estado civil"><select {...form.register("personal.maritalStatus")}><option value="single">Solteiro(a)</option><option value="married">Casado(a)</option><option value="stable_union">União estável</option><option value="divorced">Divorciado(a)</option><option value="widowed">Viúvo(a)</option><option value="prefer_not_to_say">Prefiro não informar</option></select></Field>
    <Field label="CEP"><input inputMode="numeric" {...form.register("personal.address.postalCode", { required: true, onChange: (event) => { event.target.value = maskCepInput(event.target.value); } })} /></Field>
    <Field label="UF"><input maxLength={2} {...form.register("personal.address.state", { required: true })} /></Field>
    <Field label="Cidade"><input {...form.register("personal.address.city", { required: true })} /></Field>
    <Field label="Bairro"><input {...form.register("personal.address.neighborhood", { required: true })} /></Field>
    <Field label="Rua"><input {...form.register("personal.address.street", { required: true })} /></Field>
    <Field label="Número"><input {...form.register("personal.address.number", { required: true })} /></Field>
    <Field label="Complemento"><input {...form.register("personal.address.complement")} /></Field>
    <label className="check-field"><input type="checkbox" {...form.register("personal.hasChildren")} /> Tem filhos que moram com você?</label>
    {hasChildren && <Field label="Quantidade de filhos"><input type="number" min={1} {...form.register("personal.childrenCount", { valueAsNumber: true })} /></Field>}
    {hasChildren && <Field label="Observação sobre filhos"><input {...form.register("personal.childrenNotes")} /></Field>}
    <Field label="Profissão"><input {...form.register("personal.profession", { required: true })} /></Field>
    <Field label="Ramo das empresas"><input {...form.register("personal.businessSector")} /></Field>
    <Field label="Melhor período para contato"><select {...form.register("personal.preferredContactPeriod")}><option value="morning">Manhã</option><option value="afternoon">Tarde</option><option value="night">Noite</option><option value="custom">Horário específico</option></select></Field>
    <Field label="Horário preferencial"><input {...form.register("personal.preferredContactTime")} /></Field>
    <Field label="Como conheceu a MRL Travel?"><select {...form.register("personal.referralSource", { required: true })}><option value="">Selecione</option><option value="instagram">Instagram</option><option value="indication">Indicação</option><option value="event">Evento</option><option value="client">Cliente MRL</option><option value="other">Outro</option></select></Field>
    <Field label="Outro canal"><input {...form.register("personal.referralOther")} /></Field>
  </div></section>;
}

function StepTechnical({ form, pfCards, pjCards, loyaltyAccounts }: { form: ReturnType<typeof useForm<OnboardingPayload>>; pfCards: ReturnType<typeof useFieldArray<OnboardingPayload, "technical.pfCards">>; pjCards: ReturnType<typeof useFieldArray<OnboardingPayload, "technical.pjCards">>; loyaltyAccounts: ReturnType<typeof useFieldArray<OnboardingPayload, "technical.loyaltyAccounts">> }) {
  const hasPj = form.watch("technical.hasPjCard");
  return <section className="onboarding-step"><h2>Situação atual e informações técnicas</h2><div className="onboarding-grid">
    <Field label="Banco com melhor relacionamento"><input {...form.register("technical.bestBank", { required: true })} /></Field>
    <Field label="Gasto total mensal nos cartões PF"><MoneyInput onValue={(value) => form.setValue("technical.pfMonthlySpend", value)} /></Field>
    <Field label="Interesse em Sala VIP"><select {...form.register("technical.vipLoungeInterest")}><option value="yes">Sim</option><option value="no">Não</option><option value="want_to_understand">Quero entender melhor</option></select></Field>
    <Field label="Uber mensal"><MoneyInput onValue={(value) => form.setValue("technical.uberMonthlySpend", value)} /></Field>
    <Field label="iFood mensal"><MoneyInput onValue={(value) => form.setValue("technical.ifoodMonthlySpend", value)} /></Field>
    <Field label="Combustível mensal"><MoneyInput onValue={(value) => form.setValue("technical.fuelMonthlySpend", value)} /></Field>
  </div><Repeatable title="Cartões Pessoa Física" addLabel="Adicionar cartão" onAdd={() => pfCards.append({ bank: "", brand: "", product: "", paysAnnualFee: false, annualFeeMonthly: 0 })}>{pfCards.fields.map((field, index) => <CardFields key={field.id} prefix={`technical.pfCards.${index}`} form={form} onRemove={() => pfCards.remove(index)} withFee />)}</Repeatable>
  <label className="check-field"><input type="checkbox" {...form.register("technical.hasPjCard")} /> Possui cartão Pessoa Jurídica?</label>
  {hasPj && <><Field label="Gasto mensal total PJ"><MoneyInput onValue={(value) => form.setValue("technical.pjMonthlySpend", value)} /></Field><Repeatable title="Cartões Pessoa Jurídica" addLabel="Adicionar cartão PJ" onAdd={() => pjCards.append({ bank: "", brand: "", product: "" })}>{pjCards.fields.map((field, index) => <CardFields key={field.id} prefix={`technical.pjCards.${index}`} form={form} onRemove={() => pjCards.remove(index)} />)}</Repeatable></>}
  <div className="privacy-note"><ShieldCheck size={17}/> Não solicitamos login, senha, número de cartão, CVV ou fotos de cartões/programas.</div>
  <Repeatable title="Programas de fidelidade declaratórios" addLabel="Adicionar programa" onAdd={() => loyaltyAccounts.append({ program: "Outro", hasAccount: false, declaredPoints: 0, notes: "" })}>{loyaltyAccounts.fields.map((field, index) => <div className="repeat-row" key={field.id}><Field label="Programa"><select {...form.register(`technical.loyaltyAccounts.${index}.program`)}><option>Smiles</option><option>Azul Fidelidade</option><option>LATAM Pass</option><option>Livelo</option><option>Esfera</option><option>Outro</option></select></Field><label className="check-field"><input type="checkbox" {...form.register(`technical.loyaltyAccounts.${index}.hasAccount`)} /> Possui conta?</label><Field label="Pontuação declarada"><input type="number" min={0} {...form.register(`technical.loyaltyAccounts.${index}.declaredPoints`, { valueAsNumber: true })} /></Field><Field label="Observação"><input {...form.register(`technical.loyaltyAccounts.${index}.notes`)} /></Field><button type="button" className="icon-button" onClick={() => loyaltyAccounts.remove(index)}><Trash2 size={15}/> Remover</button></div>)}</Repeatable>
  </section>;
}

function StepGoals({ form, plannedTrips }: { form: ReturnType<typeof useForm<OnboardingPayload>>; plannedTrips: ReturnType<typeof useFieldArray<OnboardingPayload, "goals.plannedTrips">> }) {
  const hasPlannedTrip = form.watch("goals.hasPlannedTrip");
  return <section className="onboarding-step"><h2>Metas, viagens e objetivos</h2><div className="onboarding-grid">
    <Field label="Aeroportos próximos/preferidos"><textarea onBlur={(e) => form.setValue("goals.preferredAirports", splitList(e.target.value))} placeholder="Ex.: GRU, CGH, VCP" /></Field>
    <Field label="Viagens nacionais nos próximos 12 meses"><input type="number" min={0} {...form.register("goals.domesticTrips12m", { valueAsNumber: true })} /></Field>
    <Field label="Viagens internacionais nos próximos 12 meses"><input type="number" min={0} {...form.register("goals.internationalTrips12m", { valueAsNumber: true })} /></Field>
    <label className="check-field"><input type="checkbox" {...form.register("goals.hasPlannedTrip")} /> Possui viagem planejada sem passagem comprada?</label>
    <Field label="Destinos nacionais frequentes"><textarea onBlur={(e) => form.setValue("goals.frequentNationalDestinations", splitList(e.target.value))} /></Field>
    <Field label="Destinos que deseja conhecer"><textarea onBlur={(e) => form.setValue("goals.desiredDestinations", splitList(e.target.value))} /></Field>
    <Field label="Classe executiva"><select {...form.register("goals.businessClassInterest")}><option value="yes">Sim</option><option value="no">Não</option><option value="depending">Dependendo da oportunidade</option></select></Field>
    <Field label="Prioridade de assentos"><select {...form.register("goals.seatPriority")}><option value="lowest_price">Menor preço</option><option value="together">Passageiros juntos</option><option value="more_space">Mais espaço</option><option value="front">Proximidade da frente</option><option value="other">Outro</option></select></Field>
    <Field label="Tipo de assento"><select {...form.register("goals.preferredSeat")}><option value="window">Janela</option><option value="aisle">Corredor</option><option value="indifferent">Indiferente</option><option value="extra_space">Saída/mais espaço</option></select></Field>
    <Field label="Resorts all-inclusive"><select {...form.register("goals.allInclusiveInterest")}><option value="yes">Sim</option><option value="no">Não</option><option value="maybe">Talvez</option></select></Field>
  </div>{hasPlannedTrip && <Repeatable title="Viagens planejadas" addLabel="Adicionar viagem" onAdd={() => plannedTrips.append({ destination: "", approximateDate: "", notes: "" })}>{plannedTrips.fields.map((field, index) => <div className="repeat-row" key={field.id}><Field label="Destino"><input {...form.register(`goals.plannedTrips.${index}.destination`)} /></Field><Field label="Data aproximada"><input {...form.register(`goals.plannedTrips.${index}.approximateDate`)} /></Field><Field label="Observação"><input {...form.register(`goals.plannedTrips.${index}.notes`)} /></Field><button type="button" className="icon-button" onClick={() => plannedTrips.remove(index)}><Trash2 size={15}/> Remover</button></div>)}</Repeatable>}
  <CheckboxGroup title="Meses livres para viajar" options={months.map(([value, label]) => ({ value, label }))} selected={form.watch("goals.freeMonths")} onChange={(values) => form.setValue("goals.freeMonths", values)} />
  <CheckboxGroup title="Como comprava passagens antes?" options={[["airline_site","Site da companhia"],["agency","Agência"],["app","Aplicativo"],["comparator","Comparador"],["miles","Milhas"],["other","Outro"]].map(([value,label])=>({value,label}))} selected={form.watch("goals.previousTicketPurchaseMethods")} onChange={(values) => form.setValue("goals.previousTicketPurchaseMethods", values)} />
  </section>;
}

function StepExpectations({ form }: { form: ReturnType<typeof useForm<OnboardingPayload>> }) {
  const expectations = form.watch("expectations.serviceExpectations") || "";
  return <section className="onboarding-step"><h2>Expectativas</h2>
    <CheckboxGroup title="O que é mais importante para você?" options={[["savings","Economia"],["comfort","Conforto"],["convenience","Conveniência"],["flexibility","Flexibilidade"],["service","Atendimento"],["travel_support","Suporte durante a viagem"],["benefits","Benefícios"],["travel_more","Viajar mais"],["other","Outro"]].map(([value,label])=>({value,label}))} selected={form.watch("expectations.priorities")} onChange={(values) => form.setValue("expectations.priorities", values, { shouldValidate: true })} />
    <Field label="O que você espera do nosso serviço?"><textarea maxLength={2000} {...form.register("expectations.serviceExpectations", { required: true, minLength: 20 })} /><small>{expectations.length}/2000 caracteres</small></Field>
    <label className="check-field required"><input type="checkbox" {...form.register("expectations.privacyAcknowledged", { required: true })} /> Estou ciente da finalidade da coleta para execução do serviço de gestão MRL Travel.</label>
    <label className="check-field"><input type="checkbox" {...form.register("expectations.marketingConsent")} /> Aceito receber comunicações de marketing separadas do serviço.</label>
  </section>;
}

function CardFields({ form, prefix, onRemove, withFee = false }: { form: ReturnType<typeof useForm<OnboardingPayload>>; prefix: string; onRemove: () => void; withFee?: boolean }) {
  const paysFee = withFee ? form.watch(`${prefix}.paysAnnualFee` as never) : false;
  return <div className="repeat-row"><Field label="Banco/emissor"><input {...form.register(`${prefix}.bank` as never)} /></Field><Field label="Bandeira"><input {...form.register(`${prefix}.brand` as never)} /></Field><Field label="Categoria/produto"><input {...form.register(`${prefix}.product` as never)} /></Field>{withFee && <label className="check-field"><input type="checkbox" {...form.register(`${prefix}.paysAnnualFee` as never)} /> Paga anuidade?</label>}{withFee && paysFee && <Field label="Anuidade mensal"><MoneyInput onValue={(value) => form.setValue(`${prefix}.annualFeeMonthly` as never, value as never)} /></Field>}<button type="button" className="icon-button" onClick={onRemove}><Trash2 size={15}/> Remover</button></div>;
}

function Review({ values }: { values: OnboardingPayload }) {
  return <section className="onboarding-review"><h2>Revisão antes do envio</h2><div><strong>{values.personal.fullName || "Nome não informado"}</strong><span>{values.personal.email}</span><span>{values.technical.pfCards.length} cartão(ões) PF · {values.technical.loyaltyAccounts.length} programa(s)</span><span>{values.goals.plannedTrips.length} viagem(ns) planejada(s)</span></div><p>Confira as informações antes de enviar. Após o envio, a equipe MRL Travel poderá revisar divergências sem alterar automaticamente dados administrativos já existentes.</p></section>;
}

function OnboardingShell({ children }: { children: React.ReactNode }) {
  return <main className="onboarding-page"><div className="onboarding-brand"><BrandLogo size="large" /></div>{children}</main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="onboarding-field"><span>{label}</span>{children}</label>;
}

function Repeatable({ title, addLabel, onAdd, children }: { title: string; addLabel: string; onAdd: () => void; children: React.ReactNode }) {
  return <section className="repeatable-group"><div><h3>{title}</h3><button type="button" className="secondary-button" onClick={onAdd}><CopyPlus size={15}/> {addLabel}</button></div>{children}</section>;
}

function MoneyInput({ onValue }: { onValue: (value: number) => void }) {
  return <input inputMode="decimal" placeholder="0,00" onBlur={(event) => onValue(parseMoneyInput(event.target.value))} />;
}

function CheckboxGroup({ title, options, selected, onChange }: { title: string; options: Array<{ value: string; label: string }>; selected: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="checkbox-group"><legend>{title}</legend>{options.map((option) => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))} /> {option.label}</label>)}</fieldset>;
}

function Unavailable() {
  return <div className="onboarding-state error-state"><AlertTriangle/><h1>Onboarding indisponível</h1><p>Solicite um novo link à equipe MRL Travel.</p></div>;
}

function Submitted({ submittedAt }: { submittedAt?: string | null }) {
  return <div className="onboarding-state success-state"><CheckCircle2/><h1>Onboarding recebido</h1><p>Obrigado. Suas respostas foram recebidas pela equipe MRL Travel{submittedAt ? ` em ${new Date(submittedAt).toLocaleDateString("pt-BR")}` : ""}.</p></div>;
}

function normalizeForSubmit(values: OnboardingPayload): OnboardingPayload {
  return {
    ...values,
    personal: { ...values.personal, cpf: values.personal.cpf.replace(/\D/g, ""), whatsappE164: values.personal.whatsapp },
  };
}
