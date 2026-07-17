import { z } from "npm:zod@3.25.76";
import { hashClientLinkToken, isClientLinkTokenFormat, requestFingerprintHash } from "../_shared/client-link.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { onboardingPayloadSchema, normalizePayload, protectSensitivePayload, redactDraftPayload } from "../_shared/onboarding.ts";
import { adminClient } from "../_shared/supabase.ts";

const formKeySchema = z.string().regex(/^[A-Za-z0-9_-]{32,96}$/);

const metadataSchema = z.object({
  action: z.literal("metadata"),
  formKey: formKeySchema.optional(),
  token: z.string().refine(isClientLinkTokenFormat).optional(),
}).strict();

const draftSchema = z.object({
  action: z.literal("draft"),
  formKey: formKeySchema.optional(),
  token: z.string().refine(isClientLinkTokenFormat).optional(),
  payload: z.record(z.unknown()),
}).strict();

const submitSchema = z.object({
  action: z.literal("submit"),
  formKey: formKeySchema.optional(),
  token: z.string().refine(isClientLinkTokenFormat).optional(),
  idempotencyKey: z.string().uuid().optional(),
  honeypot: z.string().max(0).optional().default(""),
  payload: onboardingPayloadSchema,
}).strict();

const bodySchema = z.discriminatedUnion("action", [metadataSchema, draftSchema, submitSchema]);
const GENERIC_ERROR = { error: "Onboarding indisponível." };

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 128_000) return { action: "too_large" };
    return await request.json();
  } catch {
    return {};
  }
}

async function rateLimited(fingerprintHash: string): Promise<boolean> {
  const admin = adminClient();
  const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("client_onboarding_events")
    .select("id", { count: "exact", head: true })
    .eq("fingerprint_hash", fingerprintHash)
    .gte("created_at", windowStart);
  return (count ?? 0) >= 30;
}

async function legacyMetadata(request: Request, token: string, fingerprintHash: string) {
  const admin = adminClient();
  const tokenHash = await hashClientLinkToken(token);
  const { data, error } = await admin.rpc("resolve_onboarding_form_by_hash", {
    p_token_hash: tokenHash,
    p_event_type: "metadata",
    p_fingerprint_hash: fingerprintHash,
  });
  if (error || !data?.ok) return jsonResponse(request, GENERIC_ERROR, 401);
  return jsonResponse(request, {
    mode: "legacy_client_invite",
    clientDisplayName: data.clientDisplayName,
    status: data.status,
    expiresAt: data.expiresAt,
    submittedAt: data.submittedAt,
    formVersion: data.formVersion,
    draft: data.draft ?? {},
  });
}

async function legacyDraft(request: Request, token: string, payload: Record<string, unknown>, fingerprintHash: string) {
  const admin = adminClient();
  const tokenHash = await hashClientLinkToken(token);
  const { data, error } = await admin.rpc("save_onboarding_draft_by_hash", {
    p_token_hash: tokenHash,
    p_payload: redactDraftPayload(payload),
    p_fingerprint_hash: fingerprintHash,
  });
  if (error || !data?.ok) return jsonResponse(request, GENERIC_ERROR, 401);
  return jsonResponse(request, { status: data.status });
}

async function legacySubmit(request: Request, token: string, payload: z.infer<typeof onboardingPayloadSchema>, fingerprintHash: string) {
  const admin = adminClient();
  const tokenHash = await hashClientLinkToken(token);
  const normalizedPayload = normalizePayload(payload);
  const securePayload = await protectSensitivePayload(normalizedPayload);
  const { data, error } = await admin.rpc("submit_onboarding_by_hash", {
    p_token_hash: tokenHash,
    p_payload: normalizedPayload,
    p_secure: securePayload,
    p_fingerprint_hash: fingerprintHash,
  });
  if (error || !data?.ok) return jsonResponse(request, GENERIC_ERROR, 401);
  return jsonResponse(request, { status: data.status, submissionId: data.submissionId, alreadySubmitted: Boolean(data.alreadySubmitted) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido" }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada" }, 403);

  const admin = adminClient();
  const fingerprintHash = await requestFingerprintHash(request);

  try {
    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return jsonResponse(request, GENERIC_ERROR, 400);
    if (!parsed.data.formKey && !parsed.data.token) return jsonResponse(request, GENERIC_ERROR, 400);

    if (await rateLimited(fingerprintHash)) {
      await admin.from("client_onboarding_events").insert({ event_type: "rate_limited", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 429);
    }

    if (parsed.data.token) {
      if (parsed.data.action === "metadata") return legacyMetadata(request, parsed.data.token, fingerprintHash);
      if (parsed.data.action === "draft") return legacyDraft(request, parsed.data.token, parsed.data.payload, fingerprintHash);
      return legacySubmit(request, parsed.data.token, parsed.data.payload, fingerprintHash);
    }

    const formKey = parsed.data.formKey!;
    const { data: publication } = await admin
      .from("onboarding_form_publications")
      .select("id, public_key, form_version, status, published_at")
      .eq("public_key", formKey)
      .maybeSingle();

    if (!publication || publication.status !== "published") {
      await admin.from("client_onboarding_events").insert({ publication_id: publication?.id ?? null, event_type: "invalid", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    if (parsed.data.action === "metadata") {
      await admin.from("client_onboarding_events").insert({ publication_id: publication.id, event_type: "publication_metadata", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, {
        mode: "public_entry",
        clientDisplayName: "novo cliente",
        status: "published",
        expiresAt: null,
        submittedAt: null,
        formVersion: publication.form_version,
        draft: {},
      });
    }

    if (parsed.data.action === "draft") {
      await admin.from("client_onboarding_events").insert({ publication_id: publication.id, event_type: "draft_saved", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, { status: "draft_saved" });
    }

    if (parsed.data.honeypot) {
      await admin.from("client_onboarding_events").insert({ publication_id: publication.id, event_type: "publication_submit_failed", fingerprint_hash: fingerprintHash });
      return jsonResponse(request, { status: "received" });
    }

    const normalizedPayload = normalizePayload(parsed.data.payload);
    const securePayload = await protectSensitivePayload(normalizedPayload);
    const idempotencyKey = parsed.data.idempotencyKey ?? crypto.randomUUID();
    const { data, error } = await admin.rpc("submit_public_onboarding_publication", {
      p_public_key: formKey,
      p_payload: normalizedPayload,
      p_secure: securePayload,
      p_idempotency_key: idempotencyKey,
      p_fingerprint_hash: fingerprintHash,
    });

    if (error || !data?.ok) {
      console.error("public onboarding submit failed", error?.message ?? data?.code ?? "unknown");
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    return jsonResponse(request, {
      status: "received",
      submissionStatus: data.status,
      submissionId: data.submissionId,
      clientCreated: Boolean(data.clientId),
      alreadySubmitted: Boolean(data.alreadySubmitted),
    });
  } catch (error) {
    console.error("onboarding-public failed", error instanceof Error ? error.message : "unknown");
    await admin.from("client_onboarding_events").insert({ event_type: "publication_submit_failed", fingerprint_hash: fingerprintHash });
    return jsonResponse(request, GENERIC_ERROR, 401);
  }
});
