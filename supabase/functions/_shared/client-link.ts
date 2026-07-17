export const CLIENT_LINK_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export function normalizeClientLinkToken(token: string): string {
  return token.trim().toLowerCase();
}

export function isClientLinkTokenFormat(value: unknown): value is string {
  return typeof value === "string" && CLIENT_LINK_TOKEN_PATTERN.test(value.trim());
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashClientLinkToken(token: string): Promise<string> {
  return sha256Hex(normalizeClientLinkToken(token));
}

export async function requestFingerprintHash(request: Request): Promise<string> {
  const raw = [
    request.headers.get("x-forwarded-for") ?? "",
    request.headers.get("user-agent") ?? "",
    request.headers.get("accept-language") ?? "",
  ].join("|").slice(0, 500);

  return sha256Hex(raw);
}
