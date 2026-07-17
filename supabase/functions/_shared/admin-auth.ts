import { createClient } from "npm:@supabase/supabase-js@2.93.3";
import { adminClient } from "./supabase.ts";
import { corsHeaders } from "./http.ts";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} ausente`);
  return value;
}

export interface AdminContext {
  userId: string;
  role: string;
}

export async function requireAdmin(request: Request, allowedRoles = ["super_admin", "manager"]): Promise<AdminContext> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    throw new Response(JSON.stringify({ error: "Não autorizado." }), { status: 401 });
  }

  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!publishableKey) throw new Error("Chave pública do Supabase ausente");

  const authClient = createClient(required("SUPABASE_URL"), publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: "Não autorizado." }), { status: 401 });
  }

  const admin = adminClient();
  const { data: staff, error: staffError } = await admin
    .from("staff_members")
    .select("role, active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (staffError || !staff || !allowedRoles.includes(staff.role)) {
    throw new Response(JSON.stringify({ error: "Acesso não autorizado." }), { status: 403 });
  }

  return { userId: data.user.id, role: staff.role };
}

export function adminErrorResponse(error: unknown, request: Request, headers: HeadersInit): Response {
  const responseHeaders = { ...corsHeaders(request), ...headers, "Content-Type": "application/json; charset=utf-8" };
  if (error instanceof Response) {
    return new Response(error.body, { status: error.status, headers: responseHeaders });
  }
  console.error("admin function failed", error instanceof Error ? error.message : "unknown");
  return new Response(JSON.stringify({ error: "Operação indisponível." }), {
    status: 500,
    headers: responseHeaders,
  });
}
