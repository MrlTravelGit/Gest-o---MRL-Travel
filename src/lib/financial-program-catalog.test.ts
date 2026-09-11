import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/202609090043_financial_programs_and_bonus_campaigns.sql"), "utf8");
const visibilityMigration = readFileSync(resolve("supabase/migrations/202609110044_canonical_program_catalog_and_zero_balance_wallet.sql"), "utf8");
const walletMigration = readFileSync(resolve("supabase/migrations/202609110045_client_wallet_relationship_visibility.sql"), "utf8");
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

  it("usa slugs canônicos e monta a carteira a partir dos programas ativos", () => {
    for (const slug of ["nubank-croma", "nubank-ultravioleta", "btg-pactual", "banco-do-brasil", "bradesco-cartoes", "banco-do-nordeste", "banco-pan", "porto-bank", "brb-card", "banco-mercantil"]) {
      expect(visibilityMigration).toContain(`('${slug}'`);
    }
    expect(visibilityMigration).toContain("supports_points_launch=true");
    expect(visibilityMigration).toContain("supports_bonus_transfer=true");
    expect(visibilityMigration).toContain("from public.loyalty_programs lp");
    expect(visibilityMigration).toContain("left join public.program_accounts pa");
    expect(visibilityMigration).toContain("'balance',coalesce(latest.balance,0)");
    expect(visibilityMigration).toContain("'hasMovements',exists(");
    expect(visibilityMigration).toContain("from public.point_transactions pt");
  });

  it("separa o catálogo completo da carteira relacionada ao cliente", () => {
    expect(walletMigration).toContain("'walletPrograms',public.build_admin_client_program_wallet(p_client_id)");
    expect(walletMigration).toContain("coalesce(latest.balance,movements.current_balance,0)>0");
    expect(walletMigration).toContain("coalesce(pa.club_active,false)");
    expect(walletMigration).toContain("club.future_date>=current_date");
    expect(walletMigration).toContain("nullif(btrim(pa.membership_number_masked),'') is not null");
    expect(walletMigration).toContain("select public.build_client_program_wallet(p_client_id)");
  });
});
