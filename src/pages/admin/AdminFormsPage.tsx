import { ClipboardCheck, FileText, LockKeyhole } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";

export function AdminFormsPage(){return <AppShell title="Formulários" hideHeading><PageHeader eyebrow="Entrada digital" title="Formulários" description="Um futuro canal estruturado para receber dados com segurança."/><section className="coming-soon-card"><div className="coming-soon-copy"><span className="status-badge">Em breve</span><FileText aria-hidden/><h2>Formulário de entrada na gestão</h2><p>O cliente poderá enviar informações iniciais para revisão da equipe MRL. Neste patch, a prévia é somente visual e não transmite nem armazena dados.</p><div><span><ClipboardCheck/>Revisão antes de importar</span><span><LockKeyhole/>Acesso autenticado</span></div></div><div className="form-preview" aria-hidden="true"><span/><span/><span/><div/><small>Prévia não interativa</small></div></section></AppShell>}
