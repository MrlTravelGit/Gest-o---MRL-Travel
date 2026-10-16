export function normalizeAutentiqueSignature(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^sha256=/i, "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

export async function verifyAutentiqueWebhook(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  const signature = normalizeAutentiqueSignature(signatureHeader);
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return difference === 0;
}
