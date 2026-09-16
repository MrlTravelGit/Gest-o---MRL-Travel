import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, FileText, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { downloadContractBlob } from "@/lib/contracts/downloadContract";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { archiveClientContract, downloadStoredContract, listClientContracts } from "@/services/contracts";
import type { ClientContract, ContractFilter } from "@/types/contracts";

export function ClientContractsPanel({ clientId, canWrite = true, compact = false }: { clientId?: string; canWrite?: boolean; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ContractFilter>("active");
  const [message, setMessage] = useState("");
  const contracts = useQuery({
    queryKey: ["client-contracts", clientId ?? "all", filter],
    queryFn: () => listClientContracts({ clientId, filter }),
  });
  const archive = useMutation({
    mutationFn: archiveClientContract,
    onSuccess: async () => {
      setMessage("Contrato arquivado com sucesso.");
      await queryClient.invalidateQueries({ queryKey: ["client-contracts"] });
    },
  });

  const download = async (contract: ClientContract) => {
    try {
      const blob = await downloadStoredContract(contract);
      downloadContractBlob(blob, (contract.contractNumber ?? "contrato-mrl") + ".pdf");
      setMessage("Download iniciado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível baixar o contrato.");
    }
  };

  return (
    <section className={"client-contracts-panel" + (compact ? " compact" : "")}>
      <div className="section-heading">
        <div><span className="eyebrow">Documentos jurídicos</span><h2>Contratos gerados</h2><p>PDFs privados, auditáveis e vinculados ao cliente.</p></div>
        {clientId && <Link className="primary-button" to={"/admin/contratos?clientId=" + clientId}><Plus size={16} /> Gerar contrato</Link>}
      </div>
      <div className="contract-filter-tabs" role="tablist" aria-label="Filtrar contratos">
        {(["active", "archived", "all"] as ContractFilter[]).map((value) => (
          <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {value === "active" ? "Ativos" : value === "archived" ? "Arquivados" : "Todos"}
          </button>
        ))}
      </div>
      {contracts.isLoading && <div className="panel-state">Carregando contratos...</div>}
      {contracts.isError && <div className="form-error">{contracts.error.message}</div>}
      {contracts.data?.length === 0 && <div className="empty-state">Nenhum contrato encontrado neste filtro.</div>}
      <div className="contract-history-list">
        {contracts.data?.map((contract) => (
          <article key={contract.id}>
            <div className="contract-history-icon"><FileText /></div>
            <div>
              <small>{contract.contractNumber ?? "Contrato MRL"} · {formatDate(contract.contractDate)}</small>
              <strong>{contract.clientName}</strong>
              <span>{formatCurrency(contract.contractValue)} · {contract.installments}x de {formatCurrency(contract.installmentValue)}</span>
              <p>{contract.includeCashback ? "Cashback " + contract.cashbackPercent + "%" : "Sem cashback"} · {contract.includeRoiGuarantee ? "Com garantia de retorno" : "Sem garantia de retorno"}</p>
            </div>
            <span className={"status-badge status-" + contract.status}>{contract.status === "archived" ? "Arquivado" : "Gerado"}</span>
            <div className="contract-history-actions">
              <button type="button" className="secondary-button" disabled={!contract.pdfPath} onClick={() => void download(contract)}><Download size={15} /> Baixar</button>
              {contract.status !== "archived" && <button type="button" className="secondary-button" disabled={!canWrite || archive.isPending} onClick={() => {
                if (window.confirm("Arquivar este contrato? O PDF será preservado para auditoria.")) archive.mutate(contract.id);
              }}><Archive size={15} /> Arquivar</button>}
            </div>
          </article>
        ))}
      </div>
      {archive.isError && <div className="form-error">{archive.error.message}</div>}
      {message && <div className="contract-toast" role="status">{message}<button type="button" onClick={() => setMessage("")}>Fechar</button></div>}
    </section>
  );
}
