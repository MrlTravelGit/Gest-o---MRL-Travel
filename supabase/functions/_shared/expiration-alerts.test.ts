import { describe, expect, it } from "vitest";
import { buildTelegramMessage, isDailyRunDue, normalizeThresholds, safeTelegramError } from "./expiration-alerts.ts";

const pointsCandidate = {
  alert_type: "points_expiration" as const,
  client_id: "00000000-0000-4000-8000-000000000001",
  client_name: "Maria Cliente",
  program_name: "Azul Fidelidade",
  points_amount: 120000,
  expires_at: "2026-11-25",
  threshold_days: 90,
  days_remaining: 88,
};

describe("expiration alerts policy", () => {
  it("mantém 90 dias obrigatório e normaliza complementares", () => {
    expect(normalizeThresholds([1, 30, 90, 30, 7])).toEqual([90, 30, 7, 1]);
    expect(() => normalizeThresholds([60, 30])).toThrow(/90 dias/);
  });

  it("gera mensagem operacional sem dados sensíveis", () => {
    const message = buildTelegramMessage(pointsCandidate, "https://gestao.mrltravel.test/");
    expect(message).toContain("Pontos: 120.000");
    expect(message).toContain("/admin/clientes/00000000-0000-4000-8000-000000000001");
    expect(message).not.toMatch(/CPF|RG|senha|cartão|passaporte/i);
  });

  it("traduz token e chat inválidos sem vazar token", () => {
    expect(safeTelegramError(401, "Unauthorized")).toBe("Token do Telegram rejeitado.");
    expect(safeTelegramError(400, "Bad Request: chat not found")).toBe("Chat ID não encontrado pelo Telegram.");
    expect(safeTelegramError(500, "bot123456:SECRET_TOKEN failed")).not.toContain("SECRET_TOKEN");
  });

  it("executa uma vez por data local depois do horário configurado", () => {
    expect(isDailyRunDue("2026-09-01", "08:00", "08:00:00", null)).toBe(true);
    expect(isDailyRunDue("2026-09-01", "07:59", "08:00:00", null)).toBe(false);
    expect(isDailyRunDue("2026-09-01", "09:00", "08:00:00", "2026-09-01")).toBe(false);
  });
});
