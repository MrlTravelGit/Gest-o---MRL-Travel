import { z } from "npm:zod@3.25.76";
import { requireAdmin, adminErrorResponse } from "../_shared/admin-auth.ts";
import { isAllowedOrigin, jsonResponse, preflightResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";
import { newPublicKey } from "../_shared/token-vault.ts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("overview"), search: z.string().optional(), status: z.string().optional(), duplicateOnly: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() }).strict(),
  z.object({ action: z.literal("publish") }).strict(),
  z.object({ action: z.literal("pause") }).strict(),
  z.object({ action: z.literal("rotate") }).strict(),
  z.object({ action: z.literal("detail"), submissionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("copy") }).strict(),
]);

function appUrl(): string {
  return (Deno.env.get("APP_URL") ?? "https://gestao-mrltravel.vercel.app").replace(/\/+$/, "");
}

function publicationUrl(publicKey: string | null | undefined): string | null {
  return publicKey ? `${appUrl()}/entrar-na-gestao/${publicKey}` : null;
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function currentPublication() {
  const admin = adminClient();
  const { data, error } = await admin
    .from("onboarding_form_publications")
    .select("*")
    .in("status", ["published", "paused", "draft"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function publicationPayload(row: Record<string, unknown> | null) {
  if (!row) return { hasPublication: false, status: "none", url: null };
  return {
    hasPublication: true,
    publicationId: row.id,
    publicKeySuffix: String(row.public_key).slice(-8),
    status: row.status,
    url: publicationUrl(String(row.public_key)),
    formVersion: row.form_version,
    publishedAt: row.published_at,
    pausedAt: row.paused_at,
    createdAt: row.created_at,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "POST") return jsonResponse(request, { error: "Método não permitido" }, 405);
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origem não autorizada" }, 403);

  try {
    const actor = await requireAdmin(request, ["super_admin", "manager", "operator"]);
    const parsed = bodySchema.safeParse(await readBody(request));
    if (!parsed.success) return jsonResponse(request, { error: "Requisição inválida." }, 400);

    const admin = adminClient();

    if (parsed.data.action === "publish") {
      const existing = await currentPublication();
      let publication = existing;
      if (!publication) {
        const { data, error } = await admin
          .from("onboarding_form_publications")
          .insert({ public_key: newPublicKey(), status: "published", published_at: new Date().toISOString(), created_by: actor.userId })
          .select("*")
          .single();
        if (error) throw error;
        publication = data;
      } else if (publication.status !== "published") {
        const { data, error } = await admin
          .from("onboarding_form_publications")
          .update({ status: "published", published_at: new Date().toISOString(), paused_at: null })
          .eq("id", publication.id)
          .select("*")
          .single();
        if (error) throw error;
        publication = data;
      }
      await admin.from("client_onboarding_events").insert({ publication_id: publication.id, actor_user_id: actor.userId, event_type: "publication_published" });
      return jsonResponse(request, { publication: publicationPayload(publication) });
    }

    if (parsed.data.action === "pause") {
      const publication = await currentPublication();
      if (!publication) return jsonResponse(request, { error: "Publicação não encontrada." }, 404);
      const { data, error } = await admin
        .from("onboarding_form_publications")
        .update({ status: "paused", paused_at: new Date().toISOString() })
        .eq("id", publication.id)
        .select("*")
        .single();
      if (error) throw error;
      await admin.from("client_onboarding_events").insert({ publication_id: data.id, actor_user_id: actor.userId, event_type: "publication_paused" });
      return jsonResponse(request, { publication: publicationPayload(data) });
    }

    if (parsed.data.action === "rotate") {
      const previous = await currentPublication();
      if (previous) {
        await admin
          .from("onboarding_form_publications")
          .update({ status: "retired", retired_at: new Date().toISOString() })
          .eq("id", previous.id);
      }
      const { data, error } = await admin
        .from("onboarding_form_publications")
        .insert({ public_key: newPublicKey(), status: "published", published_at: new Date().toISOString(), created_by: actor.userId, notes: previous ? `Rotacionada a partir de ${previous.id}` : null })
        .select("*")
        .single();
      if (error) throw error;
      await admin.from("client_onboarding_events").insert({ publication_id: data.id, actor_user_id: actor.userId, event_type: "publication_rotated", metadata: { previousPublicationId: previous?.id ?? null } });
      return jsonResponse(request, { publication: publicationPayload(data), previousPublicationId: previous?.id ?? null });
    }

    if (parsed.data.action === "copy") {
      const publication = await currentPublication();
      if (publication) await admin.from("client_onboarding_events").insert({ publication_id: publication.id, actor_user_id: actor.userId, event_type: "admin_publication_copied" });
      return jsonResponse(request, { ok: true });
    }

    if (parsed.data.action === "detail") {
      const { data: submission, error } = await admin
        .from("client_onboarding_submissions")
        .select("*")
        .eq("id", parsed.data.submissionId)
        .maybeSingle();
      if (error) throw error;
      if (!submission) return jsonResponse(request, { error: "Resposta não encontrada." }, 404);
      const [{ data: cards }, { data: loyaltyAccounts }, { data: plannedTrips }, { data: events }, { data: client }] = await Promise.all([
        admin.from("client_onboarding_cards").select("*").eq("submission_id", submission.id).order("created_at"),
        admin.from("client_onboarding_loyalty_accounts").select("*").eq("submission_id", submission.id).order("created_at"),
        admin.from("client_onboarding_planned_trips").select("*").eq("submission_id", submission.id).order("created_at"),
        admin.from("client_onboarding_events").select("event_type, created_at, metadata").eq("submission_id", submission.id).order("created_at", { ascending: false }),
        submission.client_id ? admin.from("clients").select("id, full_name, status, email, phone_e164, created_at").eq("id", submission.client_id).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      await admin.from("client_onboarding_events").insert({ publication_id: submission.publication_id, submission_id: submission.id, client_id: submission.client_id, actor_user_id: actor.userId, event_type: "admin_submission_viewed" });
      return jsonResponse(request, { submission, client, cards: cards ?? [], loyaltyAccounts: loyaltyAccounts ?? [], plannedTrips: plannedTrips ?? [], events: events ?? [] });
    }

    const publication = await currentPublication();
    const limit = parsed.data.limit ?? 30;
    const offset = parsed.data.offset ?? 0;
    let submissionsQuery = admin
      .from("client_onboarding_submissions")
      .select("id, publication_id, client_id, status, duplicate_candidate_client_id, duplicate_reason, full_name, email, whatsapp_e164, cpf_last4, submitted_at, lead_created_at, created_at", { count: "exact" })
      .eq("source", "public_onboarding")
      .order("submitted_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (parsed.data.search) {
      submissionsQuery = submissionsQuery.or(`full_name.ilike.%${parsed.data.search}%,email.ilike.%${parsed.data.search}%`);
    }
    if (parsed.data.status) submissionsQuery = submissionsQuery.eq("status", parsed.data.status);
    if (parsed.data.duplicateOnly) submissionsQuery = submissionsQuery.eq("status", "duplicate_review");

    const [{ data: submissions, count, error }, { data: legacy }, { data: summaryRows }] = await Promise.all([
      submissionsQuery,
      admin.from("client_onboarding_forms").select("id, client_id, status, created_at, submitted_at, expires_at, token_hint").order("created_at", { ascending: false }).limit(20),
      admin.from("client_onboarding_submissions").select("status, client_id").eq("source", "public_onboarding"),
    ]);
    if (error) throw error;

    const clientIds = [...new Set((submissions ?? []).map((item) => item.client_id).filter(Boolean))] as string[];
    const clientsById = new Map<string, Record<string, unknown>>();
    if (clientIds.length) {
      const { data: clients } = await admin.from("clients").select("id, full_name, status").in("id", clientIds);
      for (const client of clients ?? []) clientsById.set(client.id, client);
    }

    const summary = {
      received: summaryRows?.length ?? 0,
      awaitingReview: summaryRows?.filter((row) => ["client_created", "duplicate_review", "received"].includes(row.status)).length ?? 0,
      clientsCreated: summaryRows?.filter((row) => Boolean(row.client_id)).length ?? 0,
      duplicates: summaryRows?.filter((row) => row.status === "duplicate_review").length ?? 0,
      activated: summaryRows?.filter((row) => row.status === "activated").length ?? 0,
    };

    return jsonResponse(request, {
      publication: publicationPayload(publication),
      submissions: (submissions ?? []).map((item) => ({
        ...item,
        phoneMasked: item.whatsapp_e164 ? `${String(item.whatsapp_e164).slice(0, 5)}*****${String(item.whatsapp_e164).slice(-2)}` : null,
        client: item.client_id ? clientsById.get(item.client_id) ?? null : null,
      })),
      total: count ?? 0,
      limit,
      offset,
      summary,
      legacyForms: legacy ?? [],
    });
  } catch (error) {
    return adminErrorResponse(error, request, { "Cache-Control": "no-store" });
  }
});
