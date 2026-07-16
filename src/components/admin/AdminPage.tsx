import { ArrowLeft, Inbox, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <><nav className="breadcrumb" aria-label="Navegação estrutural"><Link to="/admin"><ArrowLeft size={15} /> Painel</Link><span>/</span><span aria-current="page">{title}</span></nav><header className="admin-page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</header></>;
}

export function LoadingState({ label = "Carregando dados oficiais..." }: { label?: string }) { return <div className="module-state module-loading" role="status"><span /><span /><span /><p>{label}</p></div>; }
export function EmptyState({ title, description }: { title: string; description: string }) { return <div className="module-state"><Inbox aria-hidden /><h2>{title}</h2><p>{description}</p></div>; }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div className="module-state error-state" role="alert"><h2>Não foi possível carregar</h2><p>{message}</p>{retry && <button className="secondary-button" onClick={retry}><RefreshCw size={16} /> Tentar novamente</button>}</div>; }
