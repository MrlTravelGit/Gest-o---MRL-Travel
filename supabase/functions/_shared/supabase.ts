import { createClient } from "npm:@supabase/supabase-js@2.93.3";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} ausente`);
  return value;
}

export function adminClient() {
  return createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export function publicAuthClient() {
  const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
    ?? Deno.env.get("SUPABASE_ANON_KEY");

  if (!publishableKey) {
    throw new Error("Chave pública do Supabase ausente");
  }

  return createClient(required("SUPABASE_URL"), publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
