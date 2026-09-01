import { supabase } from "@/lib/supabase";
import type { ClientExpirationAlerts, ExpirationAlertsDashboard, ExpirationAlertSettings, ExpirationAlertHistoryItem } from "@/types/expiration-alerts";

type Row = Record<string, unknown>;

async function functionError(error: unknown): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      const payload = await response.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof payload?.error === "string") return payload.error;
    }
  }
  return error instanceof Error && error.message ? error.message : "Serviço de alertas indisponível.";
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("expiration-alerts", { body });
  if (error) throw new Error(await functionError(error));
  if (!data) throw new Error("O backend não retornou os dados de alertas.");
  return data;
}

const string = (value: unknown) => typeof value === "string" ? value : "";
const nullableString = (value: unknown) => typeof value === "string" ? value : null;
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const bool = (value: unknown) => value === true;

function settings(row: Row): ExpirationAlertSettings {
  return {
    pointsEnabled: bool(row.points_enabled), managementEnabled: bool(row.management_enabled),
    thresholdDays: Array.isArray(row.threshold_days) ? row.threshold_days.map(number) : [90],
    dailyTime: string(row.daily_time).slice(0, 5) || "08:00", timezone: string(row.timezone) || "America/Sao_Paulo",
    lastRunAt: nullableString(row.last_run_at), lastSuccessAt: nullableString(row.last_success_at),
    lastError: nullableString(row.last_error), updatedAt: string(row.updated_at),
  };
}

function history(row: Row): ExpirationAlertHistoryItem {
  return {
    id: string(row.id), alertType: row.alert_type === "management_expiration" ? "management_expiration" : "points_expiration",
    clientId: string(row.client_id), clientName: string(row.client_name) || undefined, programName: string(row.program_name),
    pointsAmount: row.points_amount == null ? null : number(row.points_amount), expiresAt: string(row.expires_at),
    thresholdDays: number(row.threshold_days), sentAt: nullableString(row.sent_at),
    status: row.status === "sent" || row.status === "failed" ? row.status : "pending",
    errorMessage: nullableString(row.error_message), createdAt: string(row.created_at),
  };
}

export async function getExpirationAlertsDashboard(): Promise<ExpirationAlertsDashboard> {
  const raw = await invoke<{ telegram: ExpirationAlertsDashboard["telegram"]; settings: Row; summary: ExpirationAlertsDashboard["summary"]; history: Row[] }>({ action: "dashboard", limit: 100 });
  return { telegram: raw.telegram, settings: settings(raw.settings), summary: raw.summary, history: raw.history.map(history) };
}

export async function updateExpirationAlertSettings(input: { pointsEnabled: boolean; managementEnabled: boolean; thresholdDays: number[]; dailyTime: string }) {
  return invoke<{ ok: boolean }>({ action: "update_settings", ...input });
}

export async function testTelegramAlert() { return invoke<{ ok: boolean; message: string }>({ action: "test_telegram" }); }
export async function runExpirationAlerts() { return invoke<{ ok: boolean; sent: number; skipped: number; failed: number }>({ action: "run" }); }

export async function getClientExpirationAlerts(clientId: string): Promise<ClientExpirationAlerts> {
  const raw = await invoke<{ client: Row; settings: Row; schedules: Row[]; history: Row[] }>({ action: "client", clientId });
  return {
    client: { id: string(raw.client.id), fullName: string(raw.client.full_name), status: string(raw.client.status) },
    settings: { thresholdDays: Array.isArray(raw.settings.threshold_days) ? raw.settings.threshold_days.map(number) : [90], pointsEnabled: bool(raw.settings.points_enabled), managementEnabled: bool(raw.settings.management_enabled), timezone: string(raw.settings.timezone) },
    schedules: raw.schedules.map((row) => ({ type: row.type === "management_expiration" ? "management_expiration" : "points_expiration", programName: string(row.programName), pointsAmount: row.pointsAmount == null ? null : number(row.pointsAmount), expiresAt: string(row.expiresAt), nextThresholdDays: row.nextThresholdDays == null ? null : number(row.nextThresholdDays) })),
    history: raw.history.map(history),
  };
}
