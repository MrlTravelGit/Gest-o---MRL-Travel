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

type PublicErrorCode =
  | "ONBOARDING_BAD_REQUEST"
  | "ONBOARDING_VALIDATION_FAILED"
  | "ONBOARDING_UNAVAILABLE"
  | "ONBOARDING_RATE_LIMITED"
  | "ONBOARDING_PAYLOAD_TOO_LARGE"
  | "ONBOARDING_SUBMIT_FAILED";

function newRequestId(): string {
  return crypto.randomUUID();
}

function publicError(
  request: Request,
  status: number,
  code: PublicErrorCode,
  error: string,
  requestId: string,
  extra: Record<string, unknown> = {},
) {
  return jsonResponse(request, { code, error, requestId, ...extra }, status);
}

function safeIssues(error: z.ZodError) {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function logFailure(requestId: string, stage: string, code: string, error: unknown, startedAt: number) {
  const err = error as { code?: unknown; name?: unknown };
  console.error(JSON.stringify({
    requestId,
    stage,
    code,
    errorClass: err?.name ?? (error instanceof Error ? error.name : typeof error),
    sqlstate: typeof err?.code === "string" ? err.code : null,
    durationMs: Date.now() - startedAt,
  }));
}

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
  const requestId = newRequestId();
  const startedAt = Date.now();
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return publicError(request, 405, "ONBOARDING_BAD_REQUEST", "Método não permitido.", requestId);
  if (!isAllowedOrigin(request)) return publicError(request, 403, "ONBOARDING_BAD_REQUEST", "Origem não autorizada.", requestId);

  const admin = adminClient();
  const fingerprintHash = await requestFingerprintHash(request);

  try {
    const rawBody = await readJsonBody(request);
    if ((rawBody as { action?: string }).action === "too_large") {
      return publicError(request, 413, "ONBOARDING_PAYLOAD_TOO_LARGE", "O formulário é muito grande para envio.", requestId);
    }

    const actionProbe = z.object({ action: z.string().optional() }).passthrough().safeParse(rawBody);
    if (actionProbe.success && actionProbe.data.action === "submit") {
      const submitParsed = submitSchema.safeParse(rawBody);
      if (!submitParsed.success) {
        return publicError(request, 422, "ONBOARDING_VALIDATION_FAILED", "Revise os campos destacados e tente novamente.", requestId, {
          fields: safeIssues(submitParsed.error),
        });
      }
    }

    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return publicError(request, 400, "ONBOARDING_BAD_REQUEST", "Requisição inválida.", requestId);
    }
    if (!parsed.data.formKey && !parsed.data.token) {
      return publicError(request, 400, "ONBOARDING_BAD_REQUEST", "Link de onboarding inválido.", requestId);
    }

    if (await rateLimited(fingerprintHash)) {
      await admin.from("client_onboarding_events").insert({ event_type: "rate_limited", fingerprint_hash: fingerprintHash });
      return publicError(request, 429, "ONBOARDING_RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos e tente novamente.", requestId);
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
      const status = publication ? 409 : 404;
      return publicError(request, status, "ONBOARDING_UNAVAILABLE", "Onboarding indisponível.", requestId);
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
      logFailure(requestId, "submit_rpc", error?.code ?? data?.code ?? "RPC_FAILED", error ?? data, startedAt);
      return publicError(request, 500, "ONBOARDING_SUBMIT_FAILED", "Não foi possível concluir o envio agora.", requestId);
    }

    return jsonResponse(request, {
      status: "received",
      submissionStatus: data.status,
      submissionId: data.submissionId,
      clientCreated: Boolean(data.clientId),
      alreadySubmitted: Boolean(data.alreadySubmitted),
    });
  } catch (error) {
    logFailure(requestId, "handler", "UNEXPECTED", error, startedAt);
    await admin.from("client_onboarding_events").insert({ event_type: "publication_submit_failed", fingerprint_hash: fingerprintHash });
    return publicError(request, 500, "ONBOARDING_SUBMIT_FAILED", "Não foi possível concluir o envio agora.", requestId);
  }
});
