import { fetchAutentiqueDocument, persistAutentiqueDocument, verifyAutentiqueWebhook } from "../_shared/autentique.ts";
import { adminClient } from "../_shared/supabase.ts";

type WebhookPayload = {
  id?: string;
  event?: {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

function nestedDocumentId(object: Record<string, unknown>): string | null {
  if (typeof object.document_id === "string") return object.document_id;
  if (object.document && typeof object.document === "object" && typeof (object.document as Record<string, unknown>).id === "string") {
    return String((object.document as Record<string, unknown>).id);
  }
  return null;
}

async function processWebhook(payload: WebhookPayload): Promise<void> {
  const admin = adminClient();
  const event = payload.event ?? {};
  const type = event.type ?? "unknown";
  const object = event.data?.object ?? {};
  const providerEventId = event.id ?? payload.id ?? `${type}:${String(object.id ?? crypto.randomUUID())}`;
  const inserted = await admin.from("autentique_webhook_events").insert({
    provider_event_id: providerEventId,
    event_type: type,
    provider_document_id: type.startsWith("document.") ? object.id ?? null : nestedDocumentId(object),
    payload,
  }).select("id").single();
  if (inserted.error) {
    if (inserted.error.code === "23505") return;
    throw inserted.error;
  }
  const eventRowId = inserted.data.id;
  try {
    let documentId = type.startsWith("document.") && typeof object.id === "string" ? object.id : nestedDocumentId(object);
    let signatureRequestId: string | null = null;
    if (!documentId && typeof object.public_id === "string") {
      const signer = await admin.from("contract_signature_signers")
        .select("signature_request_id")
        .eq("provider_public_id", object.public_id).maybeSingle();
      if (signer.error) throw signer.error;
      signatureRequestId = signer.data?.signature_request_id ?? null;
      if (signatureRequestId) {
        const parent = await admin.from("contract_signature_requests").select("provider_document_id").eq("id", signatureRequestId).single();
        if (parent.error) throw parent.error;
        documentId = parent.data.provider_document_id;
      }
    }
    if (!documentId) throw new Error("AUTENTIQUE_WEBHOOK_DOCUMENT_MISSING");
    if (!signatureRequestId) {
      const parent = await admin.from("contract_signature_requests").select("id").eq("provider_document_id", documentId).maybeSingle();
      if (parent.error) throw parent.error;
      signatureRequestId = parent.data?.id ?? null;
    }
    if (!signatureRequestId) throw new Error("AUTENTIQUE_SIGNATURE_REQUEST_NOT_FOUND");
    const document = await fetchAutentiqueDocument(documentId);
    await persistAutentiqueDocument(admin, signatureRequestId, document, payload);
    await admin.from("autentique_webhook_events").update({ processed_at: new Date().toISOString(), error_message: null }).eq("id", eventRowId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AUTENTIQUE_WEBHOOK_PROCESSING_FAILED";
    await admin.from("autentique_webhook_events").update({ error_message: message }).eq("id", eventRowId);
    console.error("autentique-webhook processing failed", message);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  const secret = Deno.env.get("AUTENTIQUE_WEBHOOK_SECRET")?.trim();
  if (!secret) return json({ error: "Webhook não configurado." }, 503);
  const rawBody = await request.text();
  const valid = await verifyAutentiqueWebhook(rawBody, request.headers.get("x-autentique-signature"), secret);
  if (!valid) return json({ error: "Assinatura do webhook inválida." }, 401);
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return json({ error: "Payload inválido." }, 400);
  }
  if (!payload.event?.type || !payload.event.data?.object) return json({ error: "Evento inválido." }, 422);
  const task = processWebhook(payload);
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
  else await task;
  return json({ received: true });
});
