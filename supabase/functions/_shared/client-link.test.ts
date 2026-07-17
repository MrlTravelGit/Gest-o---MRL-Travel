import { describe, expect, it } from "vitest";
import { hashClientLinkToken, isClientLinkTokenFormat, normalizeClientLinkToken } from "./client-link.ts";

describe("client link token helpers", () => {
  it("normaliza o token hexadecimal sem alterar o algoritmo de links existentes", () => {
    expect(normalizeClientLinkToken("  ABCDEF0123456789  ")).toBe("abcdef0123456789");
  });

  it("valida apenas tokens hexadecimais de 64 caracteres", () => {
    expect(isClientLinkTokenFormat("0123456789abcdef".repeat(4))).toBe(true);
    expect(isClientLinkTokenFormat("g".repeat(64))).toBe(false);
    expect(isClientLinkTokenFormat("a".repeat(63))).toBe(false);
  });

  it("calcula o mesmo SHA-256 usado pela geração SQL do link", async () => {
    const token = "0123456789abcdef".repeat(4);

    await expect(hashClientLinkToken(token)).resolves.toBe("a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e");
    await expect(hashClientLinkToken(token.toUpperCase())).resolves.toBe("a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e");
  });
});
