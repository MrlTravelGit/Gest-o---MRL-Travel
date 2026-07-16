export function normalizeFirstName(value: string): string {
  return value
    .trim()
    .split(/\s+/)[0]
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function requestNetworkIdentity(request: Request): {
  ip: string;
  userAgent: string;
} {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim()
    || request.headers.get("cf-connecting-ip")
    || "unknown";

  return {
    ip,
    userAgent: request.headers.get("user-agent") ?? "unknown",
  };
}

export async function requestHashes(
  request: Request,
  publicId: string,
  firstName: string,
): Promise<{
  fingerprintHash: string;
  publicIdHash: string;
  firstNameHash: string;
}> {
  const pepper = Deno.env.get("ACCESS_HASH_PEPPER");
  if (!pepper) {
    throw new Error("ACCESS_HASH_PEPPER ausente");
  }

  const { ip, userAgent } = requestNetworkIdentity(request);
  return {
    fingerprintHash: await sha256(`${pepper}|${ip}|${userAgent}`),
    publicIdHash: await sha256(`${pepper}|${publicId}`),
    firstNameHash: await sha256(`${pepper}|${normalizeFirstName(firstName)}`),
  };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}

export function jwtAssuranceLevel(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as { aal?: unknown };
    return typeof decoded.aal === "string" ? decoded.aal : null;
  } catch {
    return null;
  }
}
