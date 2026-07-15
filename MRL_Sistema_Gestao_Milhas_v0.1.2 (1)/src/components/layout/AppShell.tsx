import { LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function AppShell({
  title,
  subtitle,
  children,
  showLogout = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  showLogout?: boolean;
}) {
  const { signOut } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark">MRL</div>
          <div>
            <strong>MRL Travel</strong>
            <span>Gestão de Milhas</span>
          </div>
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
        <div className="page-heading">
          <div>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
