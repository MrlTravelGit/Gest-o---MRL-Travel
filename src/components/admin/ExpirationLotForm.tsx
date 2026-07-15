import { FormEvent, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Save } from "lucide-react";
import { addExpirationLot } from "@/services/admin-clients";
import type { AdminProgramDetail } from "@/types/admin-clients";

function todayInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function ExpirationLotForm({ clientId, programs, canWrite }: {
  clientId: string;
  programs: AdminProgramDetail[];
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const submitLock = useRef(false);
  const [programId, setProgramId] = useState("");
  const [points, setPoints] = useState("");
  const [expiresOn, setExpiresOn] = useState(todayInput);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const mutation = useMutation({
    mutationFn: addExpirationLot,
    onSuccess: async () => {
      setMessage({ type: "success", text: "Vencimento cadastrado sem alterar o saldo." });
      setPoints("");
      setNotes("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-client-detail", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
      ]);
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current || mutation.isPending) return;
    setMessage(null);
    const pointsAmount = Number(points);
    if (!programId) return setMessage({ type: "error", text: "Selecione um programa." });
    if (!Number.isInteger(pointsAmount) || pointsAmount <= 0) return setMessage({ type: "error", text: "Informe uma quantidade maior que zero." });
    if (expiresOn < todayInput()) return setMessage({ type: "error", text: "A data de vencimento não pode estar no passado." });
    submitLock.current = true;
    try {
      await mutation.mutateAsync({ clientId, programId, pointsAmount, expiresOn, notes: notes.trim() || undefined });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "O lançamento não foi concluído. Nenhum dado foi alterado." });
    } finally {
      submitLock.current = false;
    }
  }

  return (
    <section className="management-panel expiration-form-panel">
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">Validade</span><h2>Adicionar vencimento</h2><p>Classifica pontos existentes; não altera o saldo.</p></div>
        <CalendarPlus className="section-icon" aria-hidden="true" />
      </div>
      <form className="expiration-form" onSubmit={submit}>
        <label>Programa<select value={programId} onChange={(event) => setProgramId(event.target.value)}><option value="">Selecione</option>{programs.map((program) => <option key={program.programId} value={program.programId}>{program.name}</option>)}</select></label>
        <label>Quantidade<input inputMode="numeric" value={points} onChange={(event) => setPoints(event.target.value.replace(/\D/g, ""))} /></label>
        <label>Data de vencimento<input type="date" min={todayInput()} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
        <label className="full-field">Observação<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {message && <div className={message.type === "error" ? "form-error full-field" : "form-success full-field"} role={message.type === "error" ? "alert" : "status"}>{message.text}</div>}
        <button className="primary-button full-field" disabled={!canWrite || mutation.isPending}><Save size={18} /> {mutation.isPending ? "Salvando..." : canWrite ? "Adicionar vencimento" : "Somente leitura"}</button>
      </form>
    </section>
  );
}
