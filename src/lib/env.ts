import { publicEnvSchema } from "./env-schema";

const parsed = publicEnvSchema.safeParse(import.meta.env);

if (!parsed.success) {
  throw new Error(
    "Variáveis públicas inválidas. Confira VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.",
  );
}

export const env = parsed.data;
