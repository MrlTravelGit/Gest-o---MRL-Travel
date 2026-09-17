const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

function brazilDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function getDefaultExchangeRateDate(today = new Date()): string {
  const { year, month, day } = brazilDateParts(today);
  const brazilCalendarDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = brazilCalendarDate.getUTCDay();
  const daysToPreviousFriday = weekday === 6 ? 1 : weekday === 0 ? 2 : 0;
  brazilCalendarDate.setUTCDate(brazilCalendarDate.getUTCDate() - daysToPreviousFriday);
  return brazilCalendarDate.toISOString().slice(0, 10);
}
