import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeOrigin, preflightResponse } from "./http.ts";

const envGet = vi.fn();

beforeEach(() => {
  envGet.mockReset();
  envGet.mockReturnValue("https://gestao-mrltravel.vercel.app/");
  vi.stubGlobal("Deno", { env: { get: envGet } });
});

describe("normalizeOrigin", () => {
  it("remove espaços e barras finais da configuração", () => {
    expect(normalizeOrigin("  https://gestao-mrltravel.vercel.app///  "))
      .toBe("https://gestao-mrltravel.vercel.app");
  });
});

describe("preflightResponse", () => {
  it("aceita a origem oficial exata", () => {
    const response = preflightResponse(new Request("https://example.test", {
      method: "OPTIONS",
      headers: { Origin: "https://gestao-mrltravel.vercel.app" },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin"))
      .toBe("https://gestao-mrltravel.vercel.app");
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("nega Preview sem anunciar outra origem permitida", () => {
    const response = preflightResponse(new Request("https://example.test", {
      method: "OPTIONS",
      headers: { Origin: "https://preview-aleatorio.vercel.app" },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});
