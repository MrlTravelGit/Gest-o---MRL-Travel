import { ArrowUpRight, ClipboardList, DatabaseZap, FileText, MapPinned, PlaneTakeoff, Send, UserPlus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { AdminOverview } from "@/types/dashboard";
import { formatCurrency, formatPoints } from "@/lib/formatters";

export function AdminBentoGrid({ overview }: { overview: AdminOverview }) {
  const modules = [
    { title: "Clientes", description: "Carteiras, contratos e histórico por pessoa.", to: "/admin/clientes", icon: Users, size: "wide", metric: `${overview.activeClients} ativos` },
    { title: "Viagens / Economia", description: "Registre vendas e compare o valor entregue.", to: "/admin/viagens-e-economia", icon: PlaneTakeoff, size: "wide", metric: formatCurrency(overview.generatedSavings) },
    { title: "Pontuações", description: "Ranking oficial e vencimentos em todas as contas.", to: "/admin/pontuacoes", icon: DatabaseZap, size: "tall", metric: formatPoints(overview.managedPoints) },
    { title: "Formulários", description: "Entrada digital na gestão.", to: "/admin/formularios", icon: FileText, size: "standard", metric: "Em breve" },
    { title: "Interesse em Viagens", description: "Planos do cliente viram oportunidades acompanháveis.", to: "/admin/interesses", icon: MapPinned, size: "standard", metric: `${overview.openInterests} abertos` },
    { title: "Transferência", description: "Mova pontos com paridade, bônus e saldo atômico.", to: "/admin/transferencias", icon: Send, size: "wide", metric: `${overview.transfersCount} registradas` },
    { title: "Saída Manual", description: "Baixa excepcional, justificada e auditável.", to: "/admin/saidas", icon: ClipboardList, size: "small", metric: overview.canWrite ? "Disponível" : "Consulta" },
    { title: "Cadastro de Pessoas", description: "Cliente, acesso, endereço e contrato.", to: "/admin/clientes/novo", icon: UserPlus, size: "small", metric: "Novo cadastro" },
  ] as const;
  return <section className="bento-section" aria-labelledby="modules-title"><div className="section-heading bento-heading"><div><span className="eyebrow">Áreas de trabalho</span><h2 id="modules-title">Módulos de gestão</h2><p>Entre direto no fluxo que precisa executar.</p></div></div><div className="admin-bento-grid">{modules.map(({ icon: Icon, ...item }, index) => <Link className={`bento-card bento-${item.size}`} to={item.to} key={item.title} style={{ "--delay": `${index * 45}ms` } as React.CSSProperties}><div className="bento-icon"><Icon aria-hidden /></div><span className="bento-metric">{item.metric}</span><div><h3>{item.title}</h3><p>{item.description}</p></div><ArrowUpRight className="bento-arrow" aria-hidden /></Link>)}</div></section>;
}
