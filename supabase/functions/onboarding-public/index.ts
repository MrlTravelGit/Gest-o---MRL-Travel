import { z } from "npm:zod@3.25.76";
import { hashClientLinkToken, isClientLinkTokenFormat, requestFingerprintHash } from "../_shared/client-link.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { onboardingPayloadSchema, normalizePayload, protectSensitivePayload, publicSafeDraft, redactDraftPayload } from "../_shared/onboarding.ts";
import { adminClient } from "../_shared/supabase.ts";

const metadataSchema = z.object({
  action: z.literal("metadata"),
  token: z.string().refine(isClientLinkTokenFormat),
}).strict();

const draftSchema = z.object({
  action: z.literal("draft"),
  token: z.string().refine(isClientLinkTokenFormat),
  payload: z.record(z.unknown()),
}).strict();

const submitSchema = z.object({
  action: z.literal("submit"),
  token: z.string().refine(isClientLinkTokenFormat),
  payload: onboardingPayloadSchema,
}).strict();

const bodySchema = z.discriminatedUnion("action", [metadataSchema, draftSchema, submitSchema]);
const GENERIC_ERROR = { error: "Onboarding indisponível." };

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > 96_000) return { action: "too_large" };
    return await request.json();
  } catch {
    return {};
  }
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

    const tokenHash = await hashClientLinkToken(parsed.data.token);

    if (parsed.data.action === "metadata") {
      const { data, error } = await admin.rpc("resolve_onboarding_form_by_hash", {
        p_token_hash: tokenHash,
        p_event_type: "metadata",
        p_fingerprint_hash: fingerprintHash,
      });
      if (error || !data?.ok) return jsonResponse(request, GENERIC_ERROR, 401);
      return jsonResponse(request, {
        clientDisplayName: data.clientDisplayName,
        status: data.status,
        expiresAt: data.expiresAt,
        submittedAt: data.submittedAt,
        formVersion: data.formVersion,
        draft: data.draft ?? {},
      });
    }

    if (parsed.data.action === "draft") {
      const { data, error } = await admin.rpc("save_onboarding_draft_by_hash", {
        p_token_hash: tokenHash,
        p_payload: redactDraftPayload(parsed.data.payload),
        p_fingerprint_hash: fingerprintHash,
      });
      if (error || !data?.ok) return jsonResponse(request, GENERIC_ERROR, 401);
      return jsonResponse(request, { status: data.status });
    }

    const normalizedPayload = normalizePayload(parsed.data.payload);
    const securePayload = await protectSensitivePayload(normalizedPayload);
    const { data, error } = await admin.rpc("submit_onboarding_by_hash", {
      p_token_hash: tokenHash,
      p_payload: normalizedPayload,
      p_secure: securePayload,
      p_fingerprint_hash: fingerprintHash,
    });

    if (error || !data?.ok) {
      console.error("onboarding submit failed", error?.message ?? data?.code ?? "unknown");
      return jsonResponse(request, GENERIC_ERROR, 401);
    }

    return jsonResponse(request, {
      status: data.status,
      submissionId: data.submissionId,
      alreadySubmitted: Boolean(data.alreadySubmitted),
    });
  } catch (error) {
    console.error("onboarding-public failed", error instanceof Error ? error.message : "unknown");
    return jsonResponse(request, GENERIC_ERROR, 401);
  }
});
