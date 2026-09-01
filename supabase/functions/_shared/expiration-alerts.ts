export const DEFAULT_THRESHOLDS = [90, 60, 30, 15, 7, 1] as const;
export type AlertType = "points_expiration" | "management_expiration";

export interface AlertCandidate {
  alert_type: AlertType;
  client_id: string;
  client_name: string;
  program_name: string;
  points_amount: number | null;
  expires_at: string;
  threshold_days: number;
  days_remaining: number;
}

export function normalizeThresholds(input: unknown): number[] {
  if (!Array.isArray(input)) throw new Error("Informe os dias de antecedência.");
  const values = [...new Set(input.map(Number))].filter((value) => Number.isInteger(value) && value > 0 && value <= 180).sort((a, b) => b - a);
  if (!values.includes(90)) throw new Error("O alerta principal de 90 dias é obrigatório.");
  if (!values.length || values.length > 12) throw new Error("Quantidade de janelas inválida.");
  return values;
}

export function formatBrazilDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function formatPoints(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

export function buildTelegramMessage(candidate: AlertCandidate, adminUrl: string): string {
  const link = `${adminUrl.replace(/\/$/, "")}/admin/clientes/${encodeURIComponent(candidate.client_id)}`;
  if (candidate.alert_type === "points_expiration") {
    return [
      "⚠️ Alerta de pontos a vencer", "",
      `Cliente: ${candidate.client_name}`,
      `Programa: ${candidate.program_name}`,
      `Pontos: ${formatPoints(candidate.points_amount ?? 0)}`,
      `Vencimento: ${formatBrazilDate(candidate.expires_at)}`,
      `Faltam: ${candidate.days_remaining} dia${candidate.days_remaining === 1 ? "" : "s"}`, "",
      "Ação sugerida:",
      "Avaliar emissão, transferência, renovação ou estratégia de uso.", "",
      "Abrir cliente:", link,
    ].join("\n");
  }
  return [
    "⚠️ Alerta de gestão a vencer", "",
    `Cliente: ${candidate.client_name}`,
    `Vencimento da gestão: ${formatBrazilDate(candidate.expires_at)}`,
    `Faltam: ${candidate.days_remaining} dia${candidate.days_remaining === 1 ? "" : "s"}`, "",
    "Ação sugerida:",
    "Entrar em contato para renovação, revisão de saldo e próximos objetivos de viagem.", "",
    "Abrir cliente:", link,
  ].join("\n");
}

export function safeTelegramError(status: number, description?: unknown): string {
  const known = typeof description === "string" ? description.replace(/bot\d+:[A-Za-z0-9_-]+/g, "[token protegido]").slice(0, 300) : "Resposta inválida do Telegram";
  if (status === 401) return "Token do Telegram rejeitado.";
  if (status === 400 && /chat not found/i.test(known)) return "Chat ID não encontrado pelo Telegram.";
  return `Telegram HTTP ${status}: ${known}`;
}

export function maskChatId(chatId: string): string {
  if (chatId.length <= 4) return "••••";
  return `${chatId.startsWith("-") ? "-" : ""}••••${chatId.slice(-4)}`;
}

export function isDailyRunDue(localDate: string, localTime: string, dailyTime: string, lastRunLocalDate: string | null): boolean {
  return lastRunLocalDate !== localDate && localTime >= dailyTime.slice(0, 5);
}
