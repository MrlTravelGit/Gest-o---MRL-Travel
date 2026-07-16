import { useState } from "react";
import { BarChart3, ClipboardList, CreditCard, DatabaseZap, FileText, Gem, History, KeyRound, LogOut, MapPinned, Menu, PlaneTakeoff, Send, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  { label: "Visão geral", to: "/admin", icon: BarChart3, end: true },
  { label: "Clientes", to: "/admin/clientes", icon: Users },
  { label: "Clubes", to: "/admin/clubes", icon: Gem },
  { label: "Faturas", to: "/admin/faturas", icon: CreditCard },
  { label: "Movimentações", to: "/admin/movimentacoes", icon: History },
  { label: "Viagens e economia", to: "/admin/viagens", icon: PlaneTakeoff },
  { label: "Pontuações", to: "/admin/pontuacoes", icon: DatabaseZap },
  { label: "Transferências", to: "/admin/transferencias", icon: Send },
  { label: "Saída manual", to: "/admin/saidas", icon: ClipboardList },
  { label: "Interesses", to: "/admin/interesses", icon: MapPinned },
  { label: "Formulários", to: "/admin/formularios", icon: FileText },
  { label: "Cadastro", to: "/admin/pessoas/novo", icon: UserPlus },
  { label: "Acessos", to: "/admin/acessos", icon: KeyRound },
] as const;

export function AppShell({
  title,
  subtitle,
  children,
  showLogout = true,
  hideHeading = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  showLogout?: boolean;
  hideHeading?: boolean;
}) {
  const { signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`admin-sidebar ${drawerOpen ? "open" : ""}`} aria-label="Navegação administrativa">
        <div className="sidebar-top">
          <Link className="brand-lockup" to="/admin" aria-label="MRL Travel — painel administrativo" onClick={() => setDrawerOpen(false)}>
            <div className="brand-mark">MRL</div>
            <div className="brand-copy">
              <strong>MRL Travel</strong>
              <span>Gestão de Milhas</span>
            </div>
          </Link>
          <button className="icon-button mobile-only" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu">
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(({ icon: Icon, ...item }) => (
            <NavLink key={item.to} title={collapsed ? item.label : undefined} end={"end" in item ? item.end : undefined} to={item.to} onClick={() => setDrawerOpen(false)}>
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <button className="sidebar-collapse" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? "Expandir" : "Recolher"}
        </button>
      </aside>
      {drawerOpen && <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setDrawerOpen(false)} />}
      <header className="app-header">
        <button className="icon-button mobile-menu-button" onClick={() => setDrawerOpen(true)} aria-label="Abrir menu">
          <Menu size={18} />
        </button>
        <div className="header-context">
          <strong>{title}</strong>
          {subtitle && <span>{subtitle}</span>}
        </div>
        <div className="header-security">
          <ShieldCheck size={18} />
          <span>Ambiente protegido</span>
          {showLogout && (
            <button className="icon-button" onClick={() => void signOut()} aria-label="Sair">
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>
      <main className="page-container">
        {!hideHeading && (
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
