import { verifyAutentiqueWebhook } from "./autentique-webhook-security.ts";

export type AutentiqueWebhookPayload = {
  event?: {
    id?: string;
    type?: string;
    created_at?: string;
    data?: Record<string, unknown>;
  };
};

export type AcceptedAutentiqueWebhook = {
  payload: AutentiqueWebhookPayload;
  eventId: string;
  eventType: string;
  documentId: string | null;
};

export type WebhookLog = {
  eventId?: string;
  eventType?: string;
  documentId?: string | null;
  stage: string;
  result: string;
  durationMs?: number;
  error?: string;
};

export type AutentiqueWebhookHttpDependencies = {
  secret: string | null;
  process: (event: AcceptedAutentiqueWebhook) => Promise<void>;
  waitUntil?: (promise: Promise<void>) => void;
  log?: (entry: WebhookLog) => void;
};

export const recognizedAutentiqueEvents = new Set([
  "document.created",
  "document.updated",
  "document.finished",
  "document.deleted",
  "signature.created",
  "signature.updated",
  "signature.viewed",
  "signature.accepted",
  "signature.rejected",
  "signature.delivery_failed",
]);

export function isRecognizedAutentiqueEvent(eventType: string): boolean {
  return recognizedAutentiqueEvents.has(eventType);
}

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Allow": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-autentique-signature",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function eventObject(data: Record<string, unknown>): Record<string, unknown> {
  return data.object && typeof data.object === "object" ? data.object as Record<string, unknown> : data;
}

export function webhookDocumentId(data: Record<string, unknown>, type: string): string | null {
  const object = eventObject(data);
  if (typeof data.document === "string") return data.document;
  if (typeof object.document === "string") return object.document;
  if (object.document && typeof object.document === "object" && typeof (object.document as Record<string, unknown>).id === "string") {
    return String((object.document as Record<string, unknown>).id);
  }
  if (type.startsWith("document.") && typeof object.id === "string") return object.id;
  return null;
}

export async function handleAutentiqueWebhookRequest(request: Request, dependencies: AutentiqueWebhookHttpDependencies): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method === "GET") return json({ ok: true, service: "autentique-webhook" });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const startedAt = Date.now();
  const rawBody = await request.text();
  if (!dependencies.secret?.trim()) {
    dependencies.log?.({ stage: "configuration", result: "missing_webhook_secret" });
    return json({ error: "WEBHOOK_NOT_CONFIGURED" }, 503);
  }

  const signature = request.headers.get("x-autentique-signature");
  if (!signature) {
    dependencies.log?.({ stage: "authentication", result: "missing_signature" });
    return json({ error: "INVALID_SIGNATURE" }, 401);
  }
  if (!await verifyAutentiqueWebhook(rawBody, signature, dependencies.secret.trim())) {
    dependencies.log?.({ stage: "authentication", result: "invalid_signature" });
    return json({ error: "INVALID_SIGNATURE" }, 401);
  }

  let payload: AutentiqueWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as AutentiqueWebhookPayload;
  } catch {
    dependencies.log?.({ stage: "validation", result: "invalid_json" });
    return json({ error: "INVALID_JSON" }, 400);
  }

  const eventId = typeof payload.event?.id === "string" ? payload.event.id.trim() : "";
  const eventType = typeof payload.event?.type === "string" ? payload.event.type.trim() : "";
  const eventData = payload.event?.data;
  if (!eventId || !eventType || !eventData || typeof eventData !== "object") {
    dependencies.log?.({ eventId: eventId || undefined, eventType: eventType || undefined, stage: "validation", result: "invalid_payload" });
    return json({ error: "INVALID_PAYLOAD" }, 400);
  }

  const accepted = { payload, eventId, eventType, documentId: webhookDocumentId(eventData, eventType) };
  const task = dependencies.process(accepted).catch(() => {
    dependencies.log?.({
      eventId,
      eventType,
      documentId: accepted.documentId,
      stage: "background_processing",
      result: "failed",
      error: "INTERNAL_PROCESSING_ERROR",
      durationMs: Date.now() - startedAt,
    });
  });

  if (dependencies.waitUntil) dependencies.waitUntil(task);
  else await task;

  dependencies.log?.({ eventId, eventType, documentId: accepted.documentId, stage: "acknowledgement", result: "received", durationMs: Date.now() - startedAt });
  return json({ received: true, eventId, eventType });
}
