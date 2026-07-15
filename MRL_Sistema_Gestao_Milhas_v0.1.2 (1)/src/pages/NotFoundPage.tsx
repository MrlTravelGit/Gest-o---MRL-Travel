import { Link } from "react-router-dom";

export function NotFoundPage() {
  return <div className="not-found"><div className="brand-mark">MRL</div><h1>Página não encontrada</h1><Link to="/admin/login">Acesso administrativo</Link></div>;
}
