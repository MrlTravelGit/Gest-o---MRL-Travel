import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

import { createClient, createClientErrorMessage } from "./admin";

describe("createClient", () => {
  beforeEach(() => invoke.mockReset());

  it("preserva a mensagem segura devolvida pela Edge Function", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({
          error: "Este e-mail já pertence a outro usuário. Use um e-mail exclusivo para o cliente.",
        }), { status: 409, headers: { "Content-Type": "application/json" } }),
      },
    });

    await expect(createClient({
      fullName: "Cliente Teste",
      email: "cliente@example.com",
      accessChannel: "email",
      startsOn: "2026-07-15",
      endsOn: "2027-07-15",
    })).rejects.toThrow("Este e-mail já pertence a outro usuário");
  });

  it("explica uma falha de rede ou CORS", async () => {
    await expect(createClientErrorMessage(new Error("Failed to send a request")))
      .resolves.toContain("endereço oficial da Vercel");
  });
});
