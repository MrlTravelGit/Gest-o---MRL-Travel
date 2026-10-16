import { describe, expect, it, vi } from "vitest";
import {
  handleAutentiqueWebhookRequest,
  isRecognizedAutentiqueEvent,
  webhookDocumentId,
  type AcceptedAutentiqueWebhook,
  type WebhookLog,
} from "./autentique-webhook-http.ts";

const secret = "autentique-test-secret";

async function signature(rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function post(rawBody: string, signatureHeader?: string, overrides: Partial<Parameters<typeof handleAutentiqueWebhookRequest>[1]> = {}) {
  const process = overrides.process ?? vi.fn(async () => undefined);
  const pending: Promise<void>[] = [];
  const response = await handleAutentiqueWebhookRequest(new Request("https://example.test/autentique-webhook", {
    method: "POST",
    headers: signatureHeader ? { "x-autentique-signature": signatureHeader, "content-type": "application/json" } : { "content-type": "application/json" },
    body: rawBody,
  }), {
    secret,
    process,
    waitUntil: overrides.waitUntil ?? ((promise) => pending.push(promise)),
    log: overrides.log,
  });
  await Promise.all(pending);
  return { response, process };
}

describe("Autentique webhook HTTP", () => {
  it("responde ao health check sem exigir assinatura", async () => {
    const response = await handleAutentiqueWebhookRequest(new Request("https://example.test", { method: "GET" }), { secret: null, process: vi.fn() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "autentique-webhook" });
  });

  it("responde OPTIONS com 204 e outros métodos com 405 e Allow", async () => {
    const options = await handleAutentiqueWebhookRequest(new Request("https://example.test", { method: "OPTIONS" }), { secret: null, process: vi.fn() });
    const put = await handleAutentiqueWebhookRequest(new Request("https://example.test", { method: "PUT" }), { secret, process: vi.fn() });
    expect(options.status).toBe(204);
    expect(put.status).toBe(405);
    expect(put.headers.get("Allow")).toBe("GET, POST, OPTIONS");
  });

  it("aceita POST válido, agenda o processamento e devolve os identificadores", async () => {
    const raw = JSON.stringify({ event: { id: "evt-1", type: "document.finished", data: { object: { id: "doc-1" } } } });
    const result = await post(raw, await signature(raw));
    expect(result.response.status).toBe(200);
    await expect(result.response.json()).resolves.toEqual({ received: true, eventId: "evt-1", eventType: "document.finished" });
    expect(result.process).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt-1", eventType: "document.finished", documentId: "doc-1" }));
  });

  it("rejeita assinatura ausente ou inválida com 401", async () => {
    const raw = JSON.stringify({ event: { id: "evt-1", type: "document.finished", data: {} } });
    expect((await post(raw)).response.status).toBe(401);
    expect((await post(raw, "0".repeat(64))).response.status).toBe(401);
  });

  it("calcula o HMAC sobre o corpo original e aceita prefixo sha256 normalizado", async () => {
    const raw = '{\n  "event": { "id": "evt-raw", "type": "document.updated", "data": { "object": { "id": "doc-raw" } } }\n}';
    expect((await post(raw, ` SHA256=${await signature(raw)} `)).response.status).toBe(200);
    const reformatted = JSON.stringify(JSON.parse(raw));
    expect((await post(raw, await signature(reformatted))).response.status).toBe(401);
  });

  it("rejeita JSON inválido e payload sem event.id com 400", async () => {
    const invalidJson = "{invalid";
    expect((await post(invalidJson, await signature(invalidJson))).response.status).toBe(400);
    const missingId = JSON.stringify({ event: { type: "document.updated", data: {} } });
    expect((await post(missingId, await signature(missingId))).response.status).toBe(400);
  });

  it("não deixa falha assíncrona alterar o recebimento HTTP", async () => {
    const raw = JSON.stringify({ event: { id: "evt-fail", type: "document.finished", data: {} } });
    const logs: WebhookLog[] = [];
    const result = await post(raw, await signature(raw), {
      process: vi.fn(async () => { throw new Error("CUSTOMER_WHATSAPP_WEBHOOK_SECRET=nao-pode-vazar"); }),
      log: (entry) => logs.push(entry),
    });
    expect(result.response.status).toBe(200);
    expect(JSON.stringify(logs)).not.toContain("nao-pode-vazar");
    expect(logs).toContainEqual(expect.objectContaining({ result: "failed", error: "INTERNAL_PROCESSING_ERROR" }));
  });

  it("reconhece eventos suportados e ignora tipos desconhecidos", () => {
    for (const type of ["document.created", "document.updated", "document.finished", "document.deleted", "signature.created", "signature.updated", "signature.viewed", "signature.accepted", "signature.rejected", "signature.delivery_failed"]) {
      expect(isRecognizedAutentiqueEvent(type)).toBe(true);
    }
    expect(isRecognizedAutentiqueEvent("document.downloaded")).toBe(false);
  });

  it("interpreta payload.event.data.object inclusive fora de ordem", () => {
    expect(webhookDocumentId({ object: { document: { id: "doc-nested" } } }, "signature.accepted")).toBe("doc-nested");
    expect(webhookDocumentId({ object: { id: "doc-finished" } }, "document.finished")).toBe("doc-finished");
  });
});

describe("regras de aprovação preservadas", () => {
  it("mantém o evento aceito separado do processamento em background", async () => {
    const events: AcceptedAutentiqueWebhook[] = [];
    const raw = JSON.stringify({ event: { id: "evt-background", type: "signature.accepted", data: { object: { document: "doc-1" } } } });
    const result = await post(raw, await signature(raw), { process: async (event) => { events.push(event); } });
    expect(result.response.status).toBe(200);
    expect(events).toHaveLength(1);
  });
});
