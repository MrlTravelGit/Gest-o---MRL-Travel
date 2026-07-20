import { afterEach, describe, expect, it, vi } from "vitest";
import { openClientPanel } from "@/lib/client-panel-link";

afterEach(() => vi.restoreAllMocks());

describe("openClientPanel", () => {
  it("não lança exceção quando o navegador bloqueia o pop-up", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(() => openClientPanel(`https://gestao-mrltravel.vercel.app/economia/${"a".repeat(64)}`)).not.toThrow();
    expect(openClientPanel(`https://gestao-mrltravel.vercel.app/economia/${"a".repeat(64)}`).opened).toBe(false);
  });

  it("recusa URL inválida sem poluir o console", () => {
    expect(openClientPanel("https://example.com/economia/token")).toEqual({ opened: false, message: "O link do painel está indisponível ou inválido." });
  });
});
