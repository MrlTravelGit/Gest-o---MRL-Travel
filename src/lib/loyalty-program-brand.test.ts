import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOYALTY_PROGRAM_BRANDS, normalizeProgramIdentifier, resolveLoyaltyProgramBrand } from "./loyalty-program-brand";

describe("loyalty-program-brand", () => {
  it("resolve marcas conhecidas por slug e aliases com ou sem acento", () => {
    expect(resolveLoyaltyProgramBrand({ slug: "atomos", name: "Átomos" }).assetPath).toBe("/assets/loyalty-programs/%C3%A1tomos.svg");
    expect(resolveLoyaltyProgramBrand({ slug: null, name: "C6 Atomos" }).key).toBe("atomos");
    expect(resolveLoyaltyProgramBrand({ slug: null, name: "C6 Átomos" }).key).toBe("atomos");
    expect(resolveLoyaltyProgramBrand({ slug: "latam_pass", name: "LATAM Pass" }).key).toBe("latam-pass");
    expect(resolveLoyaltyProgramBrand({ slug: null, name: "Azul Fidelidade" }).assetPath).toBe("/assets/loyalty-programs/azul.svg");
    expect(resolveLoyaltyProgramBrand({ slug: null, name: "LIVELO" }).assetPath).toBe("/assets/loyalty-programs/logo-livelo.svg");
    expect(resolveLoyaltyProgramBrand({ slug: "tudo_azul", name: "TudoAzul" }).key).toBe("azul-fidelidade");
  });

  it("normaliza identificadores de forma controlada", () => {
    expect(normalizeProgramIdentifier("  LATAM Pass  ")).toBe("latam-pass");
    expect(normalizeProgramIdentifier("C6 Átomos")).toBe("c6-atomos");
  });

  it("usa fallback para programa desconhecido sem quebrar", () => {
    const brand = resolveLoyaltyProgramBrand({ slug: "programa_x", name: "Programa X" });

    expect(brand.known).toBe(false);
    expect(brand.assetPath).toBeNull();
    expect(brand.monogram).toBe("PX");
  });

  it("mantém todos os caminhos conhecidos ligados a arquivos públicos reais", () => {
    for (const brand of LOYALTY_PROGRAM_BRANDS) {
      const relative = decodeURIComponent(brand.assetPath).replace(/^\//, "");
      expect(existsSync(join(process.cwd(), "public", relative)), brand.assetPath).toBe(true);
    }
  });
});
