import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, PlaneTakeoff } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ClientSelect, ProgramAccountSelect, StatusBadge } from "@/components/admin/AdminFields";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/admin/AdminPage";
import { AppShell } from "@/components/layout/AppShell";
import { calculateTravelSavings, parseMoneyPtBr, parsePointsPtBr } from "@/lib/admin-inputs";
import { formatCurrency, formatDate, formatPoints } from "@/lib/formatters";
import { getAdminFormOptions } from "@/services/admin-options";
import { getTravelSales, recordTravelSale } from "@/services/travel-economy";

const today = new Date().toISOString().slice(0, 10);
const numeric = z.string().refine((value) => { try { return parseMoneyPtBr(value) >= 0; } catch { return false; } }, "Informe um valor válido");
const schema = z.object({ clientId: z.string().uuid("Selecione o cliente"), launchedOn: z.string().min(1).refine((value) => value <= today, "A data não pode estar no futuro"), paymentMode: z.enum(["cash", "miles"]), travelType: z.enum(["flight", "hotel", "other"]), details: z.string().trim().min(3, "Descreva a viagem"), originalValue: numeric, paidValue: numeric, accountId: z.string(), pointsUsed: z.string() }).refine((value) => value.paymentMode !== "miles" || (Boolean(value.accountId) && (() => { try { return parsePointsPtBr(value.pointsUsed) > 0; } catch { return false; } })()), { path: ["pointsUsed"], message: "Informe conta e pontos utilizados" });
type FormData = z.infer<typeof schema>;

