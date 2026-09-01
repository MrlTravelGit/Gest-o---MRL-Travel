import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { getExpirationAlertsDashboard, runExpirationAlerts, testTelegramAlert, updateExpirationAlertSettings } from "./expiration-alerts";

vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
const invoke = vi.mocked(supabase.functions.invoke);

describe("expiration alerts service", () => {
  beforeEach(() => invoke.mockReset());

  it("normaliza painel e nunca solicita secrets ao frontend", async () => {
    invoke.mockResolvedValue({ data: {
      telegram: { tokenConfigured: true, chatConfigured: true, chatIdMasked: "••••1234" },
      settings: { points_enabled: true, management_enabled: false, threshold_days: [90, 30], daily_time: "08:00:00", timezone: "America/Sao_Paulo", last_run_at: null, last_success_at: null, last_error: null, updated_at: "2026-09-01T10:00:00Z" },
      summary: { awaiting: 1, sent: 2, failed: 0, lastSentAt: null }, history: [],
    }, error: null });
    const result = await getExpirationAlertsDashboard();
    expect(result.settings).toMatchObject({ pointsEnabled: true, managementEnabled: false, dailyTime: "08:00" });
    expect(JSON.stringify(invoke.mock.calls[0])).not.toMatch(/BOT_TOKEN|TELEGRAM_CHAT_ID/);
  });

  it("usa ações administrativas explícitas para salvar, testar e executar", async () => {
    invoke.mockResolvedValue({ data: { ok: true, message: "ok", sent: 0, skipped: 0, failed: 0 }, error: null });
    await updateExpirationAlertSettings({ pointsEnabled: true, managementEnabled: true, thresholdDays: [90, 7], dailyTime: "08:00" });
    await testTelegramAlert();
    await runExpirationAlerts();
    expect(invoke).toHaveBeenNthCalledWith(1, "expiration-alerts", { body: { action: "update_settings", pointsEnabled: true, managementEnabled: true, thresholdDays: [90, 7], dailyTime: "08:00" } });
    expect(invoke).toHaveBeenNthCalledWith(2, "expiration-alerts", { body: { action: "test_telegram" } });
    expect(invoke).toHaveBeenNthCalledWith(3, "expiration-alerts", { body: { action: "run" } });
  });
});
