import { supabase } from "@/lib/supabase";
import type { OnboardingDetail, OnboardingOverview, OnboardingPayload, PublicOnboardingMetadata } from "@/types/onboarding";

async function invokeAdminOnboarding<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("admin-onboarding", { body });
  if (error || !data) throw new Error(error?.message ?? "Operação de onboarding indisponível.");
  return data;
}

export async function getOnboardingOverview(filters: { search?: string; status?: string; duplicateOnly?: boolean; limit?: number; offset?: number } = {}): Promise<OnboardingOverview> {
  return invokeAdminOnboarding<OnboardingOverview>({
    action: "overview",
    search: filters.search || undefined,
    status: filters.status || undefined,
    duplicateOnly: filters.duplicateOnly || undefined,
    limit: filters.limit ?? 30,
    offset: filters.offset ?? 0,
  });
}

export async function publishOnboardingForm(): Promise<OnboardingOverview> {
  return invokeAdminOnboarding<OnboardingOverview>({ action: "publish" });
}

export async function pauseOnboardingForm(): Promise<OnboardingOverview> {
  return invokeAdminOnboarding<OnboardingOverview>({ action: "pause" });
}

export async function rotateOnboardingForm(): Promise<OnboardingOverview> {
  return invokeAdminOnboarding<OnboardingOverview>({ action: "rotate" });
}

export async function registerOnboardingCopy(): Promise<void> {
  await invokeAdminOnboarding<{ ok: boolean }>({ action: "copy" });
}

export async function getOnboardingDetail(submissionId: string): Promise<OnboardingDetail> {
  return invokeAdminOnboarding<OnboardingDetail>({ action: "detail", submissionId });
}

export async function getPublicOnboardingMetadata(formKey: string, legacy = false): Promise<PublicOnboardingMetadata> {
  const body = legacy ? { action: "metadata", token: formKey } : { action: "metadata", formKey };
  const { data, error } = await supabase.functions.invoke<PublicOnboardingMetadata>("onboarding-public", { body });
  if (error || !data) throw new Error("Onboarding indisponível.");
  return data;
}

export async function savePublicOnboardingDraft(formKey: string, payload: OnboardingPayload, legacy = false): Promise<{ status: string }> {
  const body = legacy ? { action: "draft", token: formKey, payload } : { action: "draft", formKey, payload };
  const { data, error } = await supabase.functions.invoke<{ status: string }>("onboarding-public", { body });
  if (error || !data) throw new Error("Rascunho não foi salvo.");
  return data;
}

export async function submitPublicOnboarding(formKey: string, payload: OnboardingPayload, legacy = false): Promise<{ status: string; submissionStatus?: string; submissionId: string; clientCreated?: boolean; alreadySubmitted: boolean }> {
  const body = legacy
    ? { action: "submit", token: formKey, payload }
    : { action: "submit", formKey, payload, idempotencyKey: crypto.randomUUID(), honeypot: "" };
  const { data, error } = await supabase.functions.invoke<{ status: string; submissionStatus?: string; submissionId: string; clientCreated?: boolean; alreadySubmitted: boolean }>("onboarding-public", { body });
  if (error || !data) throw new Error("Onboarding não foi enviado.");
  return data;
}
