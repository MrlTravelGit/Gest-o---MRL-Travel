import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Calculator, CheckCircle2, History, Save, Send, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { parseDecimalPtBr, parseMoneyPtBr, parsePointsPtBr } from "@/lib/admin-inputs";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { calculateMileageCost, type MileageCostRating } from "@/lib/mileage-cost";
import { loadMileageCalculatorAuxiliaryData, mileageProgramFallback, saveMileageSimulation } from "@/services/mileage-calculator";

const ratingLabels: Record<MileageCostRating, string> = {
  excellent: "Excelente",
  good: "Bom",
  attention: "Atenção",
  expensive: "Caro",
};

export function AdminMileageCalculatorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const admin = useQuery({ queryKey: ["mileage-calculator-admin"], queryFn: loadMileageCalculatorAuxiliaryData });
  const [sourceProgramId, setSourceProgramId] = useState("");
  const [targetProgramId, setTargetProgramId] = useState("");
  const [clientId, setClientId] = useState("");
  const [totalPoints, setTotalPoints] = useState("");
  const [pointsUsed, setPointsUsed] = useState("0");
  const [cashAmount, setCashAmount] = useState("");
  const [bonusPercent, setBonusPercent] = useState("0");
  const [pixDiscountPercent, setPixDiscountPercent] = useState("");
  const [clubActive, setClubActive] = useState(false);
  const [notes, setNotes] = useState("");

  const calculation = useMemo(() => {
    try {
      return { result: calculateMileageCost({
        totalPoints: parsePointsPtBr(totalPoints),
        pointsUsed: parsePointsPtBr(pointsUsed),
        cashAmount: parseMoneyPtBr(cashAmount),
        bonusPercent: parseDecimalPtBr(bonusPercent),
        ...(pixDiscountPercent.trim() ? { pixDiscountPercent: parseDecimalPtBr(pixDiscountPercent) } : {}),
      }), error: "" };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : "Revise os valores informados." };
    }
  }, [bonusPercent, cashAmount, pixDiscountPercent, pointsUsed, totalPoints]);

  const save = useMutation({
    mutationFn: () => {
      if (!admin.data?.storageAvailable) throw new Error("Salvamento disponível após atualização do banco.");
      if (admin.data.usingProgramFallback) throw new Error("Aguarde a conexão com o catálogo de programas para salvar.");
      if (!calculation.result || !sourceProgramId || !targetProgramId) throw new Error("Preencha os programas e os valores da simulação.");
      if (sourceProgramId === targetProgramId) throw new Error("Origem e destino devem ser diferentes.");
      return saveMileageSimulation({
        clientId: clientId || undefined,
        sourceProgramId,
        targetProgramId,
        totalPoints: parsePointsPtBr(totalPoints),
        pointsUsed: parsePointsPtBr(pointsUsed),
        cashAmount: parseMoneyPtBr(cashAmount),
        bonusPercent: parseDecimalPtBr(bonusPercent),
        pixDiscountPercent: pixDiscountPercent.trim() ? parseDecimalPtBr(pixDiscountPercent) : undefined,
        clubActive,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["mileage-calculator-admin"] }),
  });

  const auxiliary = admin.data ?? {
    programs: mileageProgramFallback,
    clients: [],
    simulations: [],
    canWrite: false,
    storageAvailable: false,
    usingProgramFallback: true,
    warnings: [],
  };
  const source = auxiliary.programs.find((program) => program.id === sourceProgramId);
  const target = auxiliary.programs.find((program) => program.id === targetProgramId);
  const useInTransfer = () => {
    if (!calculation.result || !source || !target) return;
    navigate("/admin/transferencias", { state: { mileageSimulation: {
      clientId,
      sourceProgramId,
      targetProgramId,
      sourceProgramName: source.name,
      targetProgramName: target.name,
      points: parsePointsPtBr(totalPoints),
      bonusPercent: parseDecimalPtBr(bonusPercent),
      costPerThousand: calculation.result.finalCostPerThousandWithPix ?? calculation.result.finalCostPerThousand,
      notes,
    } } });
  };

  return <AppShell title="Calculadora de Milheiro" hideHeading>
    <PageHeader eyebrow="Análise de oportunidades" title="Calculadora de Milheiro" description="Descubra o custo real de compras de pontos e transferências bonificadas antes de decidir." />
    {(admin.isLoading || auxiliary.warnings.length > 0) && <div className={`mileage-auxiliary-notice ${admin.isLoading ? "loading" : "warning"}`} role="status">
      <span>{admin.isLoading ? "Carregando dados auxiliares. A calculadora já está disponível." : "Não foi possível carregar dados auxiliares, mas a calculadora continua disponível."}</span>
      {!admin.isLoading && auxiliary.usingProgramFallback && <small>Programas principais exibidos em modo local.</small>}
    </div>}
    <div className="mileage-calculator-layout">
      <form className="module-form mileage-calculator-form" onSubmit={(event) => event.preventDefault()}>
        <div className="form-title"><Calculator /><div><h2>Dados da promoção</h2><p>O dinheiro é rateado apenas pelos pontos efetivamente comprados.</p></div></div>
        <div className="form-grid">
          <label className="field-wide">Programa de origem<select value={sourceProgramId} onChange={(event) => { setSourceProgramId(event.target.value); if (event.target.value === targetProgramId) setTargetProgramId(""); }}><option value="">Selecione</option>{auxiliary.programs.filter((program) => program.isTransferSource).map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select>{auxiliary.usingProgramFallback && <small className="mileage-field-note">Catálogo local temporário</small>}</label>
          <label className="field-wide">Programa de destino<select value={targetProgramId} onChange={(event) => setTargetProgramId(event.target.value)}><option value="">Selecione</option>{auxiliary.programs.filter((program) => program.isTransferTarget && program.id !== sourceProgramId).map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select>{auxiliary.usingProgramFallback && <small className="mileage-field-note">Catálogo local temporário</small>}</label>
          <label className="field-wide">Cliente <small>(opcional)</small><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Sem cliente vinculado</option>{auxiliary.clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.fullName}</option>)}</select>{auxiliary.warnings.includes("clients") && <small className="mileage-field-note">Clientes indisponíveis no momento</small>}</label>
          <label>Pontos ou milhas que deseja receber<input inputMode="numeric" placeholder="100.000" value={totalPoints} onChange={(event) => setTotalPoints(event.target.value)} /></label>
          <label>Pontos usados pelo cliente<input inputMode="numeric" placeholder="1.000" value={pointsUsed} onChange={(event) => setPointsUsed(event.target.value)} /></label>
          <label>Valor pago em dinheiro<input inputMode="decimal" placeholder="R$ 3.130,68" value={cashAmount} onChange={(event) => setCashAmount(event.target.value)} /></label>
          <label>Percentual de bônus<input inputMode="decimal" placeholder="80" value={bonusPercent} onChange={(event) => setBonusPercent(event.target.value)} /></label>
          <label>Desconto no Pix <small>(opcional)</small><input inputMode="decimal" placeholder="2" value={pixDiscountPercent} onChange={(event) => setPixDiscountPercent(event.target.value)} /></label>
          <fieldset className="mileage-club-control"><legend>Clube ativo</legend><button type="button" className={!clubActive ? "active" : ""} onClick={() => setClubActive(false)}>Não</button><button type="button" className={clubActive ? "active" : ""} onClick={() => setClubActive(true)}>Sim</button></fieldset>
          <label className="field-full">Observações da promoção<textarea rows={4} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Prazo, elegibilidade, regras do clube e demais condições." /></label>
        </div>
      </form>

      <aside className={`mileage-result-card ${calculation.result?.rating ?? "pending"}`} aria-live="polite">
        <header><span>Resultado em tempo real</span><Sparkles /></header>
        {!calculation.result ? <div className="mileage-result-empty"><WalletCards /><strong>Preencha os valores</strong><p>{calculation.error}</p></div> : <>
          <div className="mileage-rating"><span>Oportunidade</span><strong>{ratingLabels[calculation.result.rating]}</strong></div>
          <div className="mileage-primary-result"><span>Custo final por milheiro</span><strong>{formatCurrency(calculation.result.finalCostPerThousandWithPix ?? calculation.result.finalCostPerThousand)}</strong><small>{calculation.result.finalCostPerThousandWithPix !== undefined ? "com desconto Pix" : "com bônus aplicado"}</small></div>
          <dl className="mileage-result-grid">
            <div><dt>Pontos comprados</dt><dd>{formatPoints(calculation.result.cashPurchasedPoints)}</dd></div>
            <div><dt>Milheiros comprados</dt><dd>{new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(calculation.result.cashPurchasedThousands)}</dd></div>
            <div><dt>Custo antes do bônus</dt><dd>{formatCurrency(calculation.result.baseCostPerThousand)}</dd></div>
            <div><dt>Fator de bônus</dt><dd>{calculation.result.bonusFactor.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}x</dd></div>
            <div className="wide"><dt>Total estimado com bônus</dt><dd>{formatPoints(calculation.result.finalPointsWithBonus)} pontos</dd></div>
            {calculation.result.finalCostPerThousandWithPix !== undefined && <div className="wide"><dt>Antes do desconto Pix</dt><dd>{formatCurrency(calculation.result.finalCostPerThousand)}</dd></div>}
          </dl>
          <div className="mileage-actions"><button className="primary-button" type="button" disabled={!auxiliary.storageAvailable || !auxiliary.canWrite || auxiliary.usingProgramFallback || save.isPending || !sourceProgramId || !targetProgramId} onClick={() => save.mutate()} title={!auxiliary.storageAvailable ? "Salvamento disponível após atualização do banco." : undefined}><Save size={17} /> {save.isPending ? "Salvando..." : "Salvar simulação"}</button>{!auxiliary.storageAvailable && <span className="mileage-save-unavailable">Salvamento disponível após atualização do banco.</span>}{auxiliary.storageAvailable && auxiliary.usingProgramFallback && <span className="mileage-save-unavailable">Salvamento temporariamente indisponível sem o catálogo oficial.</span>}<button className="secondary-button" type="button" disabled={!sourceProgramId || !targetProgramId} onClick={useInTransfer}><Send size={17} /> Usar em transferência</button></div>
          {save.isSuccess && <div className="form-success"><CheckCircle2 size={16} /> Simulação salva sem alterar saldos.</div>}
          {save.isError && <div className="form-error">{save.error.message}</div>}
        </>}
        <footer><ShieldCheck /><span>Ferramenta de análise. Nenhuma movimentação é lançada automaticamente.</span></footer>
      </aside>
    </div>

    <section className="mileage-history-section">
      <div className="section-heading"><div><span className="eyebrow">Histórico</span><h2>Simulações salvas</h2><p>Registros recentes para apoiar a tomada de decisão.</p></div><History /></div>
      {auxiliary.simulations.length === 0 ? <div className="empty-state">Nenhuma simulação carregada.</div> : <div className="mileage-history-grid">{auxiliary.simulations.map((simulation) => <article key={simulation.id}>
        <header><div><strong>{simulation.sourceProgramName}</strong><ArrowRight /><strong>{simulation.targetProgramName}</strong></div><span className={`mileage-rating-pill ${simulation.rating}`}>{ratingLabels[simulation.rating]}</span></header>
        <b>{formatCurrency(simulation.finalCostPerThousandWithPix ?? simulation.finalCostPerThousand)} <small>/ milheiro</small></b>
        <p>{formatPoints(simulation.totalPoints)} pontos · {simulation.bonusPercent}% de bônus{simulation.clientName ? ` · ${simulation.clientName}` : ""}</p>
        <footer><span>{formatDate(simulation.simulatedAt)}</span><span>{simulation.createdByName ?? "Administrador"}</span></footer>
      </article>)}</div>}
    </section>
  </AppShell>;
}
