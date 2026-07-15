const DEFAULT_ORIGIN = "http://localhost:5173";

function allowedOrigins(): Set<string> {
  const configured = Deno.env.get("ALLOWED_ORIGINS") ?? DEFAULT_ORIGIN;
  return new Set(
    configured
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  const allowed = allowedOrigins();
  const selectedOrigin = allowed.has(origin) ? origin : [...allowed][0] ?? DEFAULT_ORIGIN;

  return {
    "Access-Control-Allow-Origin": selectedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || allowedOrigins().has(origin);
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
