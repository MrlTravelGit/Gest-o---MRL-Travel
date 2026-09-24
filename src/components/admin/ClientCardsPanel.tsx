import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CreditCard, Plus, ShieldAlert, X } from "lucide-react";
import { formatDate } from "@/lib/formatters";
import { associateCatalogCard, getCardCatalog, getClientCatalogCards } from "@/services/card-catalog";
import type { CardRuleUnit } from "@/types/admin-modules";

const today = new Date().toISOString().slice(0, 10);

export function ClientCardsPanel({ clientId, canWrite }: { clientId: string; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    catalogVersionId: "", startedOn: today, lastFour: "", ownership: "holder" as "holder" | "additional",
    rewardMode: "points" as "points" | "cashback", relationshipCondition: "", clubCondition: "",
    eliteCategoryCondition: "", acceleratorActive: false, automaticDebitActive: false,
    customRate: "", customUnitType: "points_per_usd" as CardRuleUnit,
    customRateJustification: "", customRateSource: "", notes: "",
  });
  const cards = useQuery({ queryKey: ["client-catalog-cards", clientId], queryFn: () => getClientCatalogCards(clientId) });
  const catalog = useQuery({ queryKey: ["card-catalog-client-association"], queryFn: () => getCardCatalog(), enabled: open });
  const products = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (catalog.data?.items ?? []).filter((item) => !term || [
      item.issuer, item.cardName, item.displayName, item.accountType, item.cardVariant, item.brand, item.rewardsProgram,
    ].some((value) => value?.toLocaleLowerCase("pt-BR").includes(term)));
  }, [catalog.data, search]);
  const selected = catalog.data?.items.find((item) => item.catalogVersionId === form.catalogVersionId);
  const save = useMutation({
    mutationFn: () => associateCatalogCard({
      clientId, catalogVersionId: form.catalogVersionId, startedOn: form.startedOn,
      lastFour: form.lastFour, ownership: form.ownership, rewardMode: form.rewardMode,
      relationshipCondition: form.relationshipCondition, clubCondition: form.clubCondition,
      eliteCategoryCondition: form.eliteCategoryCondition, acceleratorActive: form.acceleratorActive,
      automaticDebitActive: form.automaticDebitActive,
      customRate: form.customRate ? Number(form.customRate.replace(",", ".")) : null,
      customUnitType: form.customRate ? form.customUnitType : null,
      customRateJustification: form.customRateJustification, customRateSource: form.customRateSource,
      notes: form.notes,
    }),
    onSuccess: () => {
      setOpen(false);
      setForm((current) => ({ ...current, catalogVersionId: "", lastFour: "", customRate: "", customRateJustification: "", customRateSource: "", notes: "" }));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-catalog-cards", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["card-options"] }),
      ]);
    },
  });

  return <section className="client-cards-panel data-section">
    <div className="section-heading">
      <div><span className="eyebrow">Cartões do cliente</span><h2>Produtos e condições contratadas</h2></div>
      {canWrite && <button className="primary-button" onClick={() => setOpen(true)}><Plus /> Adicionar cartão</button>}
    </div>
    {cards.isLoading && <p className="muted-cell">Carregando cartões…</p>}
    {cards.isError && <div className="form-error">{cards.error.message}</div>}
    {cards.data?.length === 0 && <div className="client-cards-empty"><CreditCard /><span>Nenhum cartão do catálogo associado.</span></div>}
    {cards.data && cards.data.length > 0 && <div className="client-card-chips">
      {cards.data.map((card) => <article key={card.cardId}>
        <div className="client-card-icon"><CreditCard /></div>
        <div><span>{card.issuer} · {card.rewardsProgram}</span><strong>{card.cardName}{card.variant ? ` ${card.variant}` : ""}</strong><small>v{card.version} · início {formatDate(card.startedOn)}{card.lastFour ? ` · final ${card.lastFour}` : ""} · {card.ownership === "holder" ? "titular" : "adicional"}</small></div>
        <span className={`calculation-badge ${card.calculationReady ? "ready" : "blocked"}`}>{card.calculationReady ? <><CheckCircle2 /> Pronto para calcular</> : <><ShieldAlert /> Confirmação pendente</>}</span>
      </article>)}
    </div>}

    {open && <div className="catalog-modal-backdrop" role="presentation">
      <form className="catalog-association-modal" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <div className="catalog-modal-header"><div><span className="eyebrow">Novo vínculo</span><h2>Adicionar cartão ao cliente</h2></div><button type="button" className="icon-button" aria-label="Fechar" onClick={() => setOpen(false)}><X /></button></div>
        <label className="field-full">Buscar no catálogo<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Banco, cartão, bandeira ou programa" /></label>
        <label className="field-full">Produto e versão<select value={form.catalogVersionId} onChange={(event) => setForm((current) => ({ ...current, catalogVersionId: event.target.value }))} required><option value="">Selecione entre {products.length} opções</option>{products.map((item) => <option value={item.catalogVersionId} key={item.catalogVersionId}>{item.displayName || `${item.issuer} ${item.cardName}`} · {item.accountType || "tipo não informado"} · {item.rewardsProgram} · v{item.version}</option>)}</select></label>
        {selected?.sourceQuality === "official_up_to" && <div className="catalog-contract-warning"><AlertTriangle /><div><strong>Taxa divulgada como “até”</strong><span>O sistema não usará a taxa máxima. Confirme abaixo a taxa real contratada, com justificativa e fonte.</span></div></div>}
        <div className="form-grid">
          <label>Início do uso<input type="date" value={form.startedOn} onChange={(event) => setForm((current) => ({ ...current, startedOn: event.target.value }))} required /></label>
          <label>Últimos 4 dígitos<input inputMode="numeric" maxLength={4} value={form.lastFour} onChange={(event) => setForm((current) => ({ ...current, lastFour: event.target.value.replace(/\D/g, "").slice(0, 4) }))} placeholder="Opcional" /></label>
          <label>Titularidade<select value={form.ownership} onChange={(event) => setForm((current) => ({ ...current, ownership: event.target.value as "holder" | "additional" }))}><option value="holder">Titular</option><option value="additional">Adicional</option></select></label>
          <label>Modalidade ativa<select value={form.rewardMode} onChange={(event) => setForm((current) => ({ ...current, rewardMode: event.target.value as "points" | "cashback" }))}><option value="points">Pontos</option><option value="cashback">Cashback</option></select></label>
          <label>Relacionamento<input value={form.relationshipCondition} onChange={(event) => setForm((current) => ({ ...current, relationshipCondition: event.target.value }))} placeholder="Select, Private…" /></label>
          <label>Clube<input value={form.clubCondition} onChange={(event) => setForm((current) => ({ ...current, clubCondition: event.target.value }))} placeholder="Clube Smiles…" /></label>
          <label>Categoria<input value={form.eliteCategoryCondition} onChange={(event) => setForm((current) => ({ ...current, eliteCategoryCondition: event.target.value }))} placeholder="Diamante…" /></label>
          <label className="binary-line"><input type="checkbox" checked={form.acceleratorActive} onChange={(event) => setForm((current) => ({ ...current, acceleratorActive: event.target.checked }))} /> Acelerador ativo</label>
          <label className="binary-line"><input type="checkbox" checked={form.automaticDebitActive} onChange={(event) => setForm((current) => ({ ...current, automaticDebitActive: event.target.checked }))} /> Débito automático</label>
        </div>
        {selected && !selected.calculationEnabled && <fieldset className="custom-rate-fieldset"><legend>Confirmação da taxa real</legend><div className="form-grid">
          <label>Taxa/denominador<input inputMode="decimal" value={form.customRate} onChange={(event) => setForm((current) => ({ ...current, customRate: event.target.value }))} required /></label>
          <label>Unidade<select value={form.customUnitType} onChange={(event) => setForm((current) => ({ ...current, customUnitType: event.target.value as CardRuleUnit }))}><option value="points_per_usd">Pontos por US$</option><option value="points_per_brl">Pontos por R$</option><option value="one_point_per_brl_amount">1 ponto a cada R$</option></select></label>
          <label className="field-full">Justificativa<textarea minLength={10} required value={form.customRateJustification} onChange={(event) => setForm((current) => ({ ...current, customRateJustification: event.target.value }))} /></label>
          <label className="field-full">Fonte da taxa contratada<input required value={form.customRateSource} onChange={(event) => setForm((current) => ({ ...current, customRateSource: event.target.value }))} /></label>
        </div></fieldset>}
        <label className="field-full">Observações<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
        {save.isError && <div className="form-error">{save.error.message}</div>}
        <div className="catalog-modal-actions"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-button" disabled={save.isPending || !form.catalogVersionId}>{save.isPending ? "Salvando…" : "Associar cartão"}</button></div>
        <p className="security-footnote"><ShieldAlert /> Nunca informe número completo, CVV, senha ou validade.</p>
      </form>
    </div>}
  </section>;
}
