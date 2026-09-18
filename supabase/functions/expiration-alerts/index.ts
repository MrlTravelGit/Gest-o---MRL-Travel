import { z } from "npm:zod@3.25.76";
import { adminErrorResponse, requireAdmin } from "../_shared/admin-auth.ts";
import { AlertCandidate, buildTelegramMessage, isDailyRunDue, maskChatId, normalizeThresholds, safeTelegramError } from "../_shared/expiration-alerts.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dashboard"), limit: z.number().int().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal("client"), clientId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("update_settings"), pointsEnabled: z.boolean(), managementEnabled: z.boolean(), thresholdDays: z.array(z.number()), dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict(),
  z.object({ action: z.literal("test_telegram") }).strict(),
  z.object({ action: z.literal("run") }).strict(),
]);

type TelegramResponse = { ok?: boolean; result?: { message_id?: number }; description?: string };
type WhatsAppAlertInput = { dedupeKey: string; message: string };

class OperationalError extends Error {}

function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new OperationalError(`${name} não configurado no backend.`);
  return value;
}

function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://gestao-mrltravel.vercel.app").replace(/\/+$/, "");
}

function configuredTelegram() {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim() ?? "";
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")?.trim() ?? "";
  return { tokenConfigured: Boolean(token), chatConfigured: Boolean(chatId), chatIdMasked: chatId ? maskChatId(chatId) : null };
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left); const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function isCronRequest(request: Request): Promise<boolean> {
  const received = request.headers.get("x-cron-secret")?.trim() ?? "";
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(received));
  const receivedHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await adminClient().from("expiration_alert_settings").select("cron_secret_hash").eq("id", true).single();
  const expectedHash = typeof data?.cron_secret_hash === "string" ? data.cron_secret_hash : "";
  return !error && Boolean(expectedHash) && timingSafeEqual(expectedHash, receivedHash);
}

async function body(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return {}; }
}

async function sendTelegram(text: string): Promise<number> {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chatId = env("TELEGRAM_CHAT_ID");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const payload = await response.json().catch(() => ({})) as TelegramResponse;
  if (!response.ok || !payload.ok || !payload.result?.message_id) throw new OperationalError(safeTelegramError(response.status, payload.description));
  return payload.result.message_id;
}

async function sendWhatsAppAlert({ dedupeKey, message }: WhatsAppAlertInput): Promise<unknown> {
  const enabled = Deno.env.get("WHATSAPP_ALERTS_ENABLED")?.trim() === "true";
  const url = Deno.env.get("WHATSAPP_ALERT_WEBHOOK_URL")?.trim();
  const secret = Deno.env.get("WHATSAPP_ALERT_WEBHOOK_SECRET")?.trim();
  if (!enabled || !url || !secret) return { ok: false, skipped: true, reason: "not_configured" };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-mrl-alert-token": secret },
    body: JSON.stringify({ dedupeKey, message }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`WhatsApp alert failed: ${response.status} ${text}`.slice(0, 500));
  }
  return await response.json().catch(() => ({ ok: true }));
}

function whatsappDedupeKey(candidate: AlertCandidate, today: string): string {
  if (candidate.alert_type === "management_expiration") {
    return `management:${candidate.client_id}:${candidate.expires_at}:${candidate.threshold_days}:${today}`;
  }
  return `points:${candidate.client_id}:${candidate.program_name}:${candidate.expires_at}:${candidate.threshold_days}:${today}`;
}

async function mirrorToWhatsApp(input: WhatsAppAlertInput) {
  try {
    await sendWhatsAppAlert(input);
  } catch (error) {
    console.error("Erro ao enviar alerta WhatsApp", error);
  }
}

async function dashboard(limit: number) {
  const admin = adminClient();
  const [{ data: settings, error: settingsError }, { data: history, error: historyError }, { data: candidates, error: candidateError }] = await Promise.all([
    admin.from("expiration_alert_settings").select("points_enabled,management_enabled,threshold_days,daily_time,timezone,last_run_at,last_success_at,last_error,updated_at").eq("id", true).single(),
    admin.from("expiration_alerts").select("id,alert_type,client_id,program_name,points_amount,expires_at,threshold_days,sent_at,status,error_message,created_at,clients(full_name)").order("created_at", { ascending: false }).limit(limit),
    admin.rpc("get_expiration_alert_candidates_v1"),
  ]);
  if (settingsError) throw settingsError;
  if (historyError) throw historyError;
  if (candidateError) throw candidateError;
  const rows = history ?? [];
  return {
    telegram: configuredTelegram(), settings,
    summary: {
      awaiting: (candidates ?? []).length,
      sent: rows.filter((item) => item.status === "sent").length,
      failed: rows.filter((item) => item.status === "failed").length,
      lastSentAt: rows.find((item) => item.status === "sent")?.sent_at ?? null,
    },
    history: rows.map((item) => {
      const relation = item.clients as unknown as { full_name?: string } | Array<{ full_name?: string }> | null;
      return { ...item, client_name: Array.isArray(relation) ? relation[0]?.full_name : relation?.full_name, clients: undefined };
    }),
  };
}

