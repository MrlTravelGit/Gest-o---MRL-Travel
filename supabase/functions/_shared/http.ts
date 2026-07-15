const DEFAULT_ORIGIN = "http://localhost:5173";

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function allowedOrigins(): Set<string> {
  const configured = Deno.env.get("ALLOWED_ORIGINS") ?? DEFAULT_ORIGIN;
  return new Set(
    configured
      .split(",")
      .map(normalizeOrigin)
      .filter(Boolean),
  );
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  const allowed = allowedOrigins();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };

  if (origin && allowed.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || allowedOrigins().has(origin);
}

export function preflightResponse(request: Request): Response {
  const origin = request.headers.get("origin");
  const allowed = origin !== null && allowedOrigins().has(origin);

  return new Response(null, {
    status: allowed ? 204 : 403,
    headers: corsHeaders(request),
  });
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
