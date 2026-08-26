import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  getAudit,
  getClient,
  login,
  logout,
  removeDocument,
  reveal,
  saveCredential,
  savePersonal,
  session,
  syncNow,
  uploadDocument,
  type VaultClient,
} from "./api";

type User = { id?: string; username?: string; role: string };
type RouteState = { kind: "home" } | { kind: "client"; clientId: string } | { kind: "not-found" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`)) : "—";
const maskCpf = (value: string) => value.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");

function routeFromLocation(pathname = location.pathname): RouteState {
  if (pathname === "/" || pathname === "") return { kind: "home" };
  const match = pathname.match(/^\/clients\/([^/]+)\/?$/i);
  if (!match) return { kind: "not-found" };
  const clientId = decodeURIComponent(match[1]);
  return uuidPattern.test(clientId) ? { kind: "client", clientId } : { kind: "not-found" };
}

export function App() {
  const route = useMemo(() => routeFromLocation(), []);
  const [user, setUser] = useState<User | null>(null);
  const [client, setClient] = useState<VaultClient | null>(null);
  const [error, setError] = useState("");
  const [syncPending, setSyncPending] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (route.kind !== "client") return;
    setError("");
    setSyncPending(false);
    try {
      setClient(await getClient(route.clientId));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Falha na operação";
      if (message === "CLIENT_NOT_SYNCED") {
        setClient(null);
        setSyncPending(true);
        return;
      }
      setError(message);
    }
  }, [route]);

  useEffect(() => {
    session().then((result) => setUser(result.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user && user.role !== "vault_auditor") void load();
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    let timer = window.setTimeout(() => logout().finally(() => { setUser(null); setClient(null); }), 600000);
    const reset = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => logout().finally(() => { setUser(null); setClient(null); }), 600000);
    };
    for (const event of ["pointerdown", "keydown", "scroll"]) addEventListener(event, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const event of ["pointerdown", "keydown", "scroll"]) removeEventListener(event, reset);
    };
  }, [user]);

  if (route.kind === "not-found") return <NotFound />;
  if (!user) return <Login onLogin={setUser} />;
  if (user.role === "vault_auditor") return <AuditView user={user} onExit={() => logout().finally(() => setUser(null))} />;
  if (route.kind === "home") return <EmptyClient />;
  if (syncPending) return <PendingSync clientId={route.clientId} admin={user.role === "vault_admin"} busy={busy} error={error} onSync={() => runMutation(async () => { await syncNow(); await load(); }, setBusy, setError)} />;
  if (!client) return <main className="state"><div className="spinner" /><p>{error || "Abrindo registro protegido…"}</p></main>;

  const mutate = (work: () => Promise<unknown>) => runMutation(async () => { await work(); await load(); }, setBusy, setError);

  return <div className="vault-shell">
    <header>
      <div><span className="eyebrow">MRL TRAVEL · COFRE LOCAL</span><strong>Dados protegidos</strong></div>
      <div className="session"><span className="secure-dot" />Rede local · {user.username}<button onClick={() => logout().finally(() => setUser(null))}>Sair</button></div>
    </header>
    <main>
      <section className="client-hero">
        <div><span className={`status ${client.status}`}>{client.status === "active" ? "Vigente" : "Arquivado"}</span><h1>{client.displayName}</h1><p>ID operacional {client.clientId}</p></div>
        <dl><div><dt>Vigência</dt><dd>{date(client.contractStartDate)} — {date(client.contractEndDate)}</dd></div><div><dt>Sincronização</dt><dd>{client.syncStatus}</dd></div><div><dt>Atualizado</dt><dd>{new Date(client.updatedAt).toLocaleString("pt-BR")}</dd></div></dl>
      </section>
      {error && <div className="alert" role="alert">{error}</div>}
      <Personal client={client} disabled={busy} onSave={(value) => mutate(() => savePersonal(route.clientId, value))} />
      <Credentials client={client} disabled={busy} onRefresh={load} />
      <Documents client={client} admin={user.role === "vault_admin"} disabled={busy} onRun={mutate} />
    </main>
    <footer>Armazenamento exclusivo neste computador · Sessão bloqueada após 10 minutos de inatividade</footer>
  </div>;
}

async function runMutation(work: () => Promise<unknown>, setBusy: (value: boolean) => void, setError: (value: string) => void) {
  setBusy(true);
  setError("");
  try { await work(); }
  catch (caught) { setError(caught instanceof Error ? caught.message : "Falha na operação"); }
  finally { setBusy(false); }
}

function NotFound() {
  return <main className="state"><div><span className="eyebrow">MRL TRAVEL · COFRE LOCAL</span><h1>Cadastro não encontrado</h1><p>Abra o cofre a partir do painel administrativo da Gestão.</p></div></main>;
}

function EmptyClient() {
  return <main className="state"><div><span className="eyebrow">MRL TRAVEL · COFRE LOCAL</span><h1>Cliente não informado</h1><p>Abra os dados protegidos pelo perfil administrativo do cliente.</p></div></main>;
}

function PendingSync({ clientId, admin, busy, error, onSync }: { clientId: string; admin: boolean; busy: boolean; error: string; onSync: () => void }) {
  return <main className="state"><section className="pending-sync"><span className="eyebrow">MRL TRAVEL · COFRE LOCAL</span><h1>Cadastro aguardando sincronização com a Gestão.</h1><p>ID operacional {clientId}</p>{admin && <button className="primary" disabled={busy} onClick={onSync}>{busy ? "Sincronizando…" : "Sincronizar novamente"}</button>}{error && <div className="alert" role="alert">{error}</div>}</section></main>;
}

function AuditView({ user, onExit }: { user: User; onExit: () => void }) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState("");
  useEffect(() => { getAudit().then((result) => setItems(result.items)).catch((caught) => setError(caught.message)); }, []);
  return <div className="vault-shell"><header><div><span className="eyebrow">MRL TRAVEL · COFRE LOCAL</span><strong>Trilha de auditoria</strong></div><div className="session">{user.username}<button onClick={onExit}>Sair</button></div></header><main><section className="panel"><div className="section-head"><div><span className="index">AUD</span><h2>Eventos recentes</h2></div><span className="count">Somente metadados não sensíveis</span></div>{error && <div className="alert">{error}</div>}<div className="audit-list">{items.map((item) => <article key={String(item.event_id)}><time>{new Date(String(item.timestamp)).toLocaleString("pt-BR")}</time><strong>{String(item.action)}</strong><span>{String(item.result)}</span><code>{item.client_id ? String(item.client_id) : "—"}</code></article>)}</div></section></main></div>;
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try { onLogin((await login(String(data.get("username")), String(data.get("password")))).user); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Acesso negado"); }
    finally { setBusy(false); }
  }
  return <main className="login-page"><section className="login-card"><img className="login-logo" src="/assets/brand/logo-mrl-travel.svg" alt="MRL Travel" /><span className="protected-label">Ambiente local protegido</span><h1>Acesso ao cofre local</h1><p>Dados protegidos da gestão</p><form onSubmit={submit} autoComplete="off"><label>Usuário<input name="username" autoComplete="off" required autoFocus /></label><label>Senha<input name="password" type="password" minLength={15} autoComplete="off" required /></label>{error && <div className="alert">{error}</div>}<button className="primary" disabled={busy}>{busy ? "Entrando…" : "Continuar"}</button></form></section></main>;
}

function Personal({ client, disabled, onSave }: { client: VaultClient; disabled: boolean; onSave: (value: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const p = client.personal;
  return <section className="panel"><div className="section-head"><div><span className="index">01</span><h2>Dados pessoais</h2></div><button disabled={disabled} onClick={() => setOpen(!open)}>{open ? "Fechar" : "Editar"}</button></div>{open ? <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); onSave({ ...data, cpf: maskCpf(String(data.cpf || "")) }); setOpen(false); }}><label>CPF<input name="cpf" defaultValue={p.cpf || ""} onInput={(event) => event.currentTarget.value = maskCpf(event.currentTarget.value)} /></label><label>RG<input name="rg" defaultValue={p.rg || ""} /></label><label>Nascimento<input name="birthDate" type="date" defaultValue={p.birthDate || ""} /></label><label>E-mail<input name="email" type="email" defaultValue={p.email || ""} /></label><label>Telefone / WhatsApp<input name="phone" defaultValue={p.phone || ""} /></label><label>Estado civil<select name="maritalStatus" defaultValue={p.maritalStatus || ""}><option value="">Não informado</option><option>Solteiro(a)</option><option>Casado(a)</option><option>Divorciado(a)</option><option>Viúvo(a)</option><option>União estável</option></select></label><label className="wide">Endereço<input name="address" defaultValue={p.address || ""} /></label><label>N.º do passaporte<input name="passportNumber" defaultValue={p.passportNumber || ""} maxLength={30} /></label><label>País do passaporte<input name="passportCountry" placeholder="BRA" defaultValue={p.passportCountry || ""} maxLength={3} /></label><label>Validade do passaporte<input name="passportExpiry" type="date" defaultValue={p.passportExpiry || ""} /></label><label className="wide">Observações privadas<textarea name="privateNotes" defaultValue={p.privateNotes || ""} /></label><div className="form-actions"><button type="button" onClick={() => setOpen(false)}>Cancelar</button><button className="primary" disabled={disabled}>Salvar dados cifrados</button></div></form> : <dl className="data-grid"><Info label="Nome completo" value={client.displayName} /><Info label="CPF" value={p.cpf} /><Info label="RG" value={p.rg} /><Info label="Nascimento" value={date(p.birthDate)} /><Info label="Próximo aniversário" value={date(p.nextBirthday)} /><Info label="E-mail" value={p.email} /><Info label="Telefone" value={p.phone} /><Info label="Endereço" value={p.address} /><Info label="Estado civil" value={p.maritalStatus} /><Info label="Passaporte" value={p.passportNumber ? `${p.passportNumber}${p.passportCountry ? ` · ${p.passportCountry}` : ""}${p.passportExpiry ? ` · válido até ${date(p.passportExpiry)}` : ""}` : null} /><Info label="Notas privadas" value={p.privateNotes} /></dl>}</section>;
}

function Info({ label, value }: { label: string; value?: string | null }) {
  const whatsapp = label === "Telefone" && value ? value.replace(/\D/g, "") : "";
  return <div><dt>{label}</dt><dd>{value || "Não informado"}{whatsapp && <a className="whatsapp" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">Abrir WhatsApp ↗</a>}</dd></div>;
}

function EyeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
}

function Credentials({ client, disabled, onRefresh }: { client: VaultClient; disabled: boolean; onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<Record<string, string>>({});
  const selected = client.credentials.find((credential) => credential.id === editing);
  async function show(id: string, field: "login" | "password", copy = false) {
    const { value } = await reveal(client.clientId, id, field);
    const key = `${id}:${field}`;
    setShown((current) => ({ ...current, [key]: value || "Não cadastrado" }));
    window.setTimeout(() => setShown((current) => { const next = { ...current }; delete next[key]; return next; }), 30000);
    if (copy && value) await navigator.clipboard.writeText(value);
  }
  return <section className="panel"><div className="section-head"><div><span className="index">02</span><h2>Credenciais</h2></div><div><span className="count">{client.credentials.length} serviços</span><button disabled={disabled} onClick={() => { setEditing(null); setCreating(true); }}>Adicionar site</button></div></div><div className="credential-list">{client.credentials.map((credential) => <article key={credential.id}><div className="service-icon">{credential.serviceName.slice(0, 2).toUpperCase()}</div><div className="service-main"><strong>{credential.serviceName}</strong><a href={credential.serviceUrl} target="_blank" rel="noreferrer">Abrir site oficial ↗</a><span>Alterado em {new Date(credential.changedAt).toLocaleDateString("pt-BR")}</span></div><span className={`status ${credential.status}`}>{credential.status}</span>{(["login", "password"] as const).map((field) => <div className="secret" key={field}><small>{field === "login" ? "Login" : "Senha"}</small><code>{shown[`${credential.id}:${field}`] || "••••••••••"}</code><button aria-label={`Revelar ${field === "login" ? "login" : "senha"}`} onClick={() => show(credential.id, field)}><EyeIcon /></button><button onClick={() => show(credential.id, field, true)}>Copiar</button></div>)}<button disabled={disabled} onClick={() => { setCreating(false); setEditing(credential.id); }}>Editar</button></article>)}</div>{(selected || creating) && <form className="inline-editor" onSubmit={async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); await saveCredential(client.clientId, { ...data, id: selected?.id, serviceName: selected?.serviceName || data.serviceName, serviceUrl: selected?.serviceUrl || data.serviceUrl, iconKey: selected?.iconKey, status: selected?.status || "active" }); setEditing(null); setCreating(false); await onRefresh(); }}><h3>{selected ? `Atualizar ${selected.serviceName}` : "Adicionar programa ou site"}</h3>{creating && <><label>Nome<input name="serviceName" required /></label><label>URL oficial HTTPS<input name="serviceUrl" type="url" pattern="https?://.*" required /></label></>}<label>Novo login<input name="login" autoComplete="off" /></label><label>Nova senha<input name="password" type="password" autoComplete="new-password" /></label><label>Revisar em<input name="reviewOn" type="date" defaultValue={selected?.reviewOn || ""} /></label><label className="wide">Observação<textarea name="notes" /></label><div className="form-actions"><button type="button" onClick={() => { setEditing(null); setCreating(false); }}>Cancelar</button><button className="primary">Salvar e registrar auditoria</button></div></form>}</section>;
}

function Documents({ client, admin, disabled, onRun }: { client: VaultClient; admin: boolean; disabled: boolean; onRun: (work: () => Promise<unknown>) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  return <section className="panel"><div className="section-head"><div><span className="index">03</span><h2>Documentos</h2></div><span className="count">{client.documents.length} arquivos</span></div><form className="upload" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (file) void onRun(() => uploadDocument(client.clientId, file, Object.fromEntries(data))).then(() => { setFile(null); form.reset(); }); }}><label className="drop"><input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx,.xlsx" required /><strong>{file ? file.name : "Selecionar arquivo protegido"}</strong><span>PDF, imagem, texto, DOCX ou XLSX · até 25 MB · verificação Defender</span></label><label>Título<input name="title" required /></label><label>Tipo<select name="documentType"><option>Identificação</option><option>Passaporte</option><option>Comprovante</option><option>Contrato</option><option>Outro</option></select></label><label>Validade<input name="expiresOn" type="date" /></label><button className="primary" disabled={disabled || !file}>Validar e cifrar</button></form><div className="document-list">{client.documents.map((document) => <article key={document.id}><div className="file-icon">{document.mimeType.includes("pdf") ? "PDF" : document.mimeType.startsWith("image/") ? "IMG" : "DOC"}</div><div><strong>{document.title || document.documentType}</strong><span>{document.originalName} · {document.documentType} · {(document.sizeBytes / 1024).toFixed(0)} KB · Incluído em {new Date(document.createdAt).toLocaleDateString("pt-BR")}</span></div><span>{document.expiresOn ? `Validade ${date(document.expiresOn)}` : "Sem validade"}</span><a href={`/api/clients/${client.clientId}/documents/${document.id}`} target="_blank" rel="noreferrer">Visualizar</a><a href={`/api/clients/${client.clientId}/documents/${document.id}`} download>Baixar</a>{admin && <button className="danger" onClick={() => confirm("Mover este documento para a lixeira protegida?") && void onRun(() => removeDocument(client.clientId, document.id))}>Excluir</button>}</article>)}</div></section>;
}
