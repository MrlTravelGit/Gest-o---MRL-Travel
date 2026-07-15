import { describe, expect, it } from "vitest";
import { publicEnvSchema } from "./env-schema";

const validEnvironment = {
  VITE_SUPABASE_URL: "https://bdkazlhvnowjehdgxege.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_123456789012345678901234567890",
  VITE_APP_URL: "https://gestao-mrltravel.vercel.app",
};

describe("publicEnvSchema", () => {
  it("aceita a URL configurada e uma Publishable Key", () => {
    expect(publicEnvSchema.safeParse(validEnvironment).success).toBe(true);
  });

  it("rejeita URL fictícia", () => {
    const result = publicEnvSchema.safeParse({
      ...validEnvironment,
      VITE_SUPABASE_URL: "https://SEU_PROJETO.supabase.co",
    });

    expect(result.success).toBe(false);
  });

  it("rejeita Publishable Key fictícia", () => {
    const result = publicEnvSchema.safeParse({
      ...validEnvironment,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_SUBSTITUA",
    });

    expect(result.success).toBe(false);
  });
});
