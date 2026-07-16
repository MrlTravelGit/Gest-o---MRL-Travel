import { describe, expect, it } from "vitest";
import { jwtAssuranceLevel } from "./security.ts";

function token(payload: object) {
  const encoded = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `header.${encoded}.signature`;
}

describe("jwtAssuranceLevel", () => {
  it("lê AAL2 apenas do token já validado pelo Auth", () => expect(jwtAssuranceLevel(token({ aal: "aal2" }))).toBe("aal2"));
  it("falha de forma fechada para token inválido", () => expect(jwtAssuranceLevel("invalid")).toBeNull());
});
