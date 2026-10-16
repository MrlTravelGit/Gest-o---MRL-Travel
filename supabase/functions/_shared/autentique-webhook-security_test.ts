import { normalizeAutentiqueSignature, verifyAutentiqueWebhook } from "./autentique-webhook-security.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sign(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.test("valida HMAC SHA-256 sobre o corpo original", async () => {
  const secret = "deno-test-secret";
  const rawBody = '{\n  "event": {"id":"evt-deno"}\n}';
  const expected = await sign(rawBody, secret);
  assert(await verifyAutentiqueWebhook(rawBody, expected, secret), "assinatura válida foi rejeitada");
  assert(!await verifyAutentiqueWebhook(JSON.stringify(JSON.parse(rawBody)), expected, secret), "corpo transformado foi aceito");
});

Deno.test("normaliza somente o cabeçalho da assinatura", async () => {
  const secret = "deno-test-secret";
  const rawBody = "raw-body";
  const expected = await sign(rawBody, secret);
  assert(normalizeAutentiqueSignature(` SHA256=${expected.toUpperCase()} `) === expected, "cabeçalho não foi normalizado");
  assert(await verifyAutentiqueWebhook(rawBody, `sha256=${expected}`, secret), "prefixo sha256 foi rejeitado");
});
