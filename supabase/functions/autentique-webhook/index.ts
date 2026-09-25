import { fetchAutentiqueDocument, persistAutentiqueDocument, verifyAutentiqueWebhook } from "../_shared/autentique.ts";
import { webhookTransition } from "../_shared/autentique-rules.ts";
import { sendCustomerContractApprovedMessage } from "../_shared/contract-notifications.ts";
import { adminClient } from "../_shared/supabase.ts";

type WebhookPayload = { id?: string; event?: { id?: string; type?: string; created_at?: string; data?: Record<string, unknown> } };
type AdminClient = ReturnType<typeof adminClient>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

function eventObject(data: Record<string, unknown>): Record<string, unknown> {
  return data.object && typeof data.object === "object" ? data.object as Record<string, unknown> : data;
}

function documentIdFrom(data: Record<string, unknown>, type: string): string | null {
  const object = eventObject(data);
  if (typeof data.document === "string") return data.document;
  if (typeof object.document === "string") return object.document;
  if (object.document && typeof object.document === "object" && typeof (object.document as Record<string, unknown>).id === "string") return String((object.document as Record<string, unknown>).id);
  if (type.startsWith("document.") && typeof object.id === "string") return object.id;
  return null;
}

function publicIdFrom(data: Record<string, unknown>): string | null {
  const object = eventObject(data);
  return typeof data.public_id === "string" ? data.public_id : typeof object.public_id === "string" ? object.public_id : null;
}

async function applySignatureEvent(admin: AdminClient, requestId: string, type: string, publicId: string | null, occurredAt: string): Promise<void> {
  if (!publicId || !type.startsWith("signature.")) return;
  const transition = webhookTransition(type);
  const changes = transition.signer === "signed" ? { status: "signed", signed_at: occurredAt }
    : transition.signer === "rejected" ? { status: "rejected", rejected_at: occurredAt }
    : transition.signer === "failed" ? { status: "failed" }
    : type === "signature.viewed" ? { status: "viewed", viewed_at: occurredAt } : null;
  if (!changes) return;
  const updated = await admin.from("contract_signature_signers").update(changes)
    .eq("signature_request_id", requestId).eq("provider_public_id", publicId);
  if (updated.error) throw updated.error;
  if (transition.contract === "rejected") {
    const rejected = await admin.from("contract_signature_requests").update({ status: "rejected" })
      .eq("id", requestId).is("approved_at", null);
    if (rejected.error) throw rejected.error;
  }
}

async function notifyApprovedContract(admin: AdminClient, requestId: string): Promise<void> {
  try {
    const found = await admin.from("contract_signature_requests")
      .select("id,contract_id,client_id,signed_pdf_url,pades_pdf_url,client_contracts(client_name),clients(full_name,email,phone_e164,whatsapp_e164)")
      .eq("id", requestId).single();
    if (found.error) throw found.error;
    if (!found.data.client_id) throw new Error("CLIENT_NOT_LINKED");
    const client = found.data.clients as unknown as { full_name?: string; email?: string | null; phone_e164?: string | null; whatsapp_e164?: string | null } | null;
    const contract = found.data.client_contracts as unknown as { client_name?: string } | null;
    await sendCustomerContractApprovedMessage(admin, {
      requestId: found.data.id, clientId: found.data.client_id, contractId: found.data.contract_id,
      customerName: client?.full_name ?? contract?.client_name ?? "Cliente",
      customerPhone: client?.whatsapp_e164 ?? client?.phone_e164 ?? null,
      customerEmail: client?.email ?? null,
      signedPdfUrl: found.data.pades_pdf_url ?? found.data.signed_pdf_url ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Falha ao preparar notificação.";
    await admin.from("contract_signature_requests").update({ customer_notification_status: "failed", customer_notification_error: message })
      .eq("id", requestId).is("customer_notified_at", null);
    console.error("contract approval notification failed", message);
  }
}

async function processWebhook(payload: WebhookPayload): Promise<void> {
  const admin = adminClient();
  const event = payload.event ?? {};
  const type = event.type ?? "unknown";
  const data = event.data ?? {};
  const documentId = documentIdFrom(data, type);
  const publicId = publicIdFrom(data);
  const providerEventId = event.id ?? payload.id ?? `${type}:${documentId ?? publicId ?? crypto.randomUUID()}`;
  const inserted = await admin.from("autentique_webhook_events").insert({
    provider_event_id: providerEventId, event_type: type, provider_document_id: documentId, payload,
  }).select("id").single();
  if (inserted.error) { if (inserted.error.code === "23505") return; throw inserted.error; }
  const eventRowId = inserted.data.id;
  try {
    let requestId: string | null = null;
    let resolvedDocumentId = documentId;
    if (publicId) {
      const signer = await admin.from("contract_signature_signers").select("signature_request_id").eq("provider_public_id", publicId).maybeSingle();
      if (signer.error) throw signer.error;
      requestId = signer.data?.signature_request_id ?? null;
    }
    if (!requestId && resolvedDocumentId) {
      const parent = await admin.from("contract_signature_requests").select("id").eq("provider_document_id", resolvedDocumentId).maybeSingle();
      if (parent.error) throw parent.error;
      requestId = parent.data?.id ?? null;
    }
    if (requestId && !resolvedDocumentId) {
      const parent = await admin.from("contract_signature_requests").select("provider_document_id").eq("id", requestId).single();
      if (parent.error) throw parent.error;
      resolvedDocumentId = parent.data.provider_document_id;
    }
    if (!requestId || !resolvedDocumentId) throw new Error("AUTENTIQUE_SIGNATURE_REQUEST_NOT_FOUND");

    const document = await fetchAutentiqueDocument(resolvedDocumentId);
    await persistAutentiqueDocument(admin, requestId, document, payload);
    const occurredAt = event.created_at ?? new Date().toISOString();
    await applySignatureEvent(admin, requestId, type, publicId, occurredAt);
    if (type === "document.finished") {
      const approved = await admin.from("contract_signature_requests").update({ status: "completed", approved_at: occurredAt, last_webhook_payload: payload })
        .eq("id", requestId).is("approved_at", null);
      if (approved.error) throw approved.error;
      const signed = await admin.from("contract_signature_signers").update({ status: "signed" })
        .eq("signature_request_id", requestId).neq("status", "rejected");
      if (signed.error) throw signed.error;
      await notifyApprovedContract(admin, requestId);
    }
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
  if (!await verifyAutentiqueWebhook(rawBody, request.headers.get("x-autentique-signature"), secret)) return json({ error: "Assinatura do webhook inválida." }, 401);
  let payload: WebhookPayload;
  try { payload = JSON.parse(rawBody) as WebhookPayload; } catch { return json({ error: "Payload inválido." }, 400); }
  if (!payload.event?.type || !payload.event.data) return json({ error: "Evento inválido." }, 422);
  const task = processWebhook(payload);
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task); else await task;
  return json({ received: true });
});
