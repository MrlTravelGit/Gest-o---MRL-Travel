import { supabase } from "@/lib/supabase";
import type { CardCatalogResult, CardRuleUnit, ClientCatalogCard } from "@/types/admin-modules";

export async function getCardCatalog(filters: {
  issuer?: string;
  program?: string;
  unitType?: CardRuleUnit | "";
  quality?: string;
  includeInactive?: boolean;
} = {}): Promise<CardCatalogResult> {
  const { data, error } = await supabase.rpc("get_card_catalog", {
    p_issuer: filters.issuer || null,
    p_program: filters.program || null,
    p_unit_type: filters.unitType || null,
    p_quality: filters.quality || null,
    p_include_inactive: filters.includeInactive ?? false,
  });
  if (error || !data) throw new Error(error?.message ?? "Não foi possível carregar o catálogo de cartões.");
  return data as unknown as CardCatalogResult;
}

export async function getClientCatalogCards(clientId: string): Promise<ClientCatalogCard[]> {
  const { data, error } = await supabase.rpc("get_client_catalog_cards", { p_client_id: clientId });
  if (error || !data) throw new Error(error?.message ?? "Não foi possível carregar os cartões do cliente.");
  return ((data as { items?: ClientCatalogCard[] }).items ?? []);
}

export async function associateCatalogCard(input: {
  clientId: string;
  catalogVersionId: string;
  startedOn: string;
  endedOn?: string;
  lastFour?: string;
  ownership: "holder" | "additional";
  rewardMode: "points" | "cashback";
  relationshipCondition?: string;
  clubCondition?: string;
  eliteCategoryCondition?: string;
  acceleratorActive: boolean;
  automaticDebitActive: boolean;
  customRate?: number | null;
  customUnitType?: CardRuleUnit | null;
  customRateJustification?: string;
  customRateSource?: string;
  notes?: string;
}) {
  const { data, error } = await supabase.rpc("associate_catalog_card", {
    p_client_id: input.clientId,
    p_catalog_version_id: input.catalogVersionId,
    p_started_on: input.startedOn,
    p_last_four: input.lastFour || null,
    p_ownership: input.ownership,
    p_reward_mode: input.rewardMode,
    p_relationship_condition: input.relationshipCondition || null,
    p_club_condition: input.clubCondition || null,
    p_elite_category_condition: input.eliteCategoryCondition || null,
    p_accelerator_active: input.acceleratorActive,
    p_automatic_debit_active: input.automaticDebitActive,
    p_custom_rate: input.customRate ?? null,
    p_custom_unit_type: input.customUnitType || null,
    p_custom_rate_justification: input.customRateJustification || null,
    p_custom_rate_source: input.customRateSource || null,
    p_notes: input.notes || null,
    p_ended_on: input.endedOn || null,
  });
  if (error || !data) throw new Error(error?.message ?? "Não foi possível associar o cartão.");
  return data;
}

export async function duplicateCardCatalogVersion(catalogVersionId: string, reason: string) {
  const { data, error } = await supabase.rpc("duplicate_card_catalog_version", {
    p_catalog_version_id: catalogVersionId,
    p_reason: reason,
  });
  if (error || !data) throw new Error(error?.message ?? "Não foi possível criar a nova versão.");
  return data;
}

export async function setCardCatalogActive(catalogVersionId: string, active: boolean, reason: string) {
  const { data, error } = await supabase.rpc("set_card_catalog_active", {
    p_catalog_version_id: catalogVersionId,
    p_active: active,
    p_reason: reason,
  });
  if (error || !data) throw new Error(error?.message ?? "Não foi possível atualizar a versão.");
  return data;
}

export async function updateCardCatalogRule(input: {
  ruleId: string;
  rate?: number | null;
  denominator?: number | null;
  calculationEnabled: boolean;
  requiresReview: boolean;
  validUntil?: string;
  sourceUrl?: string;
  sourceCheckedAt: string;
  reason: string;
}) {
  const { data, error } = await supabase.rpc("update_card_catalog_rule", {
    p_rule_id: input.ruleId,
    p_rate: input.rate ?? null,
    p_denominator: input.denominator ?? null,
    p_calculation_enabled: input.calculationEnabled,
    p_requires_review: input.requiresReview,
    p_valid_until: input.validUntil || null,
    p_source_url: input.sourceUrl || null,
    p_source_checked_at: input.sourceCheckedAt,
    p_reason: input.reason,
  });
  if (error || !data) throw new Error(error?.message ?? "Não foi possível atualizar a regra.");
  return data;
}
