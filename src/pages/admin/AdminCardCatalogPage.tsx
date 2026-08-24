import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeDollarSign, CalendarClock, CopyPlus, CreditCard, ExternalLink, Pencil, Power, Save, ShieldCheck, X } from "lucide-react";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { formatDate } from "@/lib/formatters";
import { duplicateCardCatalogVersion, getCardCatalog, setCardCatalogActive, updateCardCatalogRule } from "@/services/card-catalog";
import type { CardCatalogItem, CardCatalogRule, CardRuleUnit } from "@/types/admin-modules";

const qualityLabels = {
  official_exact: "Taxa exata",
  official_up_to: "Taxa máxima divulgada",
  official_conditional: "Condicional",
} as const;

function describeRule(rule: CardCatalogItem["rules"][number]) {
  const value = rule.unitType === "one_point_per_brl_amount"
    ? `1 ponto / R$ ${rule.denominator}`
    : `${rule.rate} ponto(s) / ${rule.unitType === "points_per_usd" ? "US$ 1" : "R$ 1"}`;
  const conditions = [
    rule.spendLocation !== "any" ? rule.spendLocation === "domestic" ? "nacional" : "internacional" : "",
    rule.merchantScope !== "any" ? rule.merchantMatch || rule.merchantScope : "",
    rule.minimumStatementAmount != null ? `fatura ≥ R$ ${rule.minimumStatementAmount}` : "",
    rule.maximumStatementAmount != null ? `fatura ≤ R$ ${rule.maximumStatementAmount}` : "",
    rule.relationshipCondition ? `relacionamento ${rule.relationshipCondition}` : "",
    rule.clubCondition ? `clube/categoria ${rule.clubCondition}` : "",
    rule.acceleratorCondition ? "acelerador ativo" : "",
    rule.automaticDebitCondition ? "débito automático" : "",
  ].filter(Boolean);
  return `${value}${conditions.length ? ` · ${conditions.join(" · ")}` : ""}`;
}

