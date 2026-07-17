import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { getPublicOnboardingMetadata, publishOnboardingForm, submitPublicOnboarding } from "./onboarding";
import { onboardingDefaultValues } from "@/lib/onboarding";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
  },
}));

const invoke = vi.mocked(supabase.functions.invoke);

describe("onboarding services", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("publica onboarding sem client_id", async () => {
    invoke.mockResolvedValue({ data: { publication: { hasPublication: true, url: "https://gestao-mrltravel.vercel.app/entrar-na-gestao/key" } }, error: null });

    await publishOnboardingForm();

    expect(invoke).toHaveBeenCalledWith("admin-onboarding", { body: { action: "publish" } });
    expect(JSON.stringify(invoke.mock.calls[0][1]?.body)).not.toContain("client");
  });

  it("carrega metadata pública pelo formKey sem client_id", async () => {
    invoke.mockResolvedValue({ data: { mode: "public_entry", clientDisplayName: "novo cliente", status: "published", expiresAt: null, submittedAt: null, formVersion: "v", draft: {} }, error: null });

    await getPublicOnboardingMetadata("form_key_publico_aleatorio_1234567890");

    expect(invoke).toHaveBeenCalledWith("onboarding-public", { body: { action: "metadata", formKey: "form_key_publico_aleatorio_1234567890" } });
  });

  it("submete onboarding público sem client_id no body", async () => {
    invoke.mockResolvedValue({ data: { status: "received", submissionId: "submission", alreadySubmitted: false, clientCreated: true }, error: null });

    await submitPublicOnboarding("form_key_publico_aleatorio_1234567890", onboardingDefaultValues);

    const body = invoke.mock.calls[0][1]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ action: "submit", formKey: "form_key_publico_aleatorio_1234567890" });
    expect(JSON.stringify(body)).not.toContain("clientId");
    expect(JSON.stringify(body)).not.toContain("\"-\"");
  });
});
