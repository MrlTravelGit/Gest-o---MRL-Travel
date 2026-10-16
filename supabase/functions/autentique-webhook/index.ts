import { fetchAutentiqueDocument, persistAutentiqueDocument } from "../_shared/autentique.ts";
import { webhookTransition } from "../_shared/autentique-rules.ts";
import {
  handleAutentiqueWebhookRequest,
  isRecognizedAutentiqueEvent,
  type AcceptedAutentiqueWebhook,
  type WebhookLog,
} from "../_shared/autentique-webhook-http.ts";
import { sendCustomerContractApprovedMessage } from "../_shared/contract-notifications.ts";
import { adminClient } from "../_shared/supabase.ts";

type AdminClient = ReturnType<typeof adminClient>;

function log(entry: WebhookLog): void {
  console.log(JSON.stringify({ service: "autentique-webhook", ...entry }));
}

function eventObject(data: Record<string, unknown>): Record<string, unknown> {
  return data.object && typeof data.object === "object" ? data.object as Record<string, unknown> : data;
}

function publicIdFrom(data: Record<string, unknown>): string | null {
  const object = eventObject(data);
  return typeof data.public_id === "string" ? data.public_id : typeof object.public_id === "string" ? object.public_id : null;
}

function sanitizedError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{2,80}$/.test(error.code)) {
    return error.code;
  }
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z0-9_:-]{2,120}$/.test(message) ? message : "INTERNAL_PROCESSING_ERROR";
}

async function updateEvent(admin: AdminClient, eventRowId: string, values: Record<string, unknown>): Promise<void> {
  const updated = await admin.from("autentique_webhook_events").update(values).eq("id", eventRowId);
  if (updated.error) throw updated.error;
}

async function claimEvent(admin: AdminClient, accepted: AcceptedAutentiqueWebhook): Promise<{ claimed: boolean; eventRowId: string | null }> {
  const claimed = await admin.rpc("claim_autentique_webhook_event", {
    p_event_id: accepted.eventId,
    p_event_type: accepted.eventType,
    p_document_id: accepted.documentId,
    p_payload: {
      event: {
        id: accepted.eventId,
        type: accepted.eventType,
        documentId: accepted.documentId,
      },
    },
  });
  if (claimed.error) throw claimed.error;
  const result = claimed.data as { claimed?: boolean; eventRowId?: string } | null;
  return { claimed: result?.claimed === true, eventRowId: result?.eventRowId ?? null };
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
      requestId: found.data.id,
      clientId: found.data.client_id,
      contractId: found.data.contract_id,
      customerName: client?.full_name ?? contract?.client_name ?? "Cliente",
      customerPhone: client?.whatsapp_e164 ?? client?.phone_e164 ?? null,
      customerEmail: client?.email ?? null,
      signedPdfUrl: found.data.pades_pdf_url ?? found.data.signed_pdf_url ?? null,
    });
  } catch (error) {
    const reason = sanitizedError(error);
    await admin.from("contract_signature_requests").update({ customer_notification_status: "failed", customer_notification_error: reason })
      .eq("id", requestId).is("customer_notified_at", null);
    log({ stage: "notification", result: "notification_error", error: reason });
  }
}

async function resolveRequest(admin: AdminClient, documentId: string | null, publicId: string | null): Promise<{ requestId: string; documentId: string }> {
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
  return { requestId, documentId: resolvedDocumentId };
}

async function processWebhook(accepted: AcceptedAutentiqueWebhook): Promise<void> {
  const startedAt = Date.now();
  const admin = adminClient();
  const { payload, eventId, eventType, documentId } = accepted;
  const data = payload.event?.data ?? {};
  const occurredAt = payload.event?.created_at ?? new Date().toISOString();
  let eventRowId: string | null = null;

  try {
    const claim = await claimEvent(admin, accepted);
    eventRowId = claim.eventRowId;
    if (!claim.claimed) {
      log({ eventId, eventType, documentId, stage: "idempotency", result: "duplicate_event", durationMs: Date.now() - startedAt });
      return;
    }

    if (!isRecognizedAutentiqueEvent(eventType)) {
      await updateEvent(admin, eventRowId!, { processing_status: "ignored", processed_at: new Date().toISOString(), last_error: null, error_message: null });
      log({ eventId, eventType, documentId, stage: "dispatch", result: "ignored", durationMs: Date.now() - startedAt });
      return;
    }

    const publicId = publicIdFrom(data);
    const resolved = await resolveRequest(admin, documentId, publicId);

    if (eventType === "document.deleted") {
      const deleted = await admin.from("contract_signature_requests").update({ status: "failed", error_message: "AUTENTIQUE_DOCUMENT_DELETED" })
        .eq("id", resolved.requestId).is("approved_at", null);
      if (deleted.error) throw deleted.error;
    } else {
      const document = await fetchAutentiqueDocument(resolved.documentId);
      await persistAutentiqueDocument(admin, resolved.requestId, document, {
        event: { id: eventId, type: eventType, documentId: resolved.documentId },
      });
      await applySignatureEvent(admin, resolved.requestId, eventType, publicId, occurredAt);
    }

    if (eventType === "document.finished") {
      const approved = await admin.from("contract_signature_requests")
        .update({ status: "completed", approved_at: occurredAt, last_webhook_payload: { event: { id: eventId, type: eventType, documentId: resolved.documentId } } })
        .eq("id", resolved.requestId).is("approved_at", null).select("id").maybeSingle();
      if (approved.error) throw approved.error;
      if (approved.data) {
        const signed = await admin.from("contract_signature_signers").update({ status: "signed" })
          .eq("signature_request_id", resolved.requestId).neq("status", "rejected");
        if (signed.error) throw signed.error;
        await notifyApprovedContract(admin, resolved.requestId);
      }
    }

    await updateEvent(admin, eventRowId!, { processing_status: "processed", processed_at: new Date().toISOString(), last_error: null, error_message: null });
    log({ eventId, eventType, documentId: resolved.documentId, stage: "processing", result: "processed", durationMs: Date.now() - startedAt });
  } catch (error) {
    const reason = sanitizedError(error);
    if (eventRowId) {
      await admin.from("autentique_webhook_events").update({ processing_status: "failed", last_error: reason, error_message: reason }).eq("id", eventRowId);
    }
    log({ eventId, eventType, documentId, stage: "processing", result: reason.includes("AUTENTIQUE_API") ? "autentique_api_error" : "database_error", error: reason, durationMs: Date.now() - startedAt });
  }
}

Deno.serve((request) => {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<void>): void } }).EdgeRuntime;
  return handleAutentiqueWebhookRequest(request, {
    secret: Deno.env.get("AUTENTIQUE_WEBHOOK_SECRET")?.trim() ?? null,
    process: processWebhook,
    waitUntil: runtime ? (promise) => runtime.waitUntil(promise) : undefined,
    log,
  });
});
