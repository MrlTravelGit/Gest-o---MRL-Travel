import { ArrowRight, Coins, PiggyBank, Plus, Timer, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { formatCurrency, formatPoints } from "@/lib/formatters";
import type { AdminOverview } from "@/types/dashboard";
import { Aurora } from "@/components/effects/Aurora";

export function AdminHero({ overview }: { overview: AdminOverview }) {
  const metrics = [
    { label: "Clientes ativos", value: formatPoints(overview.activeClients), icon: Users },
    { label: "Pontos sob gestão", value: formatPoints(overview.managedPoints), icon: Coins },
    { label: "Economia acumulada", value: formatCurrency(overview.generatedSavings), icon: PiggyBank },
    { label: "Vencem em 30 dias", value: formatPoints(overview.expiringIn30Days), icon: Timer },
  ];
  return <section className="admin-hero" aria-labelledby="admin-hero-title">
    <Aurora />
    <div className="admin-hero-overlay" />
    <div className="admin-hero-content">
      <div className="hero-copy"><span className="hero-kicker">Central operacional · {roleLabel(overview.role)}</span><p className="hero-greeting">Olá, Michael {overview.operatorName}.</p><h1 id="admin-hero-title">Gestão de <em>Milhas</em></h1><p>Decisões claras, saldos oficiais e cada operação rastreada em um único lugar.</p><div className="hero-actions">{overview.canArchive && <Link className="primary-button" to="/admin/clientes/novo"><Plus size={17} /> Cadastrar cliente</Link>}{overview.canWrite && <Link className="secondary-button" to="/admin/viagens-e-economia">Lançar operação <ArrowRight size={17} /></Link>}</div></div>
      <div className="hero-metrics">{metrics.map(({ label, value, icon: Icon }) => <article key={label}><Icon aria-hidden size={18} /><span>{label}</span><strong>{value}</strong></article>)}</div>
    </div>
  </section>;
}

function roleLabel(role: AdminOverview["role"]) { return ({ super_admin: "Super administrador", manager: "Gestor", operator: "Operador", auditor: "Auditoria" } as const)[role]; }
