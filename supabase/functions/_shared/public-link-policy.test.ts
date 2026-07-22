import { describe, expect, it } from "vitest";
import { CONTRACT_REVIEW_NOTICE, evaluatePublicLinkAccess } from "./public-link-policy.ts";

describe("public client link access policy", () => {
  it("libera cliente ativo mesmo sem vigência revisada", () => {
    expect(evaluatePublicLinkAccess("active", "pending_review", false)).toEqual({
      allowed: true,
      code: null,
      notice: CONTRACT_REVIEW_NOTICE,
    });
  });

  it("libera cliente ativo com contrato revisado", () => {
    expect(evaluatePublicLinkAccess("active", "complete", true)).toEqual({
      allowed: true,
      code: null,
      notice: null,
    });
  });

  it("avisa quando a revisão está concluída, mas não existe vigência ativa", () => {
    expect(evaluatePublicLinkAccess("active", "complete", false)).toEqual({
      allowed: true,
      code: null,
      notice: CONTRACT_REVIEW_NOTICE,
    });
  });

  it.each(["lead", "ended", "paused", null])("bloqueia status não ativo: %s", (status) => {
    expect(evaluatePublicLinkAccess(status, "pending_review")).toEqual({
      allowed: false,
      code: "CLIENT_NOT_ACTIVE",
      notice: null,
    });
  });
});
