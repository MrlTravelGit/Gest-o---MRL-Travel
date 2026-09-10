import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609090043_financial_programs_and_bonus_campaigns.sql"), "utf8");
const expectedAssets = ["nubank-croma.svg","nubank-ultravioleta.svg","picpay.svg","revolut.svg","btg-pactual.png","livelo.svg","itau.png","esfera.svg","astropay.png","bradesco-cartoes.png","banco-do-brasil.png","uau-caixa.svg","coopera.png","sicredi.png","banriclube.png","banco-do-nordeste.svg","banpara.svg","banco-pan.png","sisprime.png","credicard.svg","banestes.png","porto-bank.svg","brb-card.png","banco-mercantil.svg","unicred.png","credicoamo.png"];

describe("catálogo de programas financeiros", () => {
  it("mantém os 26 assets locais e seed idempotente por slug", () => {
    const assets = readdirSync(resolve("public/logos/programs/banks"));
    expect(expectedAssets.every((asset) => assets.includes(asset))).toBe(true);
    expect(new Set(expectedAssets).size).toBe(26);
    expect(migration).toContain("on conflict (slug) do update");
    expect(migration).toContain("('coopera','Coopera'");
    expect(migration).toContain("('banco_do_brasil','Banco do Brasil'");
    expect(migration).toMatch(/\('livelo','Livelo'.*true,true,true\)/);
    expect(migration).toMatch(/\('esfera','Esfera'.*true,true,true\)/);
    expect(migration).toContain("create table if not exists public.bonus_transfer_campaigns");
    expect(migration).toContain("source_ok");
    expect(migration).toContain("target_ok");
  });
});
