import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, FileText, Home, UserRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { getAppOriginStatus } from "@/lib/app-origin";
import { env } from "@/lib/env";
import { createClient } from "@/services/admin";
import { getAdminOverview } from "@/services/dashboard";

const today = new Date().toISOString().slice(0, 10);
const nextYear = (() => { const date = new Date(); date.setFullYear(date.getFullYear() + 1); return date.toISOString().slice(0, 10); })();
const schema = z.object({
  fullName: z.string().trim().min(3, "Informe o nome completo").max(160), birthDate: z.string().min(1, "Informe a data").refine((value) => value <= today, "A data não pode estar no futuro"),
  email: z.string().trim().email("E-mail inválido"), phone: z.string().trim().refine((value) => !value || /^\+[1-9][0-9]{7,14}$/.test(value), "Use o formato +5537999999999"), accessChannel: z.enum(["email", "phone"]),
  postalCode: z.string().trim().min(3).max(16), street: z.string().trim().min(2).max(160), number: z.string().trim().min(1).max(30), complement: z.string().trim().max(120), neighborhood: z.string().trim().min(2).max(100), city: z.string().trim().min(2).max(100), state: z.string().trim().regex(/^[A-Za-z]{2}$/, "Informe a UF com duas letras"), countryCode: z.string().trim().length(2),
  notes: z.string().trim().max(2000), startsOn: z.string().min(1), endsOn: z.string().min(1), planName: z.string().trim().max(120),
}).refine((value) => value.endsOn >= value.startsOn, { path: ["endsOn"], message: "O término deve ser posterior ao início" }).refine((value) => value.accessChannel !== "phone" || Boolean(value.phone), { path: ["phone"], message: "Informe o telefone para usar SMS" });
type FormData = z.infer<typeof schema>;

export function AdminCreateClientPage() {
  const origin = getAppOriginStatus(window.location.origin, env.VITE_APP_URL);
  const permissions = useQuery({ queryKey: ["admin-overview"], queryFn: getAdminOverview });
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { fullName: "", birthDate: "", email: "", phone: "", accessChannel: "email", postalCode: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "", countryCode: "BR", notes: "", startsOn: today, endsOn: nextYear, planName: "Gestão MRL Travel" } });
  const mutation = useMutation({ mutationFn: createClient });
  const submit = form.handleSubmit((values) => { if (!origin.isCanonical) return; mutation.mutate({ fullName: values.fullName, birthDate: values.birthDate, email: values.email.toLowerCase(), phone: values.phone || undefined, accessChannel: values.accessChannel, startsOn: values.startsOn, endsOn: values.endsOn, planName: values.planName || undefined, notes: values.notes || undefined, address: { postalCode: values.postalCode, street: values.street, number: values.number, complement: values.complement || undefined, neighborhood: values.neighborhood, city: values.city, state: values.state.toUpperCase(), countryCode: values.countryCode.toUpperCase() } }); });
  const error = (name: keyof FormData) => form.formState.errors[name]?.message;
  return <AppShell title="Cadastro de pessoa" hideHeading><PageHeader eyebrow="Clientes" title="Cadastro de Pessoa" description="Pessoa, acesso, endereço e contrato no mesmo fluxo controlado." />
    {!origin.isCanonical && <div className="origin-warning" role="alert"><span>Cadastros ficam bloqueados fora do endereço oficial.</span>{origin.canonicalOrigin && <a href={origin.canonicalOrigin}>Abrir ambiente oficial</a>}</div>}
    <form className="module-form client-registration" onSubmit={submit} noValidate>
      <FormSection icon={<UserRound />} title="Informações pessoais" description="Dados mínimos para identificação e acesso.">
        <Field label="Nome completo" error={error("fullName")}><input {...form.register("fullName")} autoComplete="name" /></Field><Field label="Data de nascimento" error={error("birthDate")}><input type="date" max={today} {...form.register("birthDate")} /></Field><Field label="E-mail" error={error("email")}><input type="email" {...form.register("email")} autoComplete="email" /></Field><Field label="Telefone internacional" error={error("phone")}><input placeholder="+5537999999999" {...form.register("phone")} autoComplete="tel" /></Field><Field label="Canal do código" error={error("accessChannel")}><select {...form.register("accessChannel")}><option value="email">E-mail</option><option value="phone">SMS</option></select></Field>
      </FormSection>
      <FormSection icon={<Home />} title="Endereço principal" description="Armazenado de forma normalizada e fora do dashboard público.">
        <Field label="CEP" error={error("postalCode")}><input {...form.register("postalCode")} inputMode="numeric" /></Field><Field label="Logradouro" error={error("street")} wide><input {...form.register("street")} /></Field><Field label="Número" error={error("number")}><input {...form.register("number")} /></Field><Field label="Complemento" error={error("complement")}><input {...form.register("complement")} /></Field><Field label="Bairro" error={error("neighborhood")}><input {...form.register("neighborhood")} /></Field><Field label="Cidade" error={error("city")}><input {...form.register("city")} /></Field><Field label="UF" error={error("state")}><input maxLength={2} {...form.register("state")} /></Field><Field label="País" error={error("countryCode")}><input maxLength={2} {...form.register("countryCode")} /></Field>
      </FormSection>
      <FormSection icon={<CalendarDays />} title="Contrato" description="Vigência exigida pelo fluxo de acesso do cliente.">
        <Field label="Início" error={error("startsOn")}><input type="date" {...form.register("startsOn")} /></Field><Field label="Término" error={error("endsOn")}><input type="date" {...form.register("endsOn")} /></Field><Field label="Plano" error={error("planName")} wide><input {...form.register("planName")} /></Field>
      </FormSection>
      <FormSection icon={<FileText />} title="Observação" description="Contexto interno opcional, sem credenciais ou dados de cartão."><Field label="Observação interna" error={error("notes")} full><textarea {...form.register("notes")} rows={4} /></Field></FormSection>
      {mutation.isError && <div className="form-error" role="alert">{mutation.error.message}</div>}{mutation.data && <div className="form-success" role="status"><strong>Cliente criado com sucesso.</strong><span>Link exclusivo: {mutation.data.accessLink}</span></div>}
      {!permissions.isLoading && !permissions.data?.canArchive && <div className="read-only-banner">Seu perfil não possui permissão para cadastrar clientes.</div>}
      <div className="form-actions"><button type="button" className="secondary-button" onClick={() => history.back()}>Cancelar</button><button className="primary-button" disabled={mutation.isPending || !origin.isCanonical || !permissions.data?.canArchive}>{mutation.isPending ? "Criando cadastro..." : "Salvar pessoa e acesso"}</button></div>
    </form>
  </AppShell>;
}

function FormSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) { return <fieldset className="form-section"><legend><span>{icon}</span><strong>{title}</strong><small>{description}</small></legend><div className="form-grid">{children}</div></fieldset>; }
function Field({ label, error, children, wide, full }: { label: string; error?: string; children: React.ReactNode; wide?: boolean; full?: boolean }) { return <label className={full ? "field-full" : wide ? "field-wide" : undefined}>{label}{children}{error && <small className="field-error">{error}</small>}</label>; }