async function clientAlerts(clientId: string) {
  const admin = adminClient();
  const today = saoPauloClock().date;
  const [{ data: client, error: clientError }, { data: lots, error: lotsError }, { data: contracts, error: contractsError }, { data: history, error: historyError }, { data: settings, error: settingsError }] = await Promise.all([
    admin.from("clients").select("id,full_name,status").eq("id", clientId).maybeSingle(),
    admin.from("expiration_lots").select("id,expires_on,remaining_points,status,program_accounts!inner(client_id,active,loyalty_programs(name))").eq("program_accounts.client_id", clientId).eq("program_accounts.active", true).eq("status", "active").gt("remaining_points", 0).gte("expires_on", today).order("expires_on"),
    admin.from("management_contracts").select("id,ends_on,status,plan_name").eq("client_id", clientId).eq("status", "active").gte("ends_on", today).order("ends_on"),
    admin.from("expiration_alerts").select("id,alert_type,program_name,points_amount,expires_at,threshold_days,sent_at,status,error_message,created_at").eq("client_id", clientId).order("created_at", { ascending: false }),
    admin.from("expiration_alert_settings").select("threshold_days,points_enabled,management_enabled,timezone").eq("id", true).single(),
  ]);
  if (clientError || lotsError || contractsError || historyError || settingsError) throw clientError ?? lotsError ?? contractsError ?? historyError ?? settingsError;
  if (!client) throw new Response(JSON.stringify({ error: "Cliente não encontrado." }), { status: 404 });
  const thresholds = (settings.threshold_days as number[]).slice().sort((a, b) => b - a);
  const sentKeys = new Set((history ?? []).filter((item) => item.status === "sent").map((item) => `${item.alert_type}|${item.program_name}|${item.expires_at}|${item.threshold_days}`));
  const schedules: Array<Record<string, unknown>> = [];
  for (const lot of lots ?? []) {
    const account = Array.isArray(lot.program_accounts) ? lot.program_accounts[0] : lot.program_accounts;
    const program = Array.isArray(account?.loyalty_programs) ? account.loyalty_programs[0] : account?.loyalty_programs;
    const name = program?.name ?? "Programa de fidelidade";
    const next = thresholds.find((threshold) => !sentKeys.has(`points_expiration|${name}|${lot.expires_on}|${threshold}`));
    schedules.push({ type: "points_expiration", programName: name, pointsAmount: Number(lot.remaining_points), expiresAt: lot.expires_on, nextThresholdDays: next ?? null });
  }
  for (const contract of contracts ?? []) {
    const next = thresholds.find((threshold) => !sentKeys.has(`management_expiration|Gestão MRL Travel|${contract.ends_on}|${threshold}`));
    schedules.push({ type: "management_expiration", programName: "Gestão MRL Travel", pointsAmount: null, expiresAt: contract.ends_on, nextThresholdDays: next ?? null });
  }
  return { client, settings, schedules, history: history ?? [] };
}

function saoPauloClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

