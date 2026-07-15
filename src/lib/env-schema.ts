import { z } from "zod";

const hasPlaceholder = (value: string) =>
  /substitua|seu_projeto|example/i.test(value);

export const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .url()
    .refine((value) => !hasPlaceholder(value), "URL do Supabase não configurada"),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(20)
    .startsWith("sb_publishable_")
    .refine(
      (value) => !hasPlaceholder(value),
      "Publishable Key do Supabase não configurada",
    ),
  VITE_APP_URL: z.string().url().optional(),
});
