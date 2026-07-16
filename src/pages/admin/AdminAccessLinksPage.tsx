import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, RotateCw, ShieldAlert } from "lucide-react";
import { ClientSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/formatters";
import { getAdminFormOptions } from "@/services/admin-options";
import { createDirectAccessLink, getDirectAccessLinks, revokeDirectAccessLink } from "@/services/direct-access";

export function AdminAccessLinksPage() {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const links = useQuery({ queryKey: ["direct-access-links"], queryFn: () => getDirectAccessLinks() });
  const [clientId, setClientId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [generatedPath, setGeneratedPath] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const origin = useMemo(() => window.location.origin, []);
  const create = useMutation({ mutationFn: () => createDirectAccessLink({ clientId, expiresAt: expiresAt ? `${expiresAt}T23:59:59` : undefined }), onSuccess: (result) => { setGeneratedPath(`${origin}${result.path}`); void queryClient.invalidateQueries({ queryKey: ["direct-access-links"] }); } });
  const revoke = useMutation({ mutationFn: (linkId: string) => revokeDirectAccessLink(linkId, revokeReason || "Revogado pela equipe MRL."), onSuccess: () => { setRevokeReason(""); void queryClient.invalidateQueries({ queryKey: ["direct-access-links"] }); } });

  return <AppShell title="Acessos" hideHeading>
    <PageHeader eyebrow="Link direto" title="Acessos de clientes" description="O link secreto é uma credencial bearer: quem possui o link entra. Gere, copie e distribua somente por canal confiável." />
    <section className="module-grid two-columns">
      <form className="module-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <div className="form-title"><KeyRound /><div><h2>Gerar novo link</h2><p>A rotação revoga o link ativo anterior do cliente.</p></div></div>
        {options.isLoading && <LoadingState />}{options.isError && <ErrorState message={options.error.message} />}
        {options.data && <div className="form-grid"><label>Cliente<ClientSelect clients={options.data.clients} value={clientId} onChange={setClientId} /></label><label>Expira em<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label></div>}
        {create.isError && <div className="form-error">{create.error.message}</div>}
        {generatedPath && <div className="copy-box"><input readOnly value={generatedPath} /><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(generatedPath)}><Copy size={15}/> Copiar</button></div>}
        <button className="primary-button" disabled={!clientId || create.isPending}>{create.isPending ? "Gerando..." : "Gerar e rotacionar"}</button>
      </form>
      <div className="module-form warning-panel"><div className="form-title"><ShieldAlert /><div><h2>Risco documentado</h2><p>O token bruto nunca é salvo no banco. A lista mostra apenas status e uso; se perder o link, gere outro.</p></div></div><ul><li>Distribua após validar a troca de sessão em produção.</li><li>Revogue imediatamente se o link for encaminhado ao canal errado.</li><li>A URL é limpa após a troca pela Edge Function.</li></ul></div>
    </section>
    <section className="data-section">
      <div className="section-heading"><div><span className="eyebrow">Auditoria</span><h2>Links gerados</h2></div><input placeholder="Motivo de revogação" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} /></div>
      {links.isLoading && <LoadingState />}{links.isError && <ErrorState message={links.error.message} />}{links.data?.items.length === 0 && <EmptyState title="Nenhum link gerado" description="Gere um link direto para iniciar a transição do acesso do cliente." />}
      {links.data && links.data.items.length > 0 && <div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Status</th><th>Expiração</th><th>Último uso</th><th>Usos</th><th></th></tr></thead><tbody>{links.data.items.map((item) => <tr key={item.linkId}><td>{item.clientName}</td><td><StatusBadge status={item.status} /></td><td>{item.expiresAt ? formatDate(item.expiresAt) : "Sem expiração"}</td><td>{formatDate(item.lastUsedAt)}</td><td>{item.useCount}</td><td><button className="table-action" disabled={item.status !== "active" || revoke.isPending} onClick={() => revoke.mutate(item.linkId)}><RotateCw size={14}/> Revogar</button></td></tr>)}</tbody></table></div>}
      {revoke.isError && <div className="form-error">{revoke.error.message}</div>}
    </section>
  </AppShell>;
}
