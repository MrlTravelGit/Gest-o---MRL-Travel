import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, Coins, ListTodo, PiggyBank, Users } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { createClient } from "@/services/admin";
import { getAdminOverview } from "@/services/dashboard";
import { getAppOriginStatus } from "@/lib/app-origin";
import { env } from "@/lib/env";
import { formatCurrency, formatPoints } from "@/lib/formatters";

export function AdminDashboardPage() {
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: getAdminOverview });

  return (
    <AppShell title="Gestão geral" subtitle="Clientes, saldos, vencimentos e pendências">
      <div className="page-toolbar dashboard-toolbar"><Link className="secondary-button" to="/admin/clientes"><Users size={17} /> Gerenciar clientes</Link></div>
      {overview.data && (
        <section className="summary-grid admin-summary-grid">
          <AdminMetric icon={<Users />} label="Clientes ativos" value={formatPoints(overview.data.activeClients)} />
          <AdminMetric icon={<Coins />} label="Pontos administrados" value={formatPoints(overview.data.managedPoints)} />
          <AdminMetric icon={<PiggyBank />} label="Economia gerada" value={formatCurrency(overview.data.generatedSavings)} />
          <AdminMetric icon={<AlertTriangle />} label="Vencem em 30 dias" value={formatPoints(overview.data.expiringIn30Days)} />
          <AdminMetric icon={<CalendarClock />} label="Contratos próximos" value={formatPoints(overview.data.contractsEndingIn30Days)} />
          <AdminMetric icon={<ListTodo />} label="Tarefas abertas" value={formatPoints(overview.data.openTasks)} />
        </section>
      )}
      {overview.isError && <div className="panel-state error-state">{overview.error.message}</div>}
      <CreateClientPanel />
    </AppShell>
  );
}

function AdminMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <article className="summary-card"><div className="summary-icon">{icon}</div><span>{label}</span><strong>{value}</strong></article>;
}

function CreateClientPanel() {
  const appOrigin = useMemo(
    () => getAppOriginStatus(window.location.origin, env.VITE_APP_URL),
    [],
  );
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const oneYear = useMemo(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().slice(0, 10);
  }, []);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    accessChannel: "email" as "email" | "phone",
    startsOn: today,
    endsOn: oneYear,
    planName: "Gestão MRL Travel",
  });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);

    if (!appOrigin.isCanonical) {
      setError(appOrigin.canonicalOrigin
        ? "Este endereço é um Preview da Vercel. Abra o ambiente oficial para realizar operações administrativas."
        : "A URL oficial não está configurada. Defina VITE_APP_URL antes de realizar operações administrativas.");
      return;
    }

    setBusy(true);
    try {
      const created = await createClient({
        ...form,
        email: form.email || undefined,
        phone: form.phone || undefined,
      });
      setResult(created.accessLink);
    } catch (creationError) {
      setError(creationError instanceof Error ? creationError.message : "Cadastro não concluído");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel">
      <div className="section-heading"><div><h2>Novo cliente</h2><p>Cria cadastro, contrato, usuário e link exclusivo em uma operação controlada.</p></div></div>
      <form className="admin-form" onSubmit={submit}>
        {!appOrigin.isCanonical && (
          <div className="origin-warning full-field" role="alert">
            <span>{appOrigin.canonicalOrigin
              ? "Este endereço é um Preview da Vercel. Abra o ambiente oficial para realizar operações administrativas."
              : "A URL oficial não está configurada. Defina VITE_APP_URL antes de realizar operações administrativas."}</span>
            {appOrigin.canonicalOrigin && (
              <a href={appOrigin.canonicalOrigin}>Abrir o ambiente oficial</a>
            )}
          </div>
        )}
        <label>Nome completo<input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label>
        <label>E-mail<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /><small>Use um e-mail que ainda não pertença a outro administrador ou cliente.</small></label>
        <label>Telefone internacional<input placeholder="+5537999999999" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label>Canal do código<select value={form.accessChannel} onChange={(event) => setForm({ ...form, accessChannel: event.target.value as "email" | "phone" })}><option value="email">E-mail</option><option value="phone">SMS</option></select></label>
        <label>Início<input type="date" value={form.startsOn} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} required /></label>
        <label>Término<input type="date" value={form.endsOn} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} required /></label>
        <label className="full-field">Plano<input value={form.planName} onChange={(event) => setForm({ ...form, planName: event.target.value })} /></label>
        {error && <div className="form-error full-field" role="alert">{error}</div>}
        {result && <div className="created-link full-field"><span>Link exclusivo criado</span><code>{result}</code></div>}
        <button className="primary-button full-field" disabled={busy || !appOrigin.isCanonical}>{busy ? "Criando..." : "Criar cliente e acesso"}</button>
      </form>
    </section>
  );
}