async function runAlerts(force = true) {
  const admin = adminClient();
  const startedAt = new Date().toISOString();
  const chatId = env("TELEGRAM_CHAT_ID");
  env("TELEGRAM_BOT_TOKEN");
  const timezone = Deno.env.get("ALERTS_TIMEZONE")?.trim() || "America/Sao_Paulo";
  if (timezone !== "America/Sao_Paulo") throw new Error("ALERTS_TIMEZONE_INVALID");
  if (!force) {
    const { data: schedule, error: scheduleError } = await admin.from("expiration_alert_settings").select("daily_time,last_run_at").eq("id", true).single();
    if (scheduleError) throw scheduleError;
    const clock = saoPauloClock();
    const lastRunLocalDate = schedule.last_run_at ? saoPauloClock(new Date(schedule.last_run_at)).date : null;
    if (!isDailyRunDue(clock.date, clock.time, schedule.daily_time, lastRunLocalDate)) return { ok: true, due: false, sent: 0, skipped: 0, failed: 0 };
  }
  await admin.from("expiration_alert_settings").update({ last_run_at: startedAt, last_error: null }).eq("id", true);
  const { data, error } = await admin.rpc("get_expiration_alert_candidates_v1");
  if (error) throw error;
  const candidates = (data ?? []) as AlertCandidate[];
  let sent = 0; let skipped = 0; const failures: string[] = [];

  for (const candidate of candidates) {
    const { data: claimedId, error: claimError } = await admin.rpc("claim_expiration_alert_v1", {
      p_alert_type: candidate.alert_type,
      p_client_id: candidate.client_id,
      p_program_name: candidate.program_name,
      p_points_amount: candidate.points_amount,
      p_expires_at: candidate.expires_at,
      p_threshold_days: candidate.threshold_days,
      p_telegram_chat_id: chatId,
    });
    if (claimError) { failures.push("Falha ao reservar alerta."); continue; }
    if (!claimedId) { skipped += 1; continue; }
    try {
      const message = buildTelegramMessage(candidate, appUrl());
      const messageId = await sendTelegram(message);
      await mirrorToWhatsApp({ dedupeKey: whatsappDedupeKey(candidate, saoPauloClock().date), message });
      const { error: updateError } = await admin.from("expiration_alerts").update({ status: "sent", sent_at: new Date().toISOString(), telegram_message_id: messageId, error_message: null }).eq("id", claimedId).eq("status", "pending");
      if (updateError) throw updateError;
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida no Telegram.";
      failures.push(message);
      await admin.from("expiration_alerts").update({ status: "failed", error_message: message }).eq("id", claimedId).eq("status", "pending");
    }
  }

  const finishedAt = new Date().toISOString();
  const lastError = failures.length ? `${failures.length} alerta(s) falharam. ${failures[0]}`.slice(0, 500) : null;
  await admin.from("expiration_alert_settings").update({ last_success_at: failures.length ? undefined : finishedAt, last_error: lastError }).eq("id", true);
  return { ok: failures.length === 0, candidates: candidates.length, sent, skipped, failed: failures.length, finishedAt };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido." }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada." }, 403);

  try {
    const raw = await body(request);
    const pathTest = new URL(request.url).pathname.endsWith("/api/admin/alerts/test-telegram");
    const parsed = requestSchema.safeParse(pathTest ? { action: "test_telegram" } : raw);
    if (!parsed.success) return jsonResponse(request, { error: "Requisição inválida." }, 400);

    if (parsed.data.action === "run" && await isCronRequest(request)) return jsonResponse(request, await runAlerts(false));

    if (parsed.data.action === "client") {
      await requireAdmin(request, ["super_admin", "manager", "operator", "auditor"]);
      return jsonResponse(request, await clientAlerts(parsed.data.clientId));
    }

    const actor = await requireAdmin(request, ["super_admin", "manager"]);
    if (parsed.data.action === "dashboard") return jsonResponse(request, await dashboard(parsed.data.limit ?? 100));
    if (parsed.data.action === "update_settings") {
      const thresholds = normalizeThresholds(parsed.data.thresholdDays);
      const { error } = await adminClient().from("expiration_alert_settings").update({
        points_enabled: parsed.data.pointsEnabled,
        management_enabled: parsed.data.managementEnabled,
        threshold_days: thresholds,
        daily_time: `${parsed.data.dailyTime}:00`,
        timezone: "America/Sao_Paulo",
        updated_by: actor.userId,
      }).eq("id", true);
      if (error) throw error;
      return jsonResponse(request, { ok: true });
    }
    if (parsed.data.action === "test_telegram") {
      const message = "Teste de alerta MRL Travel concluído com sucesso.";
      const messageId = await sendTelegram(message);
      await mirrorToWhatsApp({ dedupeKey: `test:expiration-alerts:${saoPauloClock().date}`, message });
      await adminClient().from("audit_logs").insert({ actor_user_id: actor.userId, action: "test_telegram_alert", table_name: "expiration_alert_settings", record_id: "true", new_data: { telegramMessageId: messageId, whatsappMirror: true } });
      return jsonResponse(request, { ok: true, message: "Teste enviado com sucesso." });
    }
    return jsonResponse(request, await runAlerts());
  } catch (error) {
    if (error instanceof OperationalError) return jsonResponse(request, { error: error.message }, 502);
    return adminErrorResponse(error, request, {});
  }
});
