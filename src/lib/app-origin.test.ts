import { describe, expect, it } from "vitest";
import { getAppOriginStatus } from "./app-origin";

describe("getAppOriginStatus", () => {
  it("aceita a origem oficial", () => {
    expect(getAppOriginStatus(
      "https://gestao-mrltravel.vercel.app",
      "https://gestao-mrltravel.vercel.app",
    )).toEqual({
      canonicalOrigin: "https://gestao-mrltravel.vercel.app",
      isCanonical: true,
    });
  });

  it("rejeita uma origem de Preview", () => {
    expect(getAppOriginStatus(
      "https://gestao-mrl-travel-git-branch.vercel.app",
      "https://gestao-mrltravel.vercel.app",
    ).isCanonical).toBe(false);
  });

  it("normaliza a barra final pela origem da URL canônica", () => {
    expect(getAppOriginStatus(
      "https://gestao-mrltravel.vercel.app",
      "https://gestao-mrltravel.vercel.app/",
    )).toEqual({
      canonicalOrigin: "https://gestao-mrltravel.vercel.app",
      isCanonical: true,
    });
  });
});
