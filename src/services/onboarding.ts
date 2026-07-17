import { supabase } from "@/lib/supabase";
import type { CreateOnboardingFormResult, OnboardingDetail, OnboardingFormListResult, OnboardingPayload, PublicOnboardingMetadata } from "@/types/onboarding";

export async function getOnboardingForms(filters: { search?: string; status?: string; limit?: number; offset?: number } = {}): Promise<OnboardingFormListResult> {
  const { data, error } = await supabase.rpc("get_client_onboarding_forms", {
    p_search: filters.search || null,
    p_status: filters.status || null,
    p_limit: filters.limit ?? 20,
    p_offset: filters.offset ?? 0,
  });
  if (error || !data) throw new Error(error?.message ?? "Não foi possível carregar formulários.");
  return data as unknown as OnboardingFormListResult;
}

export async function createOnboardingForm(input: { clientId: string; expiresAt?: string; notes?: string }): Promise<CreateOnboardingFormResult> {
  const { data, error } = await supabase.rpc("create_client_onboarding_form", {
    p_client_id: input.clientId,
    p_expires_at: input.expiresAt || null,
    p_notes: input.notes || null,
  });
  if (error || !data) throw new Error(error?.message ?? "Formulário não foi gerado.");
  return data as unknown as CreateOnboardingFormResult;
}

export async function revokeOnboardingForm(formId: string, reason: string) {
  const { data, error } = await supabase.rpc("revoke_client_onboarding_form", { p_form_id: formId, p_reason: reason || null });
  if (error || !data) throw new Error(error?.message ?? "Formulário não foi revogado.");
  return data;
}

export async function reopenOnboardingForm(formId: string, expiresAt?: string) {
  const { data, error } = await supabase.rpc("reopen_client_onboarding_form", { p_form_id: formId, p_expires_at: expiresAt || null });
  if (error || !data) throw new Error(error?.message ?? "Formulário não foi reaberto.");
  return data;
}

export async function getOnboardingDetail(formId: string): Promise<OnboardingDetail> {
  const { data, error } = await supabase.rpc("get_client_onboarding_detail", { p_form_id: formId });
  if (error || !data) throw new Error(error?.message ?? "Resposta não foi carregada.");
  return data as unknown as OnboardingDetail;
}

export async function getPublicOnboardingMetadata(token: string): Promise<PublicOnboardingMetadata> {
  const { data, error } = await supabase.functions.invoke<PublicOnboardingMetadata>("onboarding-public", { body: { action: "metadata", token } });
  if (error || !data) throw new Error("Onboarding indisponível.");
  return data;
}

export async function savePublicOnboardingDraft(token: string, payload: OnboardingPayload): Promise<{ status: string }> {
  const { data, error } = await supabase.functions.invoke<{ status: string }>("onboarding-public", { body: { action: "draft", token, payload } });
  if (error || !data) throw new Error("Rascunho não foi salvo.");
  return data;
}

export async function submitPublicOnboarding(token: string, payload: OnboardingPayload): Promise<{ status: string; submissionId: string; alreadySubmitted: boolean }> {
  const { data, error } = await supabase.functions.invoke<{ status: string; submissionId: string; alreadySubmitted: boolean }>("onboarding-public", { body: { action: "submit", token, payload } });
  if (error || !data) throw new Error("Onboarding não foi enviado.");
  return data;
}
