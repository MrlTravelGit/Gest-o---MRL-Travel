import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Plus, Search, Trash2, Users } from "lucide-react";
import { ConfirmActionDialog } from "@/components/admin/ConfirmActionDialog";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate, formatPoints } from "@/lib/formatters";
import { archiveClient, getAdminClients } from "@/services/admin-clients";
import { getAdminOverview } from "@/services/dashboard";
import { formatCurrency } from "@/lib/formatters";

const PAGE_SIZE = 20;

export function AdminClientsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const permissions = useQuery({ queryKey: ["admin-overview"], queryFn: getAdminOverview });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const clients = useQuery({
    queryKey: ["admin-clients", search, status, offset],
    queryFn: () => getAdminClients(search, status, PAGE_SIZE, offset),
    placeholderData: keepPreviousData,
  });

  return (
    <AppShell title="Clientes" subtitle="Saldos, clubes e vencimentos em uma visão operacional">
      <div className="page-toolbar">
        <Link className="secondary-button" to="/admin"><ArrowLeft size={17} /> Visão geral</Link>
        <div className="toolbar-filters"><select aria-label="Filtrar por status" value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}><option value="">Todos os status</option><option value="active">Ativos</option><option value="paused">Pausados</option><option value="ended">Arquivados</option></select><div className="search-field"><Search size={18} /><input aria-label="Pesquisar clientes" placeholder="Pesquisar por nome" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></div>{permissions.data?.canArchive&&<Link className="primary-button" to="/admin/clientes/novo"><Plus size={17}/> Nova pessoa</Link>}</div>
      </div>

      {clients.isLoading && <div className="panel-state">Carregando clientes...</div>}
      {clients.isError && <div className="panel-state error-state">{clients.error.message}</div>}
      {clients.data && clients.data.items.length === 0 && (
        <div className="empty-management-state"><Users size={34} /><h2>Nenhum cliente encontrado</h2><p>Ajuste a pesquisa ou crie um cliente na visão geral.</p></div>
      )}
      {clients.data && clients.data.items.length > 0 && (
        <>
          <div className="responsive-table clients-table"><table><thead><tr><th>Cliente</th><th>Total de pontos</th><th>Economia</th><th>Programas</th><th>Próximo vencimento</th><th>Última movimentação</th><th></th></tr></thead><tbody>
            {clients.data.items.map((client) => <tr key={client.clientId}>
              <td><strong>{client.fullName}</strong><small>{client.status}</small></td>
              <td>{formatPoints(client.totalPoints)}</td>
              <td>{formatCurrency(client.generatedSavings)}</td>
              <td>{client.programsCount}</td>
              <td>{client.nextExpirationDate ? <><strong>{formatDate(client.nextExpirationDate)}</strong><small>{formatPoints(client.expiringPoints)} em 90 dias</small></> : "Sem vencimento"}</td>
              <td>{formatDate(client.lastMovementAt)}</td>
              <td><div className="table-actions"><Link className="table-action" to={`/admin/clientes/${client.clientId}`}>Abrir <ArrowRight size={15} /></Link>{permissions.data?.canArchive&&client.status!=="ended"&&<ClientArchiveButton clientId={client.clientId} clientName={client.fullName}/>}</div></td>
            </tr>)}
          </tbody></table></div>
          <div className="pagination-bar">
            <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, clients.data.total)} de {clients.data.total}</span>
            <div><button className="secondary-button" disabled={offset === 0 || clients.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Anterior</button><button className="secondary-button" disabled={offset + PAGE_SIZE >= clients.data.total || clients.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>Próxima</button></div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function ClientArchiveButton({clientId,clientName}:{clientId:string;clientName:string}){const qc=useQueryClient();const [confirmation,setConfirmation]=useState("");const mutation=useMutation({mutationFn:()=>archiveClient(clientId,confirmation),onSuccess:()=>{setConfirmation("");void Promise.all([qc.invalidateQueries({queryKey:["admin-clients"]}),qc.invalidateQueries({queryKey:["admin-overview"]}),qc.invalidateQueries({queryKey:["admin-form-options"]})])}});return <ConfirmActionDialog trigger={<button className="icon-danger" aria-label={`Arquivar ${clientName}`}><Trash2 size={15}/></button>} title="Arquivar cliente" description="O acesso e o contrato ativo serão encerrados. Pontos, viagens, economia, lançamentos e auditoria serão preservados." confirmation={confirmation} onConfirmationChange={setConfirmation} expected={clientName} busy={mutation.isPending} error={mutation.error?.message} onConfirm={()=>mutation.mutate()}/>}
