import { FormEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Calculator, Save } from "lucide-react";
import { formatCurrency, formatPoints } from "@/lib/formatters";
import {
  calculateFromPerThousand,
  calculateFromTotal,
  formatBrlInput,
  parseBrlInput,
} from "@/lib/points-cost";
import { recordPointEntry } from "@/services/admin-clients";
import type {
  AdminProgramDetail,
  PointEntryCategory,
  RecordPointEntryResult,
  ValuationMode,
} from "@/types/admin-clients";

const ENTRY_OPTIONS: Array<{ value: PointEntryCategory; label: string }> = [
  { value: "initial_balance", label: "Saldo Inicial" },
  { value: "points_purchase", label: "Compra de pontos" },
  { value: "transfer", label: "Transferência" },
  { value: "credit_card", label: "Cartão de Crédito" },
  { value: "other", label: "Outros" },
];

function todayInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function moneyInputFromNumber(value: number): string {
  return formatBrlInput(String(Math.round(value * 100)));
}

export function ClientPointsForm({
  clientId,
  publicId,
  clientName,
  programs,
  canWrite,
  disabledReason,
}: {
  clientId: string;
  publicId: string;
  clientName: string;
  programs: AdminProgramDetail[];
  canWrite: boolean;
  disabledReason?: string;
}) {
  const queryClient = useQueryClient();
  const submitLock = useRef(false);
  const [programId, setProgramId] = useState("");
  const [entryCategory, setEntryCategory] = useState<PointEntryCategory>("points_purchase");
  const [entryDate, setEntryDate] = useState(todayInput);
  const [expiresOn, setExpiresOn] = useState("");
  const [pointsInput, setPointsInput] = useState("");
  const [valuationMode, setValuationMode] = useState<ValuationMode>("total_value");
  const [moneyInput, setMoneyInput] = useState("R$ 0,00");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState<RecordPointEntryResult | null>(null);

  const selectedProgram = programs.find((program) => program.programId === programId);
  const pointsAmount = Number(pointsInput);
  const enteredValue = parseBrlInput(moneyInput);
  const calculation = useMemo(() => {
    try {
      if (!Number.isInteger(pointsAmount) || pointsAmount <= 0 || enteredValue === null) return null;
      return valuationMode === "total_value"
        ? calculateFromTotal(pointsAmount, enteredValue)
        : calculateFromPerThousand(pointsAmount, enteredValue);
    } catch {
      return null;
    }
  }, [enteredValue, pointsAmount, valuationMode]);

  const mutation = useMutation({
    mutationFn: recordPointEntry,
    onSuccess: async (result) => {
      setSuccess(result);
      setPointsInput("");
      setMoneyInput("R$ 0,00");
      setExpiresOn("");
      setNotes("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-client-detail", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["admin-clients"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
        queryClient.invalidateQueries({ queryKey: ["client-dashboard", publicId] }),
      ]);
    },
  });

  function switchMode(nextMode: ValuationMode) {
    if (nextMode === valuationMode) return;
    const nextValue = calculation
      ? nextMode === "total_value" ? calculation.totalValue : calculation.perThousand
      : 0;
    setValuationMode(nextMode);
    setMoneyInput(moneyInputFromNumber(nextValue));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current || mutation.isPending) return;
    setFormError("");
    setSuccess(null);
    if (!programId) return setFormError("Selecione um programa.");
    if (!Number.isInteger(pointsAmount) || pointsAmount <= 0) return setFormError("Informe uma quantidade maior que zero.");
    if (entryDate > todayInput()) return setFormError("A data da entrada não pode estar no futuro.");
    if (expiresOn && expiresOn < entryDate) return setFormError("A validade não pode ser anterior à entrada.");
    if (entryCategory === "other" && !notes.trim()) return setFormError("Informe a observação para o tipo Outros.");
    if (enteredValue === null || !calculation) return setFormError("Informe o valor da entrada.");

    submitLock.current = true;
    try {
      await mutation.mutateAsync({
        clientId,
        programId,
        entryCategory,
        entryDate,
        pointsAmount,
        valuationMode,
        enteredValue,
        expiresOn: expiresOn || undefined,
        notes: notes.trim() || undefined,
        operationId: crypto.randomUUID(),
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "O lançamento não foi concluído. Nenhum dado foi alterado.");
    } finally {
      submitLock.current = false;
    }
  }

  return (
    <section className="management-panel points-entry-panel">
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">Movimentação</span><h2>Lançar pontos</h2><p>O banco recalcula saldo e custo médio em uma única transação.</p></div>
        <Calculator className="section-icon" aria-hidden="true" />
      </div>
      <form className="points-form" onSubmit={submit}>
        {disabledReason && <div className="lead-operation-lock full-field">{disabledReason}</div>}
        <label>Cliente<input value={clientName} readOnly /></label>
        <label>Programa
          <select value={programId} onChange={(event) => setProgramId(event.target.value)} required>
            <option value="">Selecione</option>
            {programs.map((program) => <option key={program.programId} value={program.programId}>{program.name}</option>)}
          </select>
        </label>
        <label>Saldo atual<input value={formatPoints(selectedProgram?.balance ?? 0)} readOnly /></label>
        <label>Custo médio atual<input value={formatCurrency(selectedProgram?.averageCostPerThousand ?? 0)} readOnly /></label>
        <label>Tipo
          <select value={entryCategory} onChange={(event) => setEntryCategory(event.target.value as PointEntryCategory)}>
            {ENTRY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>Data da entrada<input type="date" max={todayInput()} value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required /></label>
        <label>Validade das milhas<input type="date" min={entryDate} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
        <label>Pontos ou milhas<input inputMode="numeric" value={pointsInput} onChange={(event) => setPointsInput(event.target.value.replace(/\D/g, ""))} required /></label>

        <fieldset className="valuation-fieldset full-field">
          <legend>Como deseja informar o custo?</legend>
          <div className="segmented-control" aria-label="Modo de valorização">
            <button type="button" className={valuationMode === "total_value" ? "active" : ""} onClick={() => switchMode("total_value")}>VT <small>Valor Total</small></button>
            <button type="button" className={valuationMode === "per_thousand" ? "active" : ""} onClick={() => switchMode("per_thousand")}>VM <small>Valor do Milheiro</small></button>
          </div>
        </fieldset>

        <label>Valor Total
          <input
            inputMode="decimal"
            value={valuationMode === "total_value" ? moneyInput : formatCurrency(calculation?.totalValue ?? 0)}
            onChange={(event) => valuationMode === "total_value" && setMoneyInput(formatBrlInput(event.target.value))}
            readOnly={valuationMode !== "total_value"}
          />
        </label>
        <label>Valor do Milheiro
          <input
            inputMode="decimal"
            value={valuationMode === "per_thousand" ? moneyInput : formatCurrency(calculation?.perThousand ?? 0)}
            onChange={(event) => valuationMode === "per_thousand" && setMoneyInput(formatBrlInput(event.target.value))}
            readOnly={valuationMode !== "per_thousand"}
          />
        </label>
        <label className="full-field">Observação<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="20.000 pontos referentes ao Clube Smiles." /></label>
        {formError && <div className="form-error full-field" role="alert">{formError}</div>}
        {success && <div className="form-success full-field" role="status">Lançamento salvo. Novo saldo: {formatPoints(success.newBalance)}.</div>}
        <button className="primary-button full-field" disabled={!canWrite || mutation.isPending}>
          <Save size={18} /> {mutation.isPending ? "Salvando..." : canWrite ? "Salvar lançamento" : disabledReason ?? "Somente leitura"}
        </button>
      </form>
    </section>
  );
}
