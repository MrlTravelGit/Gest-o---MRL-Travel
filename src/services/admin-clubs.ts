import { supabase } from "@/lib/supabase";
import type { ClubCatalogResult, ClubSubscriptionsResult } from "@/types/admin-modules";

export async function getClubCatalog(): Promise<ClubCatalogResult> {
  const { data, error } = await supabase.rpc("get_club_catalog", { p_program_id: null, p_active_only: false });
  if (error || !data) throw new Error("Não foi possível carregar o catálogo de clubes.");
  return data as unknown as ClubCatalogResult;
}

export async function getClubSubscriptions(status = "all", offset = 0): Promise<ClubSubscriptionsResult> {
  const { data, error } = await supabase.rpc("get_client_club_subscriptions", { p_client_id: null, p_status: status, p_limit: 50, p_offset: offset });
  if (error || !data) throw new Error("Não foi possível carregar assinaturas de clubes.");
  return data as unknown as ClubSubscriptionsResult;
}

export async function upsertClubSubscription(input: {
  subscriptionId?: string;
  clientId: string;
  accountId: string;
  planId: string;
  status: "active" | "paused" | "cancelled";
  startsOn: string;
  endsOn?: string;
  expectedCreditDay: number;
  nextCompetence: string;
  notes?: string;
}) {
  const { data, error } = await supabase.rpc("upsert_client_club_subscription", {
    p_subscription_id: input.subscriptionId ?? null,
    p_client_id: input.clientId,
    p_account_id: input.accountId,
    p_plan_id: input.planId,
    p_status: input.status,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn || null,
    p_expected_credit_day: input.expectedCreditDay,
    p_next_competence: input.nextCompetence,
    p_notes: input.notes || null,
  });
  if (error || !data) throw new Error(error?.message ?? "Assinatura não foi salva.");
  return data;
}

export async function confirmScheduledCredit(creditId: string, operationId: string) {
  const { data, error } = await supabase.rpc("confirm_scheduled_point_credit", { p_credit_id: creditId, p_operation_id: operationId });
  if (error || !data) throw new Error(error?.message ?? "Crédito não foi confirmado.");
  return data;
}
