import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import { createOnboardingForm, getPublicOnboardingMetadata, submitPublicOnboarding } from "./onboarding";
import { onboardingDefaultValues } from "@/lib/onboarding";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const rpc = vi.mocked(supabase.rpc);
const invoke = vi.mocked(supabase.functions.invoke);

describe("onboarding services", () => {
  beforeEach(() => {
    rpc.mockReset();
    invoke.mockReset();
  });

  it("gera link admin por RPC autenticada", async () => {
    rpc.mockResolvedValue({ data: { formId: "form", token: "a".repeat(64), path: "/onboarding/" + "a".repeat(64), expiresAt: null }, error: null, count: null, status: 200, statusText: "OK", success: true });

    await createOnboardingForm({ clientId: "client-id", expiresAt: "2026-08-16T23:59:59" });

    expect(rpc).toHaveBeenCalledWith("create_client_onboarding_form", {
      p_client_id: "client-id",
      p_expires_at: "2026-08-16T23:59:59",
      p_notes: null,
    });
  });

  it("valida metadata pública sem enviar client_id", async () => {
    invoke.mockResolvedValue({ data: { clientDisplayName: "Cliente", status: "pending", expiresAt: null, submittedAt: null, formVersion: "v", draft: {} }, error: null });

    await getPublicOnboardingMetadata("b".repeat(64));

    expect(invoke).toHaveBeenCalledWith("onboarding-public", { body: { action: "metadata", token: "b".repeat(64) } });
  });

  it("submete onboarding público sem client_id no body", async () => {
    invoke.mockResolvedValue({ data: { status: "submitted", submissionId: "submission", alreadySubmitted: false }, error: null });

    await submitPublicOnboarding("c".repeat(64), onboardingDefaultValues);

    const body = invoke.mock.calls[0][1]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ action: "submit", token: "c".repeat(64) });
    expect(JSON.stringify(body)).not.toContain("clientId");
  });
});
