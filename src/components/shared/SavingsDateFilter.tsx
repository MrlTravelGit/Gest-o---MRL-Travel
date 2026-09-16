import { CalendarRange, X } from "lucide-react";
import { formatSavingsPeriod, isSavingsDateRangeInvalid } from "@/lib/savings-date-filter";

export function SavingsDateFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  idPrefix,
}: {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  idPrefix: string;
}) {
  const active = Boolean(startDate || endDate);
  const invalid = isSavingsDateRangeInvalid(startDate, endDate);
  return <div className="saving-date-filter">
    <div className="saving-date-filter-title"><CalendarRange size={17} aria-hidden/><div><strong>Filtrar por período</strong>{active && !invalid && <span>Período filtrado: {formatSavingsPeriod(startDate, endDate)}</span>}</div></div>
    <label htmlFor={`${idPrefix}-start`}>De<input id={`${idPrefix}-start`} type="date" value={startDate} max={endDate || undefined} onChange={(event) => onStartDateChange(event.target.value)}/></label>
    <label htmlFor={`${idPrefix}-end`}>Até<input id={`${idPrefix}-end`} type="date" value={endDate} min={startDate || undefined} onChange={(event) => onEndDateChange(event.target.value)}/></label>
    <button type="button" className="saving-date-clear" disabled={!active} onClick={() => { onStartDateChange(""); onEndDateChange(""); }}><X size={14} aria-hidden/> Limpar período</button>
    {invalid && <div className="saving-date-error" role="alert">A data inicial não pode ser posterior à data final.</div>}
  </div>;
}