export function AdminTravelEconomyPage() {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["admin-form-options"], queryFn: getAdminFormOptions });
  const [filterClient, setFilterClient] = useState("");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [offset, setOffset] = useState(0);
  const sales = useQuery({ queryKey: ["travel-sales", filterClient, filterStart, filterEnd, offset], queryFn: () => getTravelSales({ clientId: filterClient || undefined, startDate: filterStart || undefined, endDate: filterEnd || undefined, offset }) });
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const form = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { clientId: "", launchedOn: today, paymentMode: "cash", travelType: "flight", details: "", originalValue: "", paidValue: "", accountId: "", pointsUsed: "" } });
  const clientId = form.watch("clientId");
  const paymentMode = form.watch("paymentMode");
  const client = options.data?.clients.find((item) => item.clientId === clientId);
  const savings = useMemo(() => { try { return calculateTravelSavings(parseMoneyPtBr(form.watch("originalValue")), parseMoneyPtBr(form.watch("paidValue"))); } catch { return 0; } }, [form.watch("originalValue"), form.watch("paidValue")]);
  const mutation = useMutation({ mutationFn: recordTravelSale, onSuccess: () => { setOperationId(crypto.randomUUID()); form.reset({ ...form.getValues(), details: "", originalValue: "", paidValue: "", pointsUsed: "" }); void Promise.all([queryClient.invalidateQueries({ queryKey: ["travel-sales"] }), queryClient.invalidateQueries({ queryKey: ["admin-overview"] }), queryClient.invalidateQueries({ queryKey: ["admin-form-options"] })]); } });
  const submit = form.handleSubmit((value) => mutation.mutate({ clientId: value.clientId, launchedOn: value.launchedOn, paymentMode: value.paymentMode, travelType: value.travelType, details: value.details, originalValue: parseMoneyPtBr(value.originalValue), paidValue: parseMoneyPtBr(value.paidValue), accountId: value.paymentMode === "miles" ? value.accountId : undefined, pointsUsed: value.paymentMode === "miles" ? parsePointsPtBr(value.pointsUsed) : undefined, operationId }));
  return <AppShell title="Viagens e Economia" hideHeading>
    <PageHeader eyebrow="Operação comercial" title="Viagens de Clientes / Economia" description="A referência e o valor pago fecham no backend; resultados negativos permanecem visíveis." />
    {options.isLoading && <LoadingState />}{options.isError && <ErrorState message={options.error.message} />}
    {options.data && <form className="module-form operation-form" onSubmit={submit}><div className="form-title"><PlaneTakeoff /><div><h2>Novo lançamento</h2><p>Em viagens com milhas, confirmar também realiza a baixa atômica indicada.</p></div></div><div className="form-grid"><label>Cliente<ClientSelect clients={options.data.clients} value={clientId} onChange={(value) => { form.setValue("clientId", value, { shouldValidate: true }); form.setValue("accountId", ""); }} /></label><label>Data<input type="date" max={today} {...form.register("launchedOn")} /></label><label>Forma<select {...form.register("paymentMode")}><option value="cash">Dinheiro</option><option value="miles">Milhas</option></select></label><label>Tipo<select {...form.register("travelType")}><option value="flight">Voo</option><option value="hotel">Hotel</option><option value="other">Outro</option></select></label>{paymentMode === "miles" && <><label>Programa<ProgramAccountSelect client={client} value={form.watch("accountId")} onChange={(value) => form.setValue("accountId", value, { shouldValidate: true })} /></label><label>Pontos utilizados<input inputMode="numeric" placeholder="20.000" {...form.register("pointsUsed")} />{form.formState.errors.pointsUsed && <small className="field-error">{form.formState.errors.pointsUsed.message}</small>}</label></>}<label>Valor original<input inputMode="decimal" placeholder="5.000,00" {...form.register("originalValue")} /></label><label>Valor pago<input inputMode="decimal" placeholder="3.200,00" {...form.register("paidValue")} /></label><label className="field-full">Detalhes do voo / viagem<textarea {...form.register("details")} /></label></div><div className={`calculated-strip ${savings < 0 ? "negative" : ""}`}><Calculator /><span>Economia calculada</span><strong>{formatCurrency(savings)}</strong></div>{mutation.isError && <div className="form-error">{mutation.error.message}</div>}{mutation.isSuccess && <div className="form-success">Viagem registrada e economia recalculada pelo backend.</div>}<button className="primary-button" disabled={!options.data.canWrite || mutation.isPending}>{mutation.isPending ? "Confirmando..." : "Registrar viagem"}</button></form>}
    <section className="data-section"><div className="section-heading"><div><span className="eyebrow">Histórico</span><h2>Lançamentos recentes</h2><p>{sales.data ? `${sales.data.total} registros · ${formatCurrency(sales.data.totalSavings)} de economia filtrada` : "Dados oficiais"}</p></div></div>
      {options.data && <div className="data-filters"><ClientSelect clients={options.data.clients} value={filterClient} onChange={(value) => { setFilterClient(value); setOffset(0); }} id="travel-filter-client" /><input aria-label="Data inicial" type="date" value={filterStart} onChange={(event) => { setFilterStart(event.target.value); setOffset(0); }} /><input aria-label="Data final" type="date" value={filterEnd} onChange={(event) => { setFilterEnd(event.target.value); setOffset(0); }} /></div>}
      {sales.isLoading && <LoadingState />}{sales.isError && <ErrorState message={sales.error.message} retry={() => void sales.refetch()} />}{sales.data?.items.length === 0 && <EmptyState title="Nenhuma viagem registrada" description="Use o formulário para criar o primeiro lançamento." />}{sales.data && sales.data.items.length > 0 && <><div className="responsive-table"><table><thead><tr><th>Cliente</th><th>Data</th><th>Forma</th><th>Valores</th><th>Economia</th><th>Detalhes</th></tr></thead><tbody>{sales.data.items.map((item) => <tr key={item.id}><td><strong>{item.clientName}</strong>{item.programName && <small>{item.programName} · {formatPoints(item.pointsUsed ?? 0)} pts</small>}</td><td>{formatDate(item.launchedOn)}</td><td><StatusBadge status={item.paymentMode} /></td><td><strong>{formatCurrency(item.originalValue)}</strong><small>Pago {formatCurrency(item.paidValue)}</small></td><td className={item.savingsAmount < 0 ? "value-negative" : "value-positive"}>{formatCurrency(item.savingsAmount)}</td><td className="table-notes">{item.details}</td></tr>)}</tbody></table></div><Pagination offset={offset} total={sales.data.total} pending={sales.isFetching} setOffset={setOffset} /></>}
    </section>
  </AppShell>;
}

function Pagination({ offset, total, pending, setOffset }: { offset: number; total: number; pending: boolean; setOffset: (value: number) => void }) { return <div className="pagination-bar"><span>{offset + 1}–{Math.min(offset + 20, total)} de {total}</span><div><button className="secondary-button" disabled={!offset || pending} onClick={() => setOffset(Math.max(0, offset - 20))}>Anterior</button><button className="secondary-button" disabled={offset + 20 >= total || pending} onClick={() => setOffset(offset + 20)}>Próxima</button></div></div>; }