export function AdminCardCatalogPage() {
  const queryClient = useQueryClient();
  const [issuer, setIssuer] = useState("");
  const [program, setProgram] = useState("");
  const [unitType, setUnitType] = useState<CardRuleUnit | "">("");
  const [quality, setQuality] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editor, setEditor] = useState<null | {
    ruleId: string; unitType: CardRuleUnit; value: string; calculationEnabled: boolean;
    requiresReview: boolean; validUntil: string; sourceUrl: string; sourceCheckedAt: string; reason: string;
  }>(null);
  const catalog = useQuery({
    queryKey: ["card-catalog", issuer, program, unitType, quality, includeInactive],
    queryFn: () => getCardCatalog({ issuer, program, unitType, quality, includeInactive }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["card-catalog"] });
  const duplicate = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => duplicateCardCatalogVersion(id, reason),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: ({ id, active, reason }: { id: string; active: boolean; reason: string }) => setCardCatalogActive(id, active, reason),
    onSuccess: refresh,
  });
  const updateRule = useMutation({
    mutationFn: () => {
      if (!editor) throw new Error("Selecione uma regra.");
      const value = Number(editor.value.replace(",", "."));
      return updateCardCatalogRule({
        ruleId: editor.ruleId,
        rate: editor.unitType === "one_point_per_brl_amount" ? null : value,
        denominator: editor.unitType === "one_point_per_brl_amount" ? value : null,
        calculationEnabled: editor.calculationEnabled,
        requiresReview: editor.requiresReview,
        validUntil: editor.validUntil,
        sourceUrl: editor.sourceUrl,
        sourceCheckedAt: editor.sourceCheckedAt,
        reason: editor.reason,
      });
    },
    onSuccess: () => { setEditor(null); void refresh(); },
  });
  const items = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (catalog.data?.items ?? []).filter((item) => !term || [
      item.issuer, item.cardName, item.cardVariant, item.brand, item.rewardsProgram, item.cardSlug,
    ].some((value) => value?.toLocaleLowerCase("pt-BR").includes(term)));
  }, [catalog.data, search]);

  const requestDuplicate = (item: CardCatalogItem) => {
    const reason = window.prompt(`Motivo para duplicar ${item.cardName} como nova versão:`, "Revisão comercial da fonte oficial");
    if (reason) duplicate.mutate({ id: item.catalogVersionId, reason });
  };
  const requestToggle = (item: CardCatalogItem) => {
    const reason = window.prompt(`Motivo para ${item.active ? "desativar" : "reativar"} esta versão:`, "Atualização administrativa do catálogo");
    if (reason) toggle.mutate({ id: item.catalogVersionId, active: !item.active, reason });
  };
  const editRule = (item: CardCatalogItem, rule: CardCatalogRule) => setEditor({
    ruleId: rule.ruleId, unitType: rule.unitType,
    value: String(rule.unitType === "one_point_per_brl_amount" ? rule.denominator ?? "" : rule.rate ?? ""),
    calculationEnabled: rule.calculationEnabled, requiresReview: rule.requiresReview,
    validUntil: rule.validUntil ?? "", sourceUrl: item.sourceUrl,
    sourceCheckedAt: item.sourceCheckedAt, reason: "",
  });

  return <AppShell title="Catálogo de cartões" hideHeading>
    <PageHeader eyebrow="Motor de pontuação" title="Catálogo versionado de cartões" description="Taxas oficiais, condições e vigências ficam no backend. Produtos “até” permanecem bloqueados até a confirmação da condição real do cliente." />
    <section className="catalog-command">
      <div className="catalog-command-copy"><CreditCard /><div><strong>{catalog.data?.items.length ?? 0} versões encontradas</strong><span>54 produtos iniciais · regras por dólar, real, parceiro, faixa e relacionamento</span></div></div>
      <div className="catalog-health"><ShieldCheck /><span>Fonte conferida e histórico preservado</span></div>
    </section>
    <section className="catalog-filter-rail" aria-label="Filtros do catálogo">
      <label className="catalog-search">Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Banco, cartão, bandeira ou programa" /></label>
      <label>Emissor<select value={issuer} onChange={(event) => setIssuer(event.target.value)}><option value="">Todos</option>{catalog.data?.filters.issuers.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Programa<select value={program} onChange={(event) => setProgram(event.target.value)}><option value="">Todos</option>{catalog.data?.filters.programs.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Unidade<select value={unitType} onChange={(event) => setUnitType(event.target.value as CardRuleUnit | "")}><option value="">Dólar e real</option><option value="points_per_usd">Por dólar</option><option value="points_per_brl">Por real</option><option value="one_point_per_brl_amount">1 ponto a cada R$</option></select></label>
      <label>Qualidade<select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="">Todas</option><option value="official_exact">Exata</option><option value="official_conditional">Condicional</option><option value="official_up_to">Máxima (“até”)</option></select></label>
      <label className="catalog-check"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> Inativos</label>
    </section>
    {catalog.isLoading && <LoadingState />}
    {catalog.isError && <ErrorState message={catalog.error.message} />}
    {!catalog.isLoading && !catalog.isError && items.length === 0 && <EmptyState title="Nenhum cartão encontrado" description="Ajuste os filtros para consultar outra parte do catálogo." />}
    <section className="card-catalog-grid">
      {items.map((item) => {
        const open = expanded === item.catalogVersionId;
        return <article className={`card-catalog-record ${item.requiresReview ? "needs-review" : ""} ${!item.active ? "inactive" : ""}`} key={item.catalogVersionId}>
          <button className="card-catalog-summary" onClick={() => setExpanded(open ? null : item.catalogVersionId)} aria-expanded={open}>
            <div className="catalog-issuer-mark">{item.issuer.slice(0, 2).toUpperCase()}</div>
            <div className="catalog-title"><span>{item.issuer} · v{item.version}</span><strong>{item.cardName}{item.cardVariant ? ` ${item.cardVariant}` : ""}</strong><small>{item.brand || "Bandeira não informada"} · {item.rewardsProgram}</small></div>
            <div className="catalog-status-stack">
              <span className={`quality-pill ${item.sourceQuality}`}>{qualityLabels[item.sourceQuality]}</span>
              {item.requiresReview && <span className="review-pill"><AlertTriangle /> Precisa revisar</span>}
            </div>
          </button>
          {open && <div className="card-catalog-detail">
            <div className="catalog-meta-strip">
              <span><CalendarClock /> Conferido em {formatDate(item.sourceCheckedAt)}</span>
              <span>Vigência desde {formatDate(item.validFrom)}{item.validUntil ? ` até ${formatDate(item.validUntil)}` : ""}</span>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">Fonte oficial <ExternalLink /></a>
            </div>
            {item.reviewNotes && <p className="catalog-review-note"><AlertTriangle /> {item.reviewNotes}</p>}
            <div className="catalog-rules">
              <h3>Regras desta versão</h3>
              {item.rules.map((rule) => <div className={`catalog-rule ${!rule.calculationEnabled ? "blocked" : ""}`} key={rule.ruleId}>
                <BadgeDollarSign /><div><strong>{rule.scope}</strong><span>{describeRule(rule)}</span></div>
                <div className="catalog-rule-tools"><span className="rule-state">{rule.calculationEnabled ? "Calcula" : "Bloqueada"}</span><button className="table-action" onClick={() => editRule(item, rule)}><Pencil /> Editar</button></div>
              </div>)}
            </div>
            {editor && item.rules.some((rule) => rule.ruleId === editor.ruleId) && <form className="catalog-rule-editor" onSubmit={(event) => { event.preventDefault(); updateRule.mutate(); }}>
              <div className="catalog-rule-editor-title"><div><span className="eyebrow">Editor auditável</span><h3>Alterar regra da versão</h3></div><button type="button" className="icon-button" aria-label="Fechar editor" onClick={() => setEditor(null)}><X /></button></div>
              <div className="form-grid">
                <label>{editor.unitType === "one_point_per_brl_amount" ? "Denominador em R$" : "Taxa"}<input inputMode="decimal" value={editor.value} onChange={(event) => setEditor((current) => current && ({ ...current, value: event.target.value }))} required /></label>
                <label>Conferido em<input type="date" value={editor.sourceCheckedAt} onChange={(event) => setEditor((current) => current && ({ ...current, sourceCheckedAt: event.target.value }))} required /></label>
                <label>Válida até<input type="date" value={editor.validUntil} onChange={(event) => setEditor((current) => current && ({ ...current, validUntil: event.target.value }))} /></label>
                <label className="binary-line"><input type="checkbox" checked={editor.calculationEnabled} onChange={(event) => setEditor((current) => current && ({ ...current, calculationEnabled: event.target.checked }))} /> Cálculo habilitado</label>
                <label className="binary-line"><input type="checkbox" checked={editor.requiresReview} onChange={(event) => setEditor((current) => current && ({ ...current, requiresReview: event.target.checked }))} /> Precisa revisar</label>
                <label className="field-full">Fonte oficial<input value={editor.sourceUrl} onChange={(event) => setEditor((current) => current && ({ ...current, sourceUrl: event.target.value }))} required /></label>
                <label className="field-full">Motivo da alteração<textarea minLength={10} value={editor.reason} onChange={(event) => setEditor((current) => current && ({ ...current, reason: event.target.value }))} required /></label>
              </div>
              {item.sourceQuality === "official_up_to" && <div className="catalog-contract-warning"><AlertTriangle /><div><strong>Taxa “até” permanece bloqueada</strong><span>A taxa real deve ser confirmada no vínculo individual do cliente.</span></div></div>}
              {updateRule.isError && <div className="form-error">{updateRule.error.message}</div>}
              <button className="primary-button" disabled={updateRule.isPending}><Save /> Salvar regra e auditoria</button>
            </form>}
            <div className="catalog-actions">
              <button className="secondary-button" onClick={() => requestDuplicate(item)} disabled={duplicate.isPending}><CopyPlus /> Duplicar como nova versão</button>
              <button className="secondary-button" onClick={() => requestToggle(item)} disabled={toggle.isPending}><Power /> {item.active ? "Desativar" : "Reativar"}</button>
            </div>
          </div>}
        </article>;
      })}
    </section>
    {(duplicate.isError || toggle.isError) && <div className="form-error">{(duplicate.error ?? toggle.error)?.message}</div>}
  </AppShell>;
}
