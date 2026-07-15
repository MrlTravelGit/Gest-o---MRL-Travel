import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3 } from "lucide-react";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { setProgramClubStatus } from "@/services/admin-clients";
import type { AdminProgramDetail } from "@/types/admin-clients";

export function ProgramAccountCard({ clientId, program, canWrite }: {
  clientId: string;
  program: AdminProgramDetail;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (clubActive: boolean) => setProgramClubStatus(clientId, program.programId, clubActive),
    onSuccess: async () => {
      setFeedback({ type: "success", text: "Clube atualizado." });
      await queryClient.invalidateQueries({ queryKey: ["admin-client-detail", clientId] });
    },
    onError: (error) => setFeedback({ type: "error", text: error instanceof Error ? error.message : "Não foi possível atualizar o clube." }),
  });

  return (
    <article className="account-card">
      <div className="account-card-topline">
        <div className="program-identity">
          {program.logoUrl ? <img src={program.logoUrl} alt="" /> : <span>{program.name.slice(0, 2).toUpperCase()}</span>}
          <div><h3>{program.name}</h3><small>{program.accountId ? "Conta vinculada" : "Ainda sem lançamentos"}</small></div>
        </div>
        <div className="balance-emphasis"><span>Saldo atual</span><strong>{formatPoints(program.balance)}</strong></div>
      </div>
      <div className="account-metrics">
        <div><span>Custo por milheiro</span><strong>{formatCurrency(program.averageCostPerThousand)}</strong></div>
        <div><span>Valor estimado</span><strong>{formatCurrency(program.estimatedValue)}</strong></div>
        <div><span>Vencendo em 90 dias</span><strong>{formatPoints(program.expiringPoints)}</strong></div>
        <div><span>Última atualização</span><strong>{formatDate(program.lastUpdatedAt)}</strong></div>
      </div>
      <div className="club-control">
        <div><span>Clube ativo</span><small>Controle específico deste programa</small></div>
        <div className="binary-control" aria-label={`Clube ${program.name}`}>
          <button type="button" className={program.clubActive ? "active" : ""} disabled={!canWrite || mutation.isPending} onClick={() => mutation.mutate(true)}>Sim</button>
          <button type="button" className={!program.clubActive ? "active" : ""} disabled={!canWrite || mutation.isPending} onClick={() => mutation.mutate(false)}>Não</button>
        </div>
      </div>
      <div className={`account-card-status ${feedback?.type === "error" ? "error" : ""}`}>
        {mutation.isPending ? <><Clock3 size={14} /> Salvando...</> : feedback ? <><CheckCircle2 size={14} /> {feedback.text}</> : program.nextExpirationDate ? <>Próximo vencimento: {formatDate(program.nextExpirationDate)}</> : "Sem vencimento futuro"}
      </div>
    </article>
  );
}
