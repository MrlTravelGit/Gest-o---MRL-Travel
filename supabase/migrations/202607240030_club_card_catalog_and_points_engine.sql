-- PATCH MRL 025 - Clubes Esfera/Smiles + Streaming, catalogo versionado de
-- cartoes, vinculos de clientes e motor de previsao de pontos.
--
-- Migration exclusivamente aditiva. Nao apaga dados, nao recalcula faturas
-- antigas e reutiliza as tabelas de clubes criadas pelo Patch 018.

begin;

-- ---------------------------------------------------------------------------
-- 1. Evolucao da fonte canonica de clubes do Patch 018
-- ---------------------------------------------------------------------------

alter table public.loyalty_club_plans
  add column if not exists slug text,
  add column if not exists product_family text,
  add column if not exists price_qualifier text not null default 'fixed',
  add column if not exists joining_bonus_points bigint not null default 0,
  add column if not exists joining_bonus_conditions jsonb not null default '{}'::jsonb,
  add column if not exists minimum_transfer_points bigint,
  add column if not exists purchase_points_discount_percent numeric(8,4),
  add column if not exists monthly_purchase_points_limit bigint,
  add column if not exists review_status text not null default 'reviewed',
  add column if not exists catalog_version integer not null default 1,
  add column if not exists idempotency_key text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

update public.loyalty_club_plans
set slug = replace(stable_code, '_', '-'),
    product_family = coalesce(product_family, name),
    idempotency_key = coalesce(idempotency_key, 'club_plan_catalog:' || replace(stable_code, '_', '-') || ':1')
where slug is null or product_family is null or idempotency_key is null;

alter table public.loyalty_club_plans
  alter column slug set not null,
  alter column product_family set not null,
  alter column idempotency_key set not null;

alter table public.loyalty_club_plans drop constraint if exists loyalty_club_plans_program_id_stable_code_key;

create unique index if not exists loyalty_club_plan_version_uidx
  on public.loyalty_club_plans(program_id, slug, catalog_version);
create unique index if not exists loyalty_club_plan_idempotency_uidx
  on public.loyalty_club_plans(idempotency_key);

do $$
begin
  alter table public.loyalty_club_plans
    add constraint club_plan_price_qualifier_valid
    check (price_qualifier in ('fixed','from','promotional'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.loyalty_club_plans
    add constraint club_plan_review_status_valid
    check (review_status in ('reviewed','needs_review','archived'));
exception when duplicate_object then null;
end $$;

alter table public.client_club_subscriptions
  add column if not exists effective_price numeric(16,2),
  add column if not exists price_currency char(3) not null default 'BRL',
  add column if not exists joining_bonus_eligible boolean,
  add column if not exists joining_bonus_confirmed_at timestamptz,
  add column if not exists contracted_offer text,
  add column if not exists selected_streaming text,
  add column if not exists administrative_confirmation jsonb not null default '{}'::jsonb;

create table if not exists public.client_club_streaming_history (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.client_club_subscriptions(id) on delete cascade,
  streaming_name text not null,
  starts_on date not null,
  ends_on date,
  changed_by uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  constraint club_streaming_history_date_order check (ends_on is null or ends_on >= starts_on),
  unique(subscription_id, starts_on)
);

create table if not exists public.club_joining_bonus_credits (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.client_club_subscriptions(id) on delete cascade,
  expected_points bigint not null,
  eligibility_confirmed boolean not null default false,
  eligibility_details jsonb not null default '{}'::jsonb,
  expected_on date,
  status public.scheduled_credit_status not null default 'expected',
  confirmed_transaction_id uuid references public.point_transactions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_joining_bonus_positive check (expected_points > 0),
  unique(subscription_id)
);

-- ---------------------------------------------------------------------------
-- 2. Catalogo versionado de cartoes e regras
-- ---------------------------------------------------------------------------

create table if not exists public.card_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  card_slug text not null,
  version integer not null default 1,
  issuer text not null,
  card_name text not null,
  card_variant text,
  brand text,
  rewards_program text not null,
  source_url text not null,
  source_checked_at date not null,
  valid_from date not null,
  valid_until date,
  source_quality text not null,
  calculation_enabled boolean not null default true,
  requires_review boolean not null default false,
  review_notes text,
  active boolean not null default true,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_catalog_slug_format check (card_slug ~ '^[a-z0-9-]+$'),
  constraint card_catalog_version_positive check (version > 0),
  constraint card_catalog_quality_valid check (source_quality in ('official_exact','official_up_to','official_conditional')),
  constraint card_catalog_dates_valid check (valid_until is null or valid_until >= valid_from),
  unique(card_slug, version),
  unique(idempotency_key)
);

create table if not exists public.card_catalog_rules (
  id uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references public.card_catalog_versions(id) on delete restrict,
  rule_scope text not null,
  unit_type text not null,
  rate numeric(18,8),
  denominator numeric(18,8),
  spend_currency char(3) not null default 'BRL',
  spend_location text not null default 'any',
  merchant_scope text not null default 'any',
  merchant_match text,
  minimum_statement_amount numeric(16,2),
  maximum_statement_amount numeric(16,2),
  relationship_condition text,
  club_condition text,
  elite_category_condition text,
  accelerator_condition boolean,
  reward_mode_condition text,
  automatic_debit_condition boolean,
  is_additive boolean not null default false,
  priority integer not null default 100,
  valid_from date not null,
  valid_until date,
  source_url text not null,
  source_checked_at date not null,
  source_quality text not null,
  calculation_enabled boolean not null default true,
  requires_review boolean not null default false,
  version integer not null default 1,
  idempotency_key text not null,
  conditions jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint card_rule_unit_valid check (unit_type in ('points_per_usd','points_per_brl','one_point_per_brl_amount')),
  constraint card_rule_value_valid check (
    (unit_type in ('points_per_usd','points_per_brl') and rate is not null and rate > 0 and denominator is null)
    or (unit_type = 'one_point_per_brl_amount' and denominator is not null and denominator > 0 and rate is null)
  ),
  constraint card_rule_location_valid check (spend_location in ('domestic','international','any')),
  constraint card_rule_merchant_valid check (merchant_scope in ('any','airline','program_partner','streaming','custom')),
  constraint card_rule_quality_valid check (source_quality in ('official_exact','official_up_to','official_conditional')),
  constraint card_rule_dates_valid check (valid_until is null or valid_until >= valid_from),
  constraint card_rule_statement_band_valid check (
    minimum_statement_amount is null or maximum_statement_amount is null
    or maximum_statement_amount >= minimum_statement_amount
  ),
  unique(idempotency_key)
);

create index if not exists card_catalog_filter_idx
  on public.card_catalog_versions(active, issuer, rewards_program, source_quality);
create index if not exists card_catalog_rules_match_idx
  on public.card_catalog_rules(catalog_version_id, calculation_enabled, valid_from, valid_until, priority desc);

alter table public.credit_cards
  add column if not exists catalog_version_id uuid references public.card_catalog_versions(id) on delete restrict,
  add column if not exists started_on date,
  add column if not exists ended_on date,
  add column if not exists ownership text not null default 'holder',
  add column if not exists reward_mode text not null default 'points',
  add column if not exists relationship_condition text,
  add column if not exists club_condition text,
  add column if not exists elite_category_condition text,
  add column if not exists accelerator_active boolean not null default false,
  add column if not exists automatic_debit_active boolean not null default false,
  add column if not exists custom_rate numeric(18,8),
  add column if not exists custom_unit_type text,
  add column if not exists custom_rate_justification text,
  add column if not exists custom_rate_source text,
  add column if not exists association_key text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.credit_cards alter column last_four drop not null;

do $$
begin
  alter table public.credit_cards add constraint credit_card_catalog_dates_valid
    check (ended_on is null or started_on is null or ended_on >= started_on);
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.credit_cards add constraint credit_card_ownership_valid
    check (ownership in ('holder','additional'));
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.credit_cards add constraint credit_card_reward_mode_valid
    check (reward_mode in ('points','cashback'));
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.credit_cards add constraint credit_card_custom_rate_complete
    check (
      (custom_rate is null and custom_unit_type is null and custom_rate_justification is null and custom_rate_source is null)
      or (
        custom_rate is not null and custom_rate > 0
        and custom_unit_type in ('points_per_usd','points_per_brl','one_point_per_brl_amount')
        and length(trim(custom_rate_justification)) >= 10
        and length(trim(custom_rate_source)) >= 5
      )
    );
exception when duplicate_object then null;
end $$;

create unique index if not exists credit_card_association_key_uidx
  on public.credit_cards(association_key) where association_key is not null;

alter table public.card_statements
  add column if not exists calculated_expected_points numeric(18,4),
  add column if not exists calculation_version text,
  add column if not exists calculation_details jsonb not null default '{}'::jsonb,
  add column if not exists catalog_version_id uuid references public.card_catalog_versions(id) on delete restrict,
  add column if not exists calculated_at timestamptz;

create table if not exists public.card_statement_spend_segments (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.card_statements(id) on delete cascade,
  segment_order integer not null,
  amount_brl numeric(16,2) not null,
  spend_location text not null default 'domestic',
  merchant_scope text not null default 'any',
  merchant_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint statement_segment_amount_positive check (amount_brl > 0),
  constraint statement_segment_location_valid check (spend_location in ('domestic','international','any')),
  constraint statement_segment_merchant_valid check (merchant_scope in ('any','airline','program_partner','streaming','custom')),
  unique(statement_id, segment_order)
);

create table if not exists public.card_statement_rule_applications (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.card_statements(id) on delete cascade,
  segment_id uuid not null references public.card_statement_spend_segments(id) on delete cascade,
  rule_id uuid references public.card_catalog_rules(id) on delete restrict,
  rule_snapshot jsonb not null,
  eligible_amount_brl numeric(16,2) not null,
  fx_rate numeric(18,8),
  calculated_points numeric(18,4) not null,
  created_at timestamptz not null default now(),
  unique(statement_id, segment_id, rule_id)
);

-- ---------------------------------------------------------------------------
-- 3. Seeds versionados dos cinco clubes
-- ---------------------------------------------------------------------------

with club_seed(program_slug, stable_code, slug, plan_name, family, monthly_points, price, price_qualifier,
  joining_bonus, bonus_conditions, minimum_transfer, purchase_discount, purchase_limit, source_url, source_notes) as (
  values
    ('esfera','esfera_pro','esfera-pro','Pro','Clube Esfera',1000::bigint,43.90::numeric,'fixed',0::bigint,'{}'::jsonb,20000::bigint,20::numeric,400000::bigint,'https://www.esfera.com.vc/clube','Transferencia minima: 20.000; desconto em pontos: 20%; limite de compra: 400.000.'),
    ('esfera','esfera_master','esfera-master','Master','Clube Esfera',2500,106.90,'fixed',0,'{}',10000,40,500000,'https://www.esfera.com.vc/clube','Transferencia minima: 10.000; desconto em pontos: 40%; limite de compra: 500.000.'),
    ('esfera','esfera_vip','esfera-vip','VIP','Clube Esfera',5000,211.90,'fixed',0,'{}',5000,40,750000,'https://www.esfera.com.vc/clube','Transferencia minima: 5.000; desconto em pontos: 40%; limite de compra: 750.000.'),
    ('esfera','esfera_exclusive','esfera-exclusive','Exclusive','Clube Esfera',20000,799.90,'fixed',0,'{}',100000,50,1250000,'https://www.esfera.com.vc/clube','Transferencia minima informada pela fonte: 100.000; desconto em pontos: 50%; limite de compra: 1.250.000.'),
    ('smiles','smiles_mais_streaming_1000','smiles-mais-streaming-1000','Plano 1.000','Clube Smiles + Streaming',1000,75.90,'from',14500,
      '{"month":"first_month","requiresAdministrativeEligibility":true,"requiredFields":["joinedOn","contractedOffer"]}'::jsonb,
      null,null,null,'https://www.smiles.com.br/portal/clubemais',
      'Preco a partir de R$ 75,90. Inclui 1 streaming; troca mensal entre Disney+, HBO Max, Sky+ e PK Streaming.')
)
insert into public.loyalty_club_plans(
  program_id, stable_code, slug, name, product_family, monthly_points, qualifying_points,
  billing_period, points_validity_months, points_do_not_expire, informative_price,
  price_qualifier, currency, status, valid_from, source_url, source_verified_on,
  source_notes, joining_bonus_points, joining_bonus_conditions, minimum_transfer_points,
  purchase_points_discount_percent, monthly_purchase_points_limit, review_status,
  catalog_version, idempotency_key
)
select lp.id, s.stable_code, s.slug, s.plan_name, s.family, s.monthly_points, 0,
  'monthly', null, true, s.price, s.price_qualifier, 'BRL', 'active', date '2026-07-24',
  s.source_url, date '2026-07-24', s.source_notes, s.joining_bonus, s.bonus_conditions,
  s.minimum_transfer,s.purchase_discount,s.purchase_limit,
  case when s.price_qualifier = 'from' then 'needs_review' else 'reviewed' end,
  1, 'club_plan_catalog:' || s.slug || ':1'
from club_seed s
join public.loyalty_programs lp on lp.slug=s.program_slug
on conflict (idempotency_key) do nothing;

create unique index if not exists loyalty_club_benefit_seed_uidx
  on public.loyalty_club_plan_benefits(plan_id, benefit_type, title, valid_from);

insert into public.loyalty_club_plan_benefits(
  plan_id, benefit_type, title, description, numeric_value, unit, rule, valid_from, display_order
)
select p.id, b.benefit_type, b.title, b.description, b.numeric_value, b.unit, b.rule, date '2026-07-24', b.display_order
from public.loyalty_club_plans p
cross join lateral (
  values
    ('catalog'::text,'Pontos que nao expiram'::text,'Pontos mensais sem expiracao enquanto observadas as condicoes do plano.'::text,null::numeric,null::text,'{"pointsDoNotExpire":true}'::jsonb,10),
    ('discount','Desconto em produtos','Desconto de 10% em produtos mostrado na fonte.',10,'percent','{"scope":"products"}',20),
    ('discount','Desconto em viagens','Desconto de 5% em viagens mostrado na fonte.',5,'percent','{"scope":"travel"}',30)
) b(benefit_type,title,description,numeric_value,unit,rule,display_order)
where p.slug like 'esfera-%' and p.catalog_version=1
on conflict (plan_id, benefit_type, title, valid_from) do nothing;

insert into public.loyalty_club_plan_benefits(
  plan_id, benefit_type, title, description, numeric_value, unit, rule, valid_from, display_order
)
select p.id, 'streaming', 'Streaming incluido',
  'Uma opcao entre Disney+, HBO Max, Sky+ e PK Streaming, com troca uma vez por mes.',
  1, 'subscription',
  '{"options":["Disney+","HBO Max","Sky+","PK Streaming"],"changeFrequency":"monthly"}',
  date '2026-07-24', 20
from public.loyalty_club_plans p
where p.slug='smiles-mais-streaming-1000' and p.catalog_version=1
on conflict (plan_id, benefit_type, title, valid_from) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Seed dos 54 produtos de cartao
-- ---------------------------------------------------------------------------

with seed(card_slug, issuer, card_name, card_variant, brand, rewards_program, source_url,
  source_quality, calculation_enabled, requires_review, valid_until, review_notes) as (
  values
  ('santander-elite-pontos','Santander','Santander Elite Pontos',null,null,'Esfera','https://www.santander.com.br/banco/elite','official_conditional',true,false,null,'Santander Rewards de ate 50% nao e aplicado automaticamente.'),
  ('santander-unique-pontos','Santander','Santander Unique Pontos',null,'Visa/Mastercard','Esfera','https://www.santander.com.br/banco/unique-black','official_conditional',true,false,null,'Santander Rewards de ate 50% nao e aplicado automaticamente.'),
  ('santander-unlimited','Santander','Santander Unlimited',null,'Visa Infinite/Mastercard Black','Esfera','https://www.santander.com.br/cartao-credito-santander/unlimited','official_conditional',true,false,null,'Exige relacionamento Select ou Private.'),
  ('santander-gol-smiles-gold','Santander','GOL Smiles Santander','Gold','Visa','Smiles','https://www.santander.com.br/hotsite/cartaosmiles/','official_conditional',true,false,null,'Taxa depende de Clube Smiles ou categoria Diamante e de compras GOL.'),
  ('santander-gol-smiles-platinum','Santander','GOL Smiles Santander','Platinum','Visa','Smiles','https://www.santander.com.br/cartao-credito-santander/smiles-platinum','official_conditional',true,false,null,'Taxa depende de Clube Smiles ou categoria Diamante e de compras GOL.'),
  ('santander-gol-smiles-infinite','Santander','GOL Smiles Santander','Infinite','Visa','Smiles','https://www.santander.com.br/hotsite/cartaosmiles/','official_conditional',true,false,null,'Taxa depende de Clube Smiles ou categoria Diamante e de compras GOL.'),
  ('itau-personnalite-the-one','Itau','Personnalite The One',null,'Mastercard Black','Pontos Itau','https://www.itau.com.br/personnalite/cartoes/theone','official_exact',true,false,null,null),
  ('itau-personnalite-visa-infinite','Itau','Personnalite Visa Infinite',null,'Visa Infinite','Pontos Itau','https://www.itau.com.br/personnalite/cartoes/cartao-de-credito-visa-infinite','official_exact',true,false,null,null),
  ('itau-latam-pass-visa-infinite','Itau','LATAM Pass Itau','Visa Infinite','Visa Infinite','LATAM Pass','https://www.itau.com.br/personnalite/cartoes/cartao-de-credito-latam-pass-visa-infinite','official_conditional',true,false,null,'Acelerador opcional dobra a pontuacao mediante cobranca.'),
  ('itau-latam-pass-mastercard-black','Itau','LATAM Pass Itau','Mastercard Black','Mastercard Black','LATAM Pass','https://www.itau.com.br/cartoes/beneficios/programa-pontos-latam-pass-cartoes-itau','official_up_to',false,true,null,'Administrador deve confirmar taxas nacional e internacional do contrato.'),
  ('itau-azul-visa-infinite','Itau','Azul Itau','Visa Infinite','Visa Infinite','Azul Fidelidade','https://www.itau.com.br/cartoes/escolha/g/azul-visa-infinite/','official_exact',true,false,null,null),
  ('itau-azul-mastercard-skyline','Itau','Azul Itau','Mastercard Skyline','Mastercard','Azul Fidelidade','https://www.itau.com.br/cartoes/beneficios/programa-fidelidade-azul','official_exact',true,false,null,null),
  ('itau-azul-platinum','Itau','Azul Itau','Platinum',null,'Azul Fidelidade','https://www.itau.com.br/cartoes/beneficios/programa-fidelidade-azul','official_exact',true,false,null,null),
  ('itau-azul-gold','Itau','Azul Itau','Gold',null,'Azul Fidelidade','https://www.itau.com.br/cartoes/beneficios/programa-fidelidade-azul','official_exact',true,false,null,null),
  ('itau-azul-internacional','Itau','Azul Itau','Internacional',null,'Azul Fidelidade','https://www.itau.com.br/cartoes/beneficios/programa-fidelidade-azul','official_exact',true,false,null,null),
  ('itau-pao-de-acucar-visa-gold-pontos','Itau','Pao de Acucar Pontos','Visa Gold','Visa Gold','Pontos Itau','https://www.itau.com.br/cartoes/beneficios/programa-pontos-pao-de-acucar-cartoes-itau','official_exact',true,false,null,null),
  ('itau-pao-de-acucar-visa-platinum-pontos','Itau','Pao de Acucar Pontos','Visa Platinum','Visa Platinum','Pontos Itau','https://www.itau.com.br/cartoes/beneficios/programa-pontos-pao-de-acucar-cartoes-itau','official_exact',true,false,null,null),
  ('itau-pao-de-acucar-mastercard-black-pontos','Itau','Pao de Acucar Pontos','Mastercard Black','Mastercard Black','Pontos Itau','https://www.itau.com.br/cartoes/beneficios/programa-pontos-pao-de-acucar-cartoes-itau','official_exact',true,false,null,null),
  ('bradesco-aeternum-visa-infinite','Bradesco','Aeternum Visa Infinite',null,'Visa Infinite','Livelo','https://banco.bradesco/cartoes/aeternum/','official_exact',true,false,null,null),
  ('bradesco-amex-platinum-metal','Bradesco','The Platinum Card','Metal','American Express','Membership Rewards by Livelo','https://banco.bradesco/cartoes/hotsitefidelidade/','official_exact',true,false,null,null),
  ('bradesco-amex-platinum','Bradesco','The Platinum Card',null,'American Express','Membership Rewards by Livelo','https://banco.bradesco/cartoes/hotsitefidelidade/','official_exact',true,false,null,null),
  ('bradesco-amex-gold','Bradesco','American Express Gold Card',null,'American Express','Membership Rewards by Livelo','https://banco.bradesco/cartoes/hotsitefidelidade/','official_conditional',true,false,null,'Faixas de fatura e regra especifica de streaming.'),
  ('bradesco-prime-visa-infinite','Bradesco','Prime Visa Infinite',null,'Visa Infinite','Livelo','https://banco.bradesco/cartoes/hotsitefidelidade/','official_conditional',true,false,null,'Taxas maiores a partir de R$ 10.000.'),
  ('bb-altus-liv-visa-infinite','Banco do Brasil','Altus Liv Visa Infinite',null,'Visa Infinite','Livelo','https://bb.com.br/site/estilo/cartoes/altus-liv/','official_conditional',true,false,null,'Compras nacionais por faixa da fatura.'),
  ('bb-altus-private-visa-infinite','Banco do Brasil','Altus Visa Infinite Private',null,'Visa Infinite','Livelo','https://bb.com.br/site/private/cartoes/altus/','official_exact',true,false,null,null),
  ('c6-basico','C6 Bank','C6 cartao basico',null,'Mastercard','Atomos','https://www.c6bank.com.br/blog/passo-a-passo-para-consultar-saldo-e-extrato-do-programa-atomos','official_exact',true,false,null,null),
  ('c6-mastercard-black','C6 Bank','C6 Mastercard Black',null,'Mastercard Black','Atomos','https://www.c6bank.com.br/programa-de-pontos-atomos/','official_up_to',false,true,null,'Confirmar a condicao real do cliente.'),
  ('c6-carbon-mastercard-black','C6 Bank','C6 Carbon Mastercard Black',null,'Mastercard Black','Atomos','https://www.c6bank.com.br/cartao-c6-carbon-mastercard-black/','official_conditional',true,false,null,'Taxas acima de 2,5 dependem de pagamentos e investimentos elegiveis.'),
  ('caixa-icone-visa','CAIXA','CAIXA Icone Visa',null,'Visa','Pontos CAIXA','https://www.caixa.gov.br/c_a_r_t_a_o_c_r_e_d_i_t_o/Paginas/vantagens.aspx','official_conditional',true,true,date '2026-10-20','Revisar antes do fim da vigencia.'),
  ('caixa-elo-diners-club','CAIXA','CAIXA Elo Diners Club',null,'Elo Diners Club','Pontos CAIXA','https://www.caixa.gov.br/voce/cartoes/credito/elodiners/Paginas/default.aspx','official_exact',true,false,null,null),
  ('caixa-visa-infinite','CAIXA','CAIXA Visa Infinite',null,'Visa Infinite','Pontos CAIXA','https://www.caixa.gov.br/voce/cartoes/credito/infinite/Paginas/default.aspx','official_exact',true,false,null,null),
  ('caixa-elo-nanquim','CAIXA','CAIXA Elo Nanquim',null,'Elo Nanquim','Pontos CAIXA','https://www.caixa.gov.br/voce/cartoes/credito/nanquim/paginas/default.aspx','official_exact',true,false,null,null),
  ('caixa-elo-grafite','CAIXA','CAIXA Elo Grafite',null,'Elo Grafite','Pontos CAIXA','https://www.caixa.gov.br/voce/cartoes/credito/grafite/Paginas/default.aspx','official_exact',true,false,null,null),
  ('sicoob-classico','Sicoob','Sicoob Classico',null,null,'Coopera','https://www.sicoob.com.br/web/sicoob/noticias/-/asset_publisher/xAioIawpOI5S/content/id/307547791','official_exact',true,false,null,null),
  ('sicoob-gold','Sicoob','Sicoob Gold',null,null,'Coopera','https://www.sicoob.com.br/web/sicoob/noticias/-/asset_publisher/xAioIawpOI5S/content/id/307547791','official_exact',true,false,null,null),
  ('sicoob-platinum','Sicoob','Sicoob Platinum',null,null,'Coopera','https://www.sicoob.com.br/web/sicoob/noticias/-/asset_publisher/xAioIawpOI5S/content/id/307547791','official_exact',true,false,null,null),
  ('sicoob-black-infinite','Sicoob','Sicoob Black ou Infinite',null,null,'Coopera','https://www.sicoob.com.br/web/sicoob/noticias/-/asset_publisher/xAioIawpOI5S/content/id/307547791','official_exact',true,false,null,null),
  ('sicoob-black-infinite-merit','Sicoob','Sicoob Black ou Infinite Merit',null,null,'Coopera','https://www.sicoob.com.br/web/sicoob/noticias/-/asset_publisher/xAioIawpOI5S/content/id/307547791','official_exact',true,false,null,null),
  ('sicoob-visa-zenith','Sicoob','Sicoob Visa Zenith',null,'Visa','Coopera','https://www.sicoob.com.br/web/sicoob/visa-zenith','official_exact',true,false,null,null),
  ('sicredi-mastercard-platinum','Sicredi','Sicredi Mastercard Platinum',null,'Mastercard Platinum','Pontos Sicredi','https://www.sicredi.com.br/site/cartoes/portfolio-mastercard/','official_exact',true,false,null,null),
  ('sicredi-mastercard-black','Sicredi','Sicredi Mastercard Black',null,'Mastercard Black','Pontos Sicredi','https://www.sicredi.com.br/site/cartoes/cartao-sicredi-mastercard-black/','official_conditional',true,false,null,'Pontuacao por faixa de fatura.'),
  ('porto-bank-gold','Porto Bank','Porto Bank Gold',null,null,'PortoPlus','https://www.portoseguro.com.br/cartao-de-credito','official_up_to',false,true,null,'Administrador deve confirmar a taxa contratual.'),
  ('porto-bank-platinum','Porto Bank','Porto Bank Platinum',null,null,'PortoPlus','https://www.portoseguro.com.br/cartao-de-credito','official_up_to',false,true,null,'Administrador deve confirmar a taxa contratual.'),
  ('porto-bank-mastercard-black','Porto Bank','Porto Bank Mastercard Black',null,'Mastercard Black','PortoPlus','https://www.portoseguro.com.br/cartao-de-credito','official_up_to',false,true,null,'Administrador deve confirmar a taxa contratual.'),
  ('porto-bank-visa-infinite','Porto Bank','Porto Bank Visa Infinite',null,'Visa Infinite','PortoPlus','https://www.portoseguro.com.br/cartao-de-credito','official_up_to',false,true,null,'Administrador deve confirmar a taxa contratual.'),
  ('inter-gold','Inter','Inter Gold',null,'Mastercard','Inter Loop','https://inter.co/pra-voce/cartoes/programa-de-pontos/','official_conditional',true,false,null,'Debito automatico obrigatorio.'),
  ('inter-platinum','Inter','Inter Platinum',null,'Mastercard','Inter Loop','https://inter.co/pra-voce/cartoes/programa-de-pontos/','official_conditional',true,false,null,'Debito automatico obrigatorio.'),
  ('inter-prime','Inter','Inter Prime',null,'Mastercard','Inter Loop','https://inter.co/pra-voce/cartoes/programa-de-pontos/','official_conditional',true,false,null,'Debito automatico obrigatorio.'),
  ('inter-black','Inter','Inter Black',null,'Mastercard','Inter Loop','https://inter.co/pra-voce/cartoes/programa-de-pontos/','official_exact',true,false,null,null),
  ('inter-win','Inter','Inter Win',null,'Mastercard','Inter Loop','https://inter.co/pra-voce/cartoes/programa-de-pontos/','official_exact',true,false,null,null),
  ('xp-visa-infinite-pontos','XP','Cartao XP Visa Infinite',null,'Visa Infinite','Pontos XP','https://www.xp.com.br/','official_conditional',true,false,null,'Cliente deve escolher pontos, e nao Investback.'),
  ('nubank-ultravioleta-pontos','Nubank','Ultravioleta Mastercard Black',null,'Mastercard Black','Pontos Ultravioleta','https://nubank.com.br/ultravioleta/cartao-black/pontos-cashback','official_conditional',false,true,null,'Taxa base a partir de; confirmar modalidade ativa.'),
  ('unicred-visa-infinite-privilege','Unicred','Visa Infinite Privilege',null,'Visa Infinite','Unico','https://www.unicred.com.br/solucoes/privilege','official_exact',true,false,null,null),
  ('unicred-impar-visa-infinite','Unicred','Impar Visa Infinite',null,'Visa Infinite','Unico','https://www.unicred.com.br/copa2026','official_up_to',false,true,null,'Confirmar a taxa real do cliente.')
)
insert into public.card_catalog_versions(
  card_slug, version, issuer, card_name, card_variant, brand, rewards_program,
  source_url, source_checked_at, valid_from, valid_until, source_quality,
  calculation_enabled, requires_review, review_notes, idempotency_key
)
select card_slug, 1, issuer, card_name, card_variant, brand, rewards_program,
  source_url, date '2026-07-24', date '2026-07-24', valid_until, source_quality,
  calculation_enabled, requires_review, review_notes, 'card_catalog:' || card_slug || ':1'
from seed
on conflict (idempotency_key) do nothing;

-- Regras sao declaradas em JSON para tornar o seed legivel e reexecutavel.
with rule_seed as (
  select *
  from jsonb_to_recordset($rules$
  [
    {"slug":"santander-elite-pontos","scope":"default","unit":"points_per_usd","rate":1.5},
    {"slug":"santander-unique-pontos","scope":"domestic","unit":"points_per_usd","rate":2.2,"location":"domestic"},
    {"slug":"santander-unique-pontos","scope":"international","unit":"points_per_usd","rate":3,"location":"international"},
    {"slug":"santander-unlimited","scope":"select-domestic","unit":"points_per_usd","rate":3,"location":"domestic","relationship":"select"},
    {"slug":"santander-unlimited","scope":"select-international","unit":"points_per_usd","rate":3.6,"location":"international","relationship":"select"},
    {"slug":"santander-unlimited","scope":"private-domestic","unit":"points_per_usd","rate":3.5,"location":"domestic","relationship":"private"},
    {"slug":"santander-unlimited","scope":"private-international","unit":"points_per_usd","rate":4,"location":"international","relationship":"private"},

    {"slug":"santander-gol-smiles-gold","scope":"default","unit":"points_per_usd","rate":1.8},
    {"slug":"santander-gol-smiles-gold","scope":"gol","unit":"points_per_usd","rate":2.8,"merchant":"airline","match":"GOL"},
    {"slug":"santander-gol-smiles-gold","scope":"club","unit":"points_per_usd","rate":3,"club":"clube_smiles_or_diamante"},
    {"slug":"santander-gol-smiles-gold","scope":"club-gol","unit":"points_per_usd","rate":4,"merchant":"airline","match":"GOL","club":"clube_smiles_or_diamante"},
    {"slug":"santander-gol-smiles-platinum","scope":"default","unit":"points_per_usd","rate":2.3},
    {"slug":"santander-gol-smiles-platinum","scope":"gol","unit":"points_per_usd","rate":3.3,"merchant":"airline","match":"GOL"},
    {"slug":"santander-gol-smiles-platinum","scope":"club","unit":"points_per_usd","rate":3.5,"club":"clube_smiles_or_diamante"},
    {"slug":"santander-gol-smiles-platinum","scope":"club-gol","unit":"points_per_usd","rate":4.5,"merchant":"airline","match":"GOL","club":"clube_smiles_or_diamante"},
    {"slug":"santander-gol-smiles-infinite","scope":"default","unit":"points_per_usd","rate":3},
    {"slug":"santander-gol-smiles-infinite","scope":"gol","unit":"points_per_usd","rate":4,"merchant":"airline","match":"GOL"},
    {"slug":"santander-gol-smiles-infinite","scope":"club","unit":"points_per_usd","rate":5.5,"club":"clube_smiles_or_diamante"},
    {"slug":"santander-gol-smiles-infinite","scope":"club-gol","unit":"points_per_usd","rate":6.5,"merchant":"airline","match":"GOL","club":"clube_smiles_or_diamante"},

    {"slug":"itau-personnalite-the-one","scope":"domestic","unit":"points_per_usd","rate":3,"location":"domestic"},
    {"slug":"itau-personnalite-the-one","scope":"international","unit":"points_per_usd","rate":3.5,"location":"international"},
    {"slug":"itau-personnalite-visa-infinite","scope":"domestic","unit":"points_per_usd","rate":2,"location":"domestic"},
    {"slug":"itau-personnalite-visa-infinite","scope":"international","unit":"points_per_usd","rate":3,"location":"international"},
    {"slug":"itau-latam-pass-visa-infinite","scope":"domestic","unit":"points_per_usd","rate":2.5,"location":"domestic"},
    {"slug":"itau-latam-pass-visa-infinite","scope":"international","unit":"points_per_usd","rate":3.5,"location":"international"},
    {"slug":"itau-latam-pass-visa-infinite","scope":"accelerated-domestic","unit":"points_per_usd","rate":5,"location":"domestic","accelerator":true},
    {"slug":"itau-latam-pass-visa-infinite","scope":"accelerated-international","unit":"points_per_usd","rate":7,"location":"international","accelerator":true},
    {"slug":"itau-latam-pass-mastercard-black","scope":"up-to","unit":"points_per_usd","rate":7,"enabled":false,"review":true},
    {"slug":"itau-azul-visa-infinite","scope":"domestic","unit":"points_per_usd","rate":3,"location":"domestic"},
    {"slug":"itau-azul-visa-infinite","scope":"international","unit":"points_per_usd","rate":3.5,"location":"international"},
    {"slug":"itau-azul-mastercard-skyline","scope":"domestic","unit":"points_per_usd","rate":3,"location":"domestic"},
    {"slug":"itau-azul-mastercard-skyline","scope":"international","unit":"points_per_usd","rate":3.5,"location":"international"},
    {"slug":"itau-azul-platinum","scope":"default","unit":"points_per_usd","rate":2.2},
    {"slug":"itau-azul-platinum","scope":"azul","unit":"points_per_usd","rate":2.6,"merchant":"airline","match":"Azul"},
    {"slug":"itau-azul-gold","scope":"default","unit":"points_per_usd","rate":1.7},
    {"slug":"itau-azul-gold","scope":"azul","unit":"points_per_usd","rate":2,"merchant":"airline","match":"Azul"},
    {"slug":"itau-azul-internacional","scope":"default","unit":"points_per_usd","rate":1.4},
    {"slug":"itau-azul-internacional","scope":"azul","unit":"points_per_usd","rate":1.5,"merchant":"airline","match":"Azul"},
    {"slug":"itau-pao-de-acucar-visa-gold-pontos","scope":"default","unit":"points_per_usd","rate":1.5},
    {"slug":"itau-pao-de-acucar-visa-gold-pontos","scope":"pda-extra","unit":"points_per_usd","rate":3,"merchant":"program_partner","match":"Pao de Acucar|Extra"},
    {"slug":"itau-pao-de-acucar-visa-platinum-pontos","scope":"domestic","unit":"points_per_usd","rate":2,"location":"domestic"},
    {"slug":"itau-pao-de-acucar-visa-platinum-pontos","scope":"international","unit":"points_per_usd","rate":3,"location":"international"},
    {"slug":"itau-pao-de-acucar-visa-platinum-pontos","scope":"pda-extra","unit":"points_per_usd","rate":5,"merchant":"program_partner","match":"Pao de Acucar|Extra"},
    {"slug":"itau-pao-de-acucar-mastercard-black-pontos","scope":"domestic","unit":"points_per_usd","rate":2,"location":"domestic"},
    {"slug":"itau-pao-de-acucar-mastercard-black-pontos","scope":"international","unit":"points_per_usd","rate":3,"location":"international"},
    {"slug":"itau-pao-de-acucar-mastercard-black-pontos","scope":"pda-extra","unit":"points_per_usd","rate":5,"merchant":"program_partner","match":"Pao de Acucar|Extra"},

    {"slug":"bradesco-aeternum-visa-infinite","scope":"default","unit":"points_per_usd","rate":4},
    {"slug":"bradesco-amex-platinum-metal","scope":"domestic","unit":"points_per_usd","rate":2.2,"location":"domestic"},
    {"slug":"bradesco-amex-platinum-metal","scope":"international","unit":"points_per_usd","rate":3,"location":"international"},
    {"slug":"bradesco-amex-platinum","scope":"domestic","unit":"points_per_usd","rate":2.2,"location":"domestic"},
    {"slug":"bradesco-amex-platinum","scope":"international","unit":"points_per_usd","rate":3,"location":"international"},
    {"slug":"bradesco-amex-gold","scope":"low-domestic","unit":"points_per_usd","rate":1.2,"location":"domestic","max":2499.99},
    {"slug":"bradesco-amex-gold","scope":"low-international","unit":"points_per_usd","rate":1.5,"location":"international","max":2499.99},
    {"slug":"bradesco-amex-gold","scope":"high-domestic","unit":"points_per_usd","rate":1.5,"location":"domestic","min":2500},
    {"slug":"bradesco-amex-gold","scope":"high-international","unit":"points_per_usd","rate":1.8,"location":"international","min":2500},
    {"slug":"bradesco-amex-gold","scope":"streaming","unit":"points_per_usd","rate":2,"merchant":"streaming"},
    {"slug":"bradesco-prime-visa-infinite","scope":"default","unit":"points_per_usd","rate":2},
    {"slug":"bradesco-prime-visa-infinite","scope":"high-domestic","unit":"points_per_usd","rate":2.2,"location":"domestic","min":10000},
    {"slug":"bradesco-prime-visa-infinite","scope":"high-international","unit":"points_per_usd","rate":3,"location":"international","min":10000},
    {"slug":"bb-altus-liv-visa-infinite","scope":"domestic-low","unit":"points_per_usd","rate":3,"location":"domestic","max":15000},
    {"slug":"bb-altus-liv-visa-infinite","scope":"domestic-mid","unit":"points_per_usd","rate":3.5,"location":"domestic","min":15000.01,"max":25000},
    {"slug":"bb-altus-liv-visa-infinite","scope":"domestic-high","unit":"points_per_usd","rate":4,"location":"domestic","min":25000.01},
    {"slug":"bb-altus-liv-visa-infinite","scope":"international","unit":"points_per_usd","rate":4,"location":"international"},
    {"slug":"bb-altus-private-visa-infinite","scope":"domestic","unit":"points_per_usd","rate":4,"location":"domestic"},
    {"slug":"bb-altus-private-visa-infinite","scope":"international","unit":"points_per_usd","rate":5,"location":"international"},

    {"slug":"c6-basico","scope":"default","unit":"points_per_brl","rate":0.05},
    {"slug":"c6-mastercard-black","scope":"up-to","unit":"points_per_usd","rate":2.5,"enabled":false,"review":true},
    {"slug":"c6-carbon-mastercard-black","scope":"default","unit":"points_per_usd","rate":2.5},
    {"slug":"caixa-icone-visa","scope":"domestic","unit":"points_per_usd","rate":5,"location":"domestic","until":"2026-10-20"},
    {"slug":"caixa-icone-visa","scope":"international","unit":"points_per_usd","rate":6,"location":"international","until":"2026-10-20"},
    {"slug":"caixa-elo-diners-club","scope":"domestic","unit":"points_per_usd","rate":3,"location":"domestic"},
    {"slug":"caixa-elo-diners-club","scope":"international","unit":"points_per_usd","rate":4,"location":"international"},
    {"slug":"caixa-visa-infinite","scope":"domestic","unit":"points_per_usd","rate":2.3,"location":"domestic"},
    {"slug":"caixa-visa-infinite","scope":"international","unit":"points_per_usd","rate":3.2,"location":"international"},
    {"slug":"caixa-elo-nanquim","scope":"domestic","unit":"points_per_usd","rate":2.3,"location":"domestic"},
    {"slug":"caixa-elo-nanquim","scope":"international","unit":"points_per_usd","rate":3.2,"location":"international"},
    {"slug":"caixa-elo-grafite","scope":"default","unit":"points_per_usd","rate":1.6},

    {"slug":"sicoob-classico","scope":"default","unit":"points_per_usd","rate":1},
    {"slug":"sicoob-gold","scope":"default","unit":"points_per_usd","rate":1.2},
    {"slug":"sicoob-platinum","scope":"default","unit":"points_per_usd","rate":1.5},
    {"slug":"sicoob-black-infinite","scope":"default","unit":"points_per_usd","rate":2.2},
    {"slug":"sicoob-black-infinite-merit","scope":"default","unit":"points_per_usd","rate":2.5},
    {"slug":"sicoob-visa-zenith","scope":"default","unit":"points_per_usd","rate":4},
    {"slug":"sicredi-mastercard-platinum","scope":"default","unit":"points_per_usd","rate":1.5},
    {"slug":"sicredi-mastercard-black","scope":"low","unit":"points_per_usd","rate":2,"max":10000},
    {"slug":"sicredi-mastercard-black","scope":"mid","unit":"points_per_usd","rate":2.3,"min":10000.01,"max":20000},
    {"slug":"sicredi-mastercard-black","scope":"high","unit":"points_per_usd","rate":2.5,"min":20000.01},

    {"slug":"porto-bank-gold","scope":"up-to","unit":"points_per_usd","rate":1,"enabled":false,"review":true},
    {"slug":"porto-bank-platinum","scope":"up-to","unit":"points_per_usd","rate":1.5,"enabled":false,"review":true},
    {"slug":"porto-bank-mastercard-black","scope":"up-to","unit":"points_per_usd","rate":3.5,"enabled":false,"review":true},
    {"slug":"porto-bank-visa-infinite","scope":"up-to","unit":"points_per_usd","rate":3.5,"enabled":false,"review":true},
    {"slug":"inter-gold","scope":"default","unit":"one_point_per_brl_amount","denominator":10,"debit":true},
    {"slug":"inter-platinum","scope":"default","unit":"one_point_per_brl_amount","denominator":5,"debit":true},
    {"slug":"inter-prime","scope":"default","unit":"one_point_per_brl_amount","denominator":2.5,"debit":true},
    {"slug":"inter-black","scope":"default","unit":"one_point_per_brl_amount","denominator":2.5},
    {"slug":"inter-win","scope":"default","unit":"one_point_per_brl_amount","denominator":2},
    {"slug":"xp-visa-infinite-pontos","scope":"points","unit":"points_per_usd","rate":2.2,"reward":"points"},
    {"slug":"nubank-ultravioleta-pontos","scope":"base-from","unit":"points_per_usd","rate":2.2,"reward":"points","enabled":false,"review":true},
    {"slug":"nubank-ultravioleta-pontos","scope":"nu-viagens","unit":"points_per_usd","rate":9,"merchant":"program_partner","match":"Nu Viagens","reward":"points"},
    {"slug":"unicred-visa-infinite-privilege","scope":"domestic","unit":"points_per_usd","rate":5,"location":"domestic"},
    {"slug":"unicred-visa-infinite-privilege","scope":"international","unit":"points_per_usd","rate":7,"location":"international"},
    {"slug":"unicred-impar-visa-infinite","scope":"up-to","unit":"points_per_usd","rate":4.5,"enabled":false,"review":true}
  ]
  $rules$::jsonb) as r(
    slug text, scope text, unit text, rate numeric, denominator numeric,
    location text, merchant text, match text, min numeric, max numeric,
    relationship text, club text, accelerator boolean, reward text, debit boolean,
    enabled boolean, review boolean, until date
  )
)
insert into public.card_catalog_rules(
  catalog_version_id, rule_scope, unit_type, rate, denominator, spend_currency,
  spend_location, merchant_scope, merchant_match, minimum_statement_amount,
  maximum_statement_amount, relationship_condition, club_condition,
  accelerator_condition, reward_mode_condition, automatic_debit_condition,
  priority, valid_from, valid_until, source_url, source_checked_at, source_quality,
  calculation_enabled, requires_review, version, idempotency_key
)
select c.id, r.scope, r.unit, r.rate, r.denominator, 'BRL',
  coalesce(r.location,'any'), coalesce(r.merchant,'any'), r.match, r.min, r.max,
  r.relationship, r.club, r.accelerator, r.reward, r.debit,
  100
    + case when r.merchant is not null and r.merchant <> 'any' then 500 else 0 end
    + case when r.location = 'international' then 400 when r.location='domestic' then 50 else 0 end
    + case when r.min is not null or r.max is not null then 300 else 0 end
    + case when r.relationship is not null or r.club is not null or r.accelerator is not null or r.reward is not null or r.debit is not null then 200 else 0 end,
  date '2026-07-24', r.until, c.source_url, date '2026-07-24', c.source_quality,
  coalesce(r.enabled,true) and c.calculation_enabled, coalesce(r.review,false),
  1, 'card_rule:' || r.slug || ':' || r.scope || ':1'
from rule_seed r
join public.card_catalog_versions c on c.card_slug=r.slug and c.version=1
on conflict (idempotency_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Backend: consultas, vinculo, versionamento e calculo
-- ---------------------------------------------------------------------------

create or replace function public.get_card_catalog(
  p_issuer text default null,
  p_program text default null,
  p_unit_type text default null,
  p_quality text default null,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Acesso nao autorizado' using errcode='42501';
  end if;
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'catalogVersionId',c.id,'cardSlug',c.card_slug,'version',c.version,
        'issuer',c.issuer,'cardName',c.card_name,'cardVariant',c.card_variant,
        'brand',c.brand,'rewardsProgram',c.rewards_program,'sourceUrl',c.source_url,
        'sourceCheckedAt',c.source_checked_at,'validFrom',c.valid_from,'validUntil',c.valid_until,
        'sourceQuality',c.source_quality,'calculationEnabled',c.calculation_enabled,
        'requiresReview',c.requires_review or c.source_checked_at < current_date-90
          or (c.valid_until is not null and c.valid_until <= current_date+30),
        'reviewNotes',c.review_notes,'active',c.active,
        'rules',coalesce((select jsonb_agg(jsonb_build_object(
          'ruleId',r.id,'scope',r.rule_scope,'unitType',r.unit_type,'rate',r.rate,
          'denominator',r.denominator,'spendLocation',r.spend_location,
          'merchantScope',r.merchant_scope,'merchantMatch',r.merchant_match,
          'minimumStatementAmount',r.minimum_statement_amount,
          'maximumStatementAmount',r.maximum_statement_amount,
          'relationshipCondition',r.relationship_condition,'clubCondition',r.club_condition,
          'acceleratorCondition',r.accelerator_condition,
          'rewardModeCondition',r.reward_mode_condition,
          'automaticDebitCondition',r.automatic_debit_condition,
          'calculationEnabled',r.calculation_enabled,'requiresReview',r.requires_review,
          'priority',r.priority,'validFrom',r.valid_from,'validUntil',r.valid_until
        ) order by r.priority desc,r.rule_scope) from public.card_catalog_rules r where r.catalog_version_id=c.id),'[]'::jsonb)
      ) order by c.issuer,c.card_name,c.card_variant,c.version desc)
      from public.card_catalog_versions c
      where (p_include_inactive or c.active)
        and (p_issuer is null or c.issuer=p_issuer)
        and (p_program is null or c.rewards_program=p_program)
        and (p_quality is null or c.source_quality=p_quality)
        and (p_unit_type is null or exists(select 1 from public.card_catalog_rules r where r.catalog_version_id=c.id and r.unit_type=p_unit_type))
    ),'[]'::jsonb),
    'filters',jsonb_build_object(
      'issuers',coalesce((select jsonb_agg(x order by x) from (select distinct issuer x from public.card_catalog_versions) s),'[]'::jsonb),
      'programs',coalesce((select jsonb_agg(x order by x) from (select distinct rewards_program x from public.card_catalog_versions) s),'[]'::jsonb)
    )
  );
end $$;

create or replace function public.associate_catalog_card(
  p_client_id uuid,
  p_catalog_version_id uuid,
  p_started_on date,
  p_last_four text default null,
  p_ownership text default 'holder',
  p_reward_mode text default 'points',
  p_relationship_condition text default null,
  p_club_condition text default null,
  p_elite_category_condition text default null,
  p_accelerator_active boolean default false,
  p_automatic_debit_active boolean default false,
  p_custom_rate numeric default null,
  p_custom_unit_type text default null,
  p_custom_rate_justification text default null,
  p_custom_rate_source text default null,
  p_notes text default null,
  p_ended_on date default null
)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare
  actor_id uuid:=auth.uid();
  catalog public.card_catalog_versions%rowtype;
  card public.credit_cards%rowtype;
  program_id uuid;
  key_value text;
begin
  if actor_id is null or not public.can_write_client_data() then
    raise exception 'Voce nao possui permissao para vincular cartoes.' using errcode='42501';
  end if;
  if not exists(select 1 from public.clients where id=p_client_id) then
    raise exception 'Cliente nao encontrado.' using errcode='P0002';
  end if;
  select * into catalog from public.card_catalog_versions where id=p_catalog_version_id and active;
  if catalog.id is null then raise exception 'Versao de catalogo nao encontrada ou inativa.' using errcode='P0002'; end if;
  if p_last_four is not null and p_last_four !~ '^[0-9]{4}$' then
    raise exception 'Informe somente os quatro ultimos digitos.' using errcode='22023';
  end if;
  if p_custom_rate is not null and (
    length(trim(coalesce(p_custom_rate_justification,''))) < 10
    or length(trim(coalesce(p_custom_rate_source,''))) < 5
    or p_custom_unit_type not in ('points_per_usd','points_per_brl','one_point_per_brl_amount')
  ) then
    raise exception 'Taxa personalizada exige unidade, justificativa e fonte.' using errcode='22023';
  end if;
  if not catalog.calculation_enabled and p_custom_rate is null then
    -- Vinculo e permitido, mas o calculo continuara bloqueado ate a confirmacao.
    null;
  end if;
  select id into program_id from public.loyalty_programs
  where lower(name)=lower(catalog.rewards_program) or lower(slug)=lower(replace(catalog.rewards_program,' ','_'))
  limit 1;
  key_value := 'client_card:' || p_client_id || ':' || catalog.card_slug || ':' || p_started_on;

  insert into public.credit_cards(
    client_id,issuer,product_name,brand,last_four,linked_program_id,active,created_by,
    catalog_version_id,started_on,ended_on,ownership,reward_mode,relationship_condition,
    club_condition,elite_category_condition,accelerator_active,automatic_debit_active,
    custom_rate,custom_unit_type,custom_rate_justification,custom_rate_source,
    association_key,updated_by
  ) values(
    p_client_id,catalog.issuer,catalog.card_name,coalesce(catalog.brand,catalog.card_variant),
    p_last_four,program_id,p_ended_on is null,actor_id,catalog.id,p_started_on,p_ended_on,
    p_ownership,p_reward_mode,nullif(trim(coalesce(p_relationship_condition,'')),''),
    nullif(trim(coalesce(p_club_condition,'')),''),nullif(trim(coalesce(p_elite_category_condition,'')),''),
    coalesce(p_accelerator_active,false),coalesce(p_automatic_debit_active,false),
    p_custom_rate,p_custom_unit_type,nullif(trim(coalesce(p_custom_rate_justification,'')),''),
    nullif(trim(coalesce(p_custom_rate_source,'')),''),key_value,actor_id
  )
  on conflict (association_key) where association_key is not null do update set
    last_four=excluded.last_four,ended_on=excluded.ended_on,active=excluded.active,
    ownership=excluded.ownership,reward_mode=excluded.reward_mode,
    relationship_condition=excluded.relationship_condition,club_condition=excluded.club_condition,
    elite_category_condition=excluded.elite_category_condition,
    accelerator_active=excluded.accelerator_active,
    automatic_debit_active=excluded.automatic_debit_active,
    custom_rate=excluded.custom_rate,custom_unit_type=excluded.custom_unit_type,
    custom_rate_justification=excluded.custom_rate_justification,
    custom_rate_source=excluded.custom_rate_source,updated_by=actor_id,updated_at=now()
  returning * into card;

  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data)
  values(actor_id,p_client_id,'associate_catalog_card','credit_cards',card.id::text,
    jsonb_build_object('catalogVersionId',catalog.id,'cardSlug',catalog.card_slug,
      'startedOn',p_started_on,'lastFour',p_last_four,'customRate',p_custom_rate,
      'customRateSource',p_custom_rate_source,'reason',p_notes,'version',catalog.version));
  return jsonb_build_object('cardId',card.id,'associationKey',key_value,
    'calculationReady',catalog.calculation_enabled or p_custom_rate is not null);
end $$;

create or replace function public.calculate_client_card_points(
  p_card_id uuid,
  p_statement_month date,
  p_spend_segments jsonb,
  p_fx_rate numeric default null
)
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
  card public.credit_cards%rowtype;
  catalog public.card_catalog_versions%rowtype;
  segment jsonb;
  selected_rule public.card_catalog_rules%rowtype;
  amount_value numeric;
  total_value numeric:=0;
  segment_points numeric;
  total_points numeric:=0;
  applications jsonb:='[]'::jsonb;
  month_value date:=public.first_day(p_statement_month);
  location_value text;
  merchant_scope_value text;
  merchant_name_value text;
  unit_value text;
  rate_value numeric;
  denominator_value numeric;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  if jsonb_typeof(p_spend_segments)<>'array' or jsonb_array_length(p_spend_segments)=0 then
    raise exception 'Informe ao menos um segmento de gasto.' using errcode='22023';
  end if;
  select * into card from public.credit_cards where id=p_card_id and active;
  if card.id is null then raise exception 'Cartao nao encontrado ou inativo.' using errcode='P0002'; end if;
  select * into catalog from public.card_catalog_versions where id=card.catalog_version_id;
  if catalog.id is null then raise exception 'Cartao sem versao do catalogo.' using errcode='P0002'; end if;
  if month_value < catalog.valid_from or (catalog.valid_until is not null and month_value>catalog.valid_until) then
    raise exception 'A versao do cartao nao esta vigente para esta fatura.' using errcode='22023';
  end if;
  if not catalog.calculation_enabled and card.custom_rate is null then
    raise exception 'A fonte informa ate/a partir de. Confirme a taxa contratual real do cliente antes de calcular.' using errcode='22023';
  end if;

  select coalesce(sum((x->>'amountBrl')::numeric),0) into total_value
  from jsonb_array_elements(p_spend_segments) x;
  if total_value<=0 then raise exception 'O gasto elegivel deve ser positivo.' using errcode='22023'; end if;

  for segment in select value from jsonb_array_elements(p_spend_segments)
  loop
    amount_value:=(segment->>'amountBrl')::numeric;
    location_value:=coalesce(nullif(segment->>'spendLocation',''),'domestic');
    merchant_scope_value:=coalesce(nullif(segment->>'merchantScope',''),'any');
    merchant_name_value:=coalesce(segment->>'merchantName','');
    if amount_value<=0 then raise exception 'Segmento de gasto invalido.' using errcode='22023'; end if;

    if card.custom_rate is not null then
      selected_rule.id:=null;
      selected_rule.rule_scope:='client-custom-confirmed';
      unit_value:=card.custom_unit_type;
      if unit_value='one_point_per_brl_amount' then
        rate_value:=null; denominator_value:=card.custom_rate;
      else
        rate_value:=card.custom_rate; denominator_value:=null;
      end if;
    else
      select r.* into selected_rule
      from public.card_catalog_rules r
      where r.catalog_version_id=catalog.id and r.calculation_enabled
        and r.valid_from<=month_value and (r.valid_until is null or r.valid_until>=month_value)
        and r.spend_location in ('any',location_value)
        and r.merchant_scope in ('any',merchant_scope_value)
        and (r.merchant_match is null or merchant_name_value ~* r.merchant_match)
        and (r.minimum_statement_amount is null or total_value>=r.minimum_statement_amount)
        and (r.maximum_statement_amount is null or total_value<=r.maximum_statement_amount)
        and (r.relationship_condition is null or lower(r.relationship_condition)=lower(coalesce(card.relationship_condition,'')))
        and (r.club_condition is null or (
          r.club_condition=card.club_condition
          or (r.club_condition='clube_smiles_or_diamante' and (
            lower(coalesce(card.club_condition,'')) in ('clube_smiles','clube smiles','clube_smiles_or_diamante')
            or lower(coalesce(card.elite_category_condition,''))='diamante'
          ))
        ))
        and (r.elite_category_condition is null or lower(r.elite_category_condition)=lower(coalesce(card.elite_category_condition,'')))
        and (r.accelerator_condition is null or r.accelerator_condition=card.accelerator_active)
        and (r.reward_mode_condition is null or r.reward_mode_condition=card.reward_mode)
        and (r.automatic_debit_condition is null or r.automatic_debit_condition=card.automatic_debit_active)
      order by r.priority desc,r.id
      limit 1;
      if selected_rule.id is null then
        raise exception 'Nenhuma regra confirmada atende ao segmento %. Revise as condicoes do cliente.',segment using errcode='22023';
      end if;
      unit_value:=selected_rule.unit_type;
      rate_value:=selected_rule.rate;
      denominator_value:=selected_rule.denominator;
    end if;

    if unit_value='points_per_usd' then
      if p_fx_rate is null or p_fx_rate<=0 then raise exception 'Informe a cotacao usada na fatura.' using errcode='22023'; end if;
      segment_points:=amount_value/p_fx_rate*rate_value;
    elsif unit_value='points_per_brl' then
      segment_points:=amount_value*rate_value;
    else
      segment_points:=amount_value/denominator_value;
    end if;
    segment_points:=round(segment_points,4);
    total_points:=total_points+segment_points;
    applications:=applications || jsonb_build_array(jsonb_build_object(
      'segment',segment,'ruleId',selected_rule.id,'ruleScope',selected_rule.rule_scope,
      'unitType',unit_value,'rate',rate_value,'denominator',denominator_value,
      'eligibleAmountBrl',amount_value,'fxRate',case when unit_value='points_per_usd' then p_fx_rate else null end,
      'calculatedPoints',segment_points,'catalogVersionId',catalog.id,'catalogVersion',catalog.version
    ));
  end loop;
  return jsonb_build_object('cardId',card.id,'catalogVersionId',catalog.id,
    'catalogVersion',catalog.version,'statementMonth',month_value,'eligibleSpend',total_value,
    'expectedPoints',round(total_points,4),'fxRate',p_fx_rate,'applications',applications,
    'calculationVersion','card-points-v2');
end $$;

create or replace function public.record_catalog_card_statement(
  p_card_id uuid,
  p_statement_month date,
  p_spend_segments jsonb,
  p_total_spend numeric,
  p_received_points numeric default 0,
  p_fx_rate numeric default null,
  p_fx_rate_date date default null,
  p_fx_source text default null,
  p_notes text default null,
  p_operation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare
  actor_id uuid:=auth.uid();
  calculation jsonb;
  card public.credit_cards%rowtype;
  stmt public.card_statements%rowtype;
  app jsonb;
  segment_row public.card_statement_spend_segments%rowtype;
  eligible numeric;
  expected numeric;
  legacy_basis public.earning_basis;
  legacy_rate numeric;
  legacy_fx numeric;
  status_value public.statement_status;
  segment_index integer:=0;
begin
  if actor_id is null or not public.can_write_client_data() then
    raise exception 'Voce nao possui permissao para faturas.' using errcode='42501';
  end if;
  calculation:=public.calculate_client_card_points(p_card_id,p_statement_month,p_spend_segments,p_fx_rate);
  eligible:=(calculation->>'eligibleSpend')::numeric;
  expected:=(calculation->>'expectedPoints')::numeric;
  if p_total_spend<eligible or p_received_points<0 then raise exception 'Valores da fatura invalidos.' using errcode='22023'; end if;
  select * into card from public.credit_cards where id=p_card_id;
  select case when x->>'unitType'='points_per_usd' then 'usd'::public.earning_basis else 'brl'::public.earning_basis end,
    case when x->>'unitType'='one_point_per_brl_amount' then 1/(x->>'denominator')::numeric else (x->>'rate')::numeric end
  into legacy_basis,legacy_rate
  from jsonb_array_elements(calculation->'applications') x limit 1;
  legacy_fx:=case when legacy_basis='usd' then p_fx_rate else null end;
  status_value:=case when coalesce(p_received_points,0)=0 then 'calculated'::public.statement_status
    when round(p_received_points,4)=round(expected,4) then 'reconciled'::public.statement_status
    else 'divergent'::public.statement_status end;

  insert into public.card_statements(
    card_id,statement_month,total_spend,eligible_spend,earning_basis,earning_rate,fx_rate,
    received_points,status,formula_version,notes,created_by,currency,earning_rule_snapshot,
    fx_rate_date,fx_source,operation_id,calculated_expected_points,calculation_version,
    calculation_details,catalog_version_id,calculated_at
  ) values(
    p_card_id,public.first_day(p_statement_month),round(p_total_spend,2),round(eligible,2),
    legacy_basis,legacy_rate,legacy_fx,round(coalesce(p_received_points,0),2),status_value,
    '2.0.0',nullif(trim(coalesce(p_notes,'')),''),actor_id,'BRL',calculation,
    p_fx_rate_date,nullif(trim(coalesce(p_fx_source,'')),''),p_operation_id,
    expected,'card-points-v2',calculation,card.catalog_version_id,now()
  )
  on conflict(card_id,statement_month) do update set
    total_spend=excluded.total_spend,eligible_spend=excluded.eligible_spend,
    earning_basis=excluded.earning_basis,earning_rate=excluded.earning_rate,fx_rate=excluded.fx_rate,
    received_points=excluded.received_points,status=excluded.status,notes=excluded.notes,
    earning_rule_snapshot=excluded.earning_rule_snapshot,fx_rate_date=excluded.fx_rate_date,
    fx_source=excluded.fx_source,calculated_expected_points=excluded.calculated_expected_points,
    calculation_version=excluded.calculation_version,calculation_details=excluded.calculation_details,
    catalog_version_id=excluded.catalog_version_id,calculated_at=excluded.calculated_at,updated_at=now()
  returning * into stmt;

  delete from public.card_statement_rule_applications where statement_id=stmt.id;
  delete from public.card_statement_spend_segments where statement_id=stmt.id;
  for app in select value from jsonb_array_elements(calculation->'applications')
  loop
    segment_index:=segment_index+1;
    insert into public.card_statement_spend_segments(
      statement_id,segment_order,amount_brl,spend_location,merchant_scope,merchant_name
    ) values(
      stmt.id,segment_index,(app->>'eligibleAmountBrl')::numeric,
      coalesce(app#>>'{segment,spendLocation}','domestic'),
      coalesce(app#>>'{segment,merchantScope}','any'),
      nullif(app#>>'{segment,merchantName}','')
    ) returning * into segment_row;
    insert into public.card_statement_rule_applications(
      statement_id,segment_id,rule_id,rule_snapshot,eligible_amount_brl,fx_rate,calculated_points
    ) values(
      stmt.id,segment_row.id,nullif(app->>'ruleId','')::uuid,app,
      (app->>'eligibleAmountBrl')::numeric,nullif(app->>'fxRate','')::numeric,
      (app->>'calculatedPoints')::numeric
    );
  end loop;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data)
  values(actor_id,card.client_id,'record_catalog_card_statement','card_statements',stmt.id::text,
    jsonb_build_object('expectedPoints',expected,'receivedPoints',p_received_points,
      'catalogVersionId',card.catalog_version_id,'calculationVersion','card-points-v2'));
  return jsonb_build_object('statementId',stmt.id,'expectedPoints',expected,
    'receivedPoints',stmt.received_points,'difference',round(stmt.received_points-expected,4),
    'status',stmt.status,'calculation',calculation);
end $$;

create or replace function public.duplicate_card_catalog_version(
  p_catalog_version_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); old public.card_catalog_versions%rowtype;
  new_row public.card_catalog_versions%rowtype; new_version integer; r public.card_catalog_rules%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Informe o motivo da nova versao.' using errcode='22023'; end if;
  select * into old from public.card_catalog_versions where id=p_catalog_version_id;
  if old.id is null then raise exception 'Versao nao encontrada.' using errcode='P0002'; end if;
  select coalesce(max(version),0)+1 into new_version from public.card_catalog_versions where card_slug=old.card_slug;
  insert into public.card_catalog_versions(card_slug,version,issuer,card_name,card_variant,brand,rewards_program,
    source_url,source_checked_at,valid_from,valid_until,source_quality,calculation_enabled,requires_review,
    review_notes,idempotency_key,created_by,updated_by)
  values(old.card_slug,new_version,old.issuer,old.card_name,old.card_variant,old.brand,old.rewards_program,
    old.source_url,current_date,current_date,null,old.source_quality,false,true,
    'Nova versao pendente de revisao. '||trim(p_reason),
    'card_catalog:'||old.card_slug||':'||new_version,actor_id,actor_id)
  returning * into new_row;
  for r in select * from public.card_catalog_rules where catalog_version_id=old.id loop
    insert into public.card_catalog_rules(catalog_version_id,rule_scope,unit_type,rate,denominator,
      spend_currency,spend_location,merchant_scope,merchant_match,minimum_statement_amount,
      maximum_statement_amount,relationship_condition,club_condition,elite_category_condition,
      accelerator_condition,reward_mode_condition,automatic_debit_condition,is_additive,priority,
      valid_from,valid_until,source_url,source_checked_at,source_quality,calculation_enabled,
      requires_review,version,idempotency_key,conditions,created_by)
    values(new_row.id,r.rule_scope,r.unit_type,r.rate,r.denominator,r.spend_currency,r.spend_location,
      r.merchant_scope,r.merchant_match,r.minimum_statement_amount,r.maximum_statement_amount,
      r.relationship_condition,r.club_condition,r.elite_category_condition,r.accelerator_condition,
      r.reward_mode_condition,r.automatic_debit_condition,r.is_additive,r.priority,current_date,null,
      r.source_url,current_date,r.source_quality,false,true,new_version,
      'card_rule:'||old.card_slug||':'||r.rule_scope||':'||new_version,r.conditions,actor_id);
  end loop;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,old_data,new_data)
  values(actor_id,'duplicate_card_catalog_version','card_catalog_versions',new_row.id::text,
    to_jsonb(old),to_jsonb(new_row)||jsonb_build_object('reason',p_reason));
  return jsonb_build_object('catalogVersionId',new_row.id,'version',new_version);
end $$;

create or replace function public.set_card_catalog_active(
  p_catalog_version_id uuid,p_active boolean,p_reason text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); old public.card_catalog_versions%rowtype; updated public.card_catalog_versions%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Informe o motivo.' using errcode='22023'; end if;
  select * into old from public.card_catalog_versions where id=p_catalog_version_id for update;
  if old.id is null then raise exception 'Versao nao encontrada.' using errcode='P0002'; end if;
  update public.card_catalog_versions set active=p_active,updated_by=actor_id,updated_at=now()
  where id=old.id returning * into updated;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,old_data,new_data)
  values(actor_id,'set_card_catalog_active','card_catalog_versions',old.id::text,to_jsonb(old),
    to_jsonb(updated)||jsonb_build_object('reason',p_reason));
  return jsonb_build_object('catalogVersionId',old.id,'active',p_active);
end $$;

create or replace function public.update_card_catalog_rule(
  p_rule_id uuid,p_rate numeric default null,p_denominator numeric default null,
  p_calculation_enabled boolean default null,p_requires_review boolean default null,
  p_valid_until date default null,p_source_url text default null,
  p_source_checked_at date default null,p_reason text default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); old public.card_catalog_rules%rowtype; updated public.card_catalog_rules%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Informe o motivo da alteracao.' using errcode='22023'; end if;
  select * into old from public.card_catalog_rules where id=p_rule_id for update;
  if old.id is null then raise exception 'Regra nao encontrada.' using errcode='P0002'; end if;
  if old.source_quality='official_up_to' and coalesce(p_calculation_enabled,old.calculation_enabled) then
    raise exception 'Regra official_up_to deve permanecer bloqueada; confirme a taxa no vinculo do cliente.' using errcode='22023';
  end if;
  update public.card_catalog_rules set
    rate=case when unit_type='one_point_per_brl_amount' then null else coalesce(p_rate,rate) end,
    denominator=case when unit_type='one_point_per_brl_amount' then coalesce(p_denominator,denominator) else null end,
    calculation_enabled=coalesce(p_calculation_enabled,calculation_enabled),
    requires_review=coalesce(p_requires_review,requires_review),
    valid_until=p_valid_until,source_url=coalesce(nullif(trim(coalesce(p_source_url,'')),''),source_url),
    source_checked_at=coalesce(p_source_checked_at,source_checked_at)
  where id=p_rule_id returning * into updated;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,old_data,new_data)
  values(actor_id,'update_card_catalog_rule','card_catalog_rules',old.id::text,to_jsonb(old),
    to_jsonb(updated)||jsonb_build_object('reason',p_reason,'source',updated.source_url,'version',updated.version));
  return jsonb_build_object('ruleId',updated.id,'updated',true);
end $$;

-- Consulta de vinculos (staff ve todos; cliente autenticado, somente os proprios).
create or replace function public.get_client_catalog_cards(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not (public.is_staff() or public.has_client_access(p_client_id)) then
    raise exception 'Acesso nao autorizado' using errcode='42501';
  end if;
  return jsonb_build_object('items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'cardId',cc.id,'clientId',cc.client_id,'catalogVersionId',cv.id,'cardSlug',cv.card_slug,
      'version',cv.version,'issuer',cv.issuer,'cardName',cv.card_name,'variant',cv.card_variant,
      'brand',cv.brand,'rewardsProgram',cv.rewards_program,'lastFour',cc.last_four,
      'startedOn',cc.started_on,'endedOn',cc.ended_on,'ownership',cc.ownership,
      'rewardMode',cc.reward_mode,'relationshipCondition',cc.relationship_condition,
      'clubCondition',cc.club_condition,'eliteCategoryCondition',cc.elite_category_condition,
      'acceleratorActive',cc.accelerator_active,'automaticDebitActive',cc.automatic_debit_active,
      'hasCustomRate',cc.custom_rate is not null,'customRate',case when public.is_staff() then cc.custom_rate else null end,
      'active',cc.active,'calculationReady',cv.calculation_enabled or cc.custom_rate is not null,
      'requiresReview',cv.requires_review or (not cv.calculation_enabled and cc.custom_rate is null)
    ) order by cc.active desc,cc.started_on desc)
    from public.credit_cards cc join public.card_catalog_versions cv on cv.id=cc.catalog_version_id
    where cc.client_id=p_client_id
  ),'[]'::jsonb));
end $$;

create or replace function public.upsert_client_club_subscription_v2(
  p_subscription_id uuid default null,p_client_id uuid default null,p_account_id uuid default null,
  p_plan_id uuid default null,p_status public.club_subscription_status default 'active',
  p_starts_on date default current_date,p_ends_on date default null,
  p_expected_credit_day smallint default 1,p_next_competence date default null,
  p_notes text default null,p_effective_price numeric default null,
  p_contracted_offer text default null,p_selected_streaming text default null,
  p_joining_bonus_eligible boolean default null,p_eligibility_confirmation jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); base_result jsonb; sub_id uuid;
  plan public.loyalty_club_plans%rowtype; old_streaming text; target_client uuid;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Voce nao possui permissao para gerenciar clubes.' using errcode='42501'; end if;
  if p_effective_price is not null and p_effective_price<0 then raise exception 'Preco efetivo invalido.' using errcode='22023'; end if;
  select * into plan from public.loyalty_club_plans
  where id=coalesce(p_plan_id,(select plan_id from public.client_club_subscriptions where id=p_subscription_id));
  if plan.id is null then raise exception 'Plano nao encontrado.' using errcode='P0002'; end if;
  if plan.price_qualifier='from' and p_effective_price is null then raise exception 'Informe o preco efetivamente pago pelo cliente.' using errcode='22023'; end if;
  if plan.joining_bonus_points>0 and p_joining_bonus_eligible is true and (
    length(trim(coalesce(p_contracted_offer,'')))<5 or coalesce(p_eligibility_confirmation->>'joinedOn','')=''
    or length(trim(coalesce(p_eligibility_confirmation->>'confirmedByReason','')))<10
  ) then raise exception 'Bonus de adesao exige oferta, data de adesao e justificativa da elegibilidade.' using errcode='22023'; end if;
  base_result:=public.upsert_client_club_subscription(p_subscription_id,p_client_id,p_account_id,p_plan_id,
    p_status,p_starts_on,p_ends_on,p_expected_credit_day,p_next_competence,p_notes);
  sub_id:=(base_result->>'subscriptionId')::uuid;
  select selected_streaming,client_id into old_streaming,target_client from public.client_club_subscriptions where id=sub_id for update;
  update public.client_club_subscriptions set effective_price=p_effective_price,
    contracted_offer=nullif(trim(coalesce(p_contracted_offer,'')),''),
    selected_streaming=nullif(trim(coalesce(p_selected_streaming,'')),''),
    joining_bonus_eligible=p_joining_bonus_eligible,
    joining_bonus_confirmed_at=case when p_joining_bonus_eligible is true then now() else null end,
    administrative_confirmation=coalesce(p_eligibility_confirmation,'{}'::jsonb),
    updated_by=actor_id,updated_at=now() where id=sub_id;
  if nullif(trim(coalesce(p_selected_streaming,'')),'') is distinct from old_streaming then
    update public.client_club_streaming_history set ends_on=p_starts_on-1 where subscription_id=sub_id and ends_on is null;
    if nullif(trim(coalesce(p_selected_streaming,'')),'') is not null then
      insert into public.client_club_streaming_history(subscription_id,streaming_name,starts_on,changed_by,reason)
      values(sub_id,trim(p_selected_streaming),p_starts_on,actor_id,'Selecao administrativa da assinatura')
      on conflict(subscription_id,starts_on) do update set streaming_name=excluded.streaming_name,changed_by=excluded.changed_by,reason=excluded.reason;
    end if;
  end if;
  if plan.joining_bonus_points>0 and p_joining_bonus_eligible is true then
    insert into public.club_joining_bonus_credits(subscription_id,expected_points,eligibility_confirmed,
      eligibility_details,expected_on,status,created_by)
    values(sub_id,plan.joining_bonus_points,true,p_eligibility_confirmation,
      coalesce((p_eligibility_confirmation->>'joinedOn')::date,p_starts_on),'expected',actor_id)
    on conflict(subscription_id) do nothing;
  end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data)
  values(actor_id,target_client,'update_club_subscription_commercial_terms','client_club_subscriptions',sub_id::text,
    jsonb_build_object('effectivePrice',p_effective_price,'contractedOffer',p_contracted_offer,
      'selectedStreaming',p_selected_streaming,'joiningBonusEligible',p_joining_bonus_eligible,
      'eligibilityConfirmation',p_eligibility_confirmation,'planVersion',plan.catalog_version));
  return base_result||jsonb_build_object('joiningBonusCreated',plan.joining_bonus_points>0 and p_joining_bonus_eligible is true);
end $$;

create or replace function public.get_club_catalog(p_program_id uuid default null,p_active_only boolean default true)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not (public.is_staff() or exists(select 1 from public.client_users cu where cu.user_id=auth.uid() and cu.active)) then
    raise exception 'Acesso nao autorizado' using errcode='42501';
  end if;
  return jsonb_build_object(
    'plans',coalesce((select jsonb_agg(jsonb_build_object(
      'planId',p.id,'programId',lp.id,'programName',lp.name,'code',p.stable_code,
      'slug',p.slug,'name',p.name,'productFamily',p.product_family,
      'monthlyPoints',p.monthly_points,'qualifyingPoints',p.qualifying_points,
      'billingPeriod',p.billing_period,'validityMonths',p.points_validity_months,
      'pointsDoNotExpire',p.points_do_not_expire,'informativePrice',p.informative_price,
      'priceQualifier',p.price_qualifier,'currency',p.currency,'status',p.status,
      'validFrom',p.valid_from,'validTo',p.valid_to,'sourceUrl',p.source_url,
      'sourceVerifiedOn',p.source_verified_on,'sourceNotes',p.source_notes,
      'joiningBonusPoints',p.joining_bonus_points,'joiningBonusConditions',p.joining_bonus_conditions,
      'minimumTransferPoints',p.minimum_transfer_points,
      'purchasePointsDiscountPercent',p.purchase_points_discount_percent,
      'monthlyPurchasePointsLimit',p.monthly_purchase_points_limit,
      'reviewStatus',p.review_status,'catalogVersion',p.catalog_version,
      'benefits',coalesce((select jsonb_agg(jsonb_build_object(
        'title',b.title,'type',b.benefit_type,'description',b.description,
        'numericValue',b.numeric_value,'unit',b.unit,'rule',b.rule
      ) order by b.display_order,b.title) from public.loyalty_club_plan_benefits b
      where b.plan_id=p.id and (not p_active_only or b.valid_to is null or b.valid_to>=current_date)),'[]'::jsonb)
    ) order by lp.name,p.monthly_points,p.name,p.catalog_version desc)
    from public.loyalty_club_plans p join public.loyalty_programs lp on lp.id=p.program_id
    where (p_program_id is null or p.program_id=p_program_id) and (not p_active_only or p.status='active')),'[]'::jsonb),
    'tiers',coalesce((select jsonb_agg(jsonb_build_object(
      'tierId',t.id,'programId',t.program_id,'name',t.name,'requirements',t.requirements,
      'benefitsDescription',t.benefits_description,'sourceUrl',t.source_url,'sourceVerifiedOn',t.source_verified_on
    ) order by t.name) from public.loyalty_status_tiers t
    where (p_program_id is null or t.program_id=p_program_id)
      and (not p_active_only or t.valid_to is null or t.valid_to>=current_date)),'[]'::jsonb)
  );
end $$;

create or replace function public.get_card_statement_options()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'clients',coalesce((select jsonb_agg(jsonb_build_object('clientId',id,'fullName',full_name) order by full_name)
      from public.clients where status in ('active','lead')),'[]'::jsonb),
    'cards',coalesce((select jsonb_agg(jsonb_build_object(
      'cardId',cc.id,'clientId',cc.client_id,
      'label',cc.issuer||' '||cc.product_name||coalesce(' '||cv.card_variant,'')||coalesce(' final '||cc.last_four,''),
      'basis',case when cc.custom_unit_type='points_per_usd' then 'usd'
        when cc.custom_unit_type is not null then 'brl'
        when exists(select 1 from public.card_catalog_rules r where r.catalog_version_id=cc.catalog_version_id and r.unit_type='points_per_usd') then 'usd' else 'brl' end,
      'pointsPerUnit',cc.custom_rate,'catalogVersionId',cc.catalog_version_id,
      'cardSlug',cv.card_slug,'calculationReady',cv.calculation_enabled or cc.custom_rate is not null,
      'requiresReview',cv.requires_review or (not cv.calculation_enabled and cc.custom_rate is null)
    ) order by cc.issuer,cc.product_name)
    from public.credit_cards cc left join public.card_catalog_versions cv on cv.id=cc.catalog_version_id where cc.active),'[]'::jsonb)
  );
end $$;

create or replace function public.get_card_statements(
  p_client_id uuid default null,p_card_id uuid default null,p_status text default 'all',
  p_start_month date default null,p_end_month date default null,p_limit integer default 50,p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  safe_offset integer:=greatest(coalesce(p_offset,0),0);
  normalized_status text:=nullif(lower(trim(coalesce(p_status,'all'))),'all');
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return (with filtered as materialized(
    select cs.*,cc.client_id,cc.issuer,cc.product_name,cc.brand,cc.last_four,c.full_name,cv.card_slug,cv.version catalog_version
    from public.card_statements cs join public.credit_cards cc on cc.id=cs.card_id
    join public.clients c on c.id=cc.client_id left join public.card_catalog_versions cv on cv.id=cs.catalog_version_id
    where (p_client_id is null or cc.client_id=p_client_id) and (p_card_id is null or cs.card_id=p_card_id)
      and (normalized_status is null or cs.status::text=normalized_status)
      and (p_start_month is null or cs.statement_month>=public.first_day(p_start_month))
      and (p_end_month is null or cs.statement_month<=public.first_day(p_end_month))
  ),paged as(select * from filtered order by statement_month desc,full_name limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'statementId',p.id,'clientId',p.client_id,'clientName',p.full_name,'cardId',p.card_id,
    'cardLabel',p.issuer||' '||p.product_name||coalesce(' final '||p.last_four,''),
    'statementMonth',p.statement_month,'totalSpend',p.total_spend,'eligibleSpend',p.eligible_spend,
    'earningBasis',p.earning_basis,'earningRate',p.earning_rate,'fxRate',p.fx_rate,
    'fxRateDate',p.fx_rate_date,'fxSource',p.fx_source,
    'expectedPoints',coalesce(p.calculated_expected_points,p.expected_points),'receivedPoints',p.received_points,
    'difference',p.received_points-coalesce(p.calculated_expected_points,p.expected_points),
    'status',p.status,'notes',p.notes,'ruleSnapshot',p.earning_rule_snapshot,
    'calculationDetails',p.calculation_details,'calculationVersion',p.calculation_version,
    'cardSlug',p.card_slug,'catalogVersion',p.catalog_version
  ) order by p.statement_month desc,p.full_name) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset));
end $$;

-- ---------------------------------------------------------------------------
-- 6. RLS, grants e protecao contra acesso anonimo
-- ---------------------------------------------------------------------------

alter table public.card_catalog_versions enable row level security;
alter table public.card_catalog_rules enable row level security;
alter table public.card_statement_spend_segments enable row level security;
alter table public.card_statement_rule_applications enable row level security;
alter table public.client_club_streaming_history enable row level security;
alter table public.club_joining_bonus_credits enable row level security;

drop policy if exists card_catalog_staff_select on public.card_catalog_versions;
create policy card_catalog_staff_select on public.card_catalog_versions for select to authenticated using(public.is_staff());
drop policy if exists card_catalog_staff_write on public.card_catalog_versions;
create policy card_catalog_staff_write on public.card_catalog_versions for all to authenticated
  using(public.can_write_client_data()) with check(public.can_write_client_data());
drop policy if exists card_rules_staff_select on public.card_catalog_rules;
create policy card_rules_staff_select on public.card_catalog_rules for select to authenticated using(public.is_staff());
drop policy if exists card_rules_staff_write on public.card_catalog_rules;
create policy card_rules_staff_write on public.card_catalog_rules for all to authenticated
  using(public.can_write_client_data()) with check(public.can_write_client_data());

drop policy if exists statement_segments_access on public.card_statement_spend_segments;
create policy statement_segments_access on public.card_statement_spend_segments for select to authenticated using(
  exists(select 1 from public.card_statements s join public.credit_cards c on c.id=s.card_id
    where s.id=statement_id and (public.is_staff() or public.has_client_access(c.client_id)))
);
drop policy if exists statement_segments_staff_write on public.card_statement_spend_segments;
create policy statement_segments_staff_write on public.card_statement_spend_segments for all to authenticated
  using(public.can_write_client_data()) with check(public.can_write_client_data());
drop policy if exists statement_rule_apps_access on public.card_statement_rule_applications;
create policy statement_rule_apps_access on public.card_statement_rule_applications for select to authenticated using(
  exists(select 1 from public.card_statements s join public.credit_cards c on c.id=s.card_id
    where s.id=statement_id and (public.is_staff() or public.has_client_access(c.client_id)))
);
drop policy if exists statement_rule_apps_staff_write on public.card_statement_rule_applications;
create policy statement_rule_apps_staff_write on public.card_statement_rule_applications for all to authenticated
  using(public.can_write_client_data()) with check(public.can_write_client_data());

drop policy if exists club_streaming_access on public.client_club_streaming_history;
create policy club_streaming_access on public.client_club_streaming_history for select to authenticated using(
  exists(select 1 from public.client_club_subscriptions s where s.id=subscription_id
    and (public.is_staff() or public.has_client_access(s.client_id)))
);
drop policy if exists club_streaming_staff_write on public.client_club_streaming_history;
create policy club_streaming_staff_write on public.client_club_streaming_history for all to authenticated
  using(public.can_write_client_data()) with check(public.can_write_client_data());
drop policy if exists club_bonus_access on public.club_joining_bonus_credits;
create policy club_bonus_access on public.club_joining_bonus_credits for select to authenticated using(
  exists(select 1 from public.client_club_subscriptions s where s.id=subscription_id
    and (public.is_staff() or public.has_client_access(s.client_id)))
);
drop policy if exists club_bonus_staff_write on public.club_joining_bonus_credits;
create policy club_bonus_staff_write on public.club_joining_bonus_credits for all to authenticated
  using(public.can_write_client_data()) with check(public.can_write_client_data());

revoke all on public.card_catalog_versions,public.card_catalog_rules,
  public.card_statement_spend_segments,public.card_statement_rule_applications,
  public.client_club_streaming_history,public.club_joining_bonus_credits from anon;
grant select,insert,update on public.card_catalog_versions,public.card_catalog_rules,
  public.card_statement_spend_segments,public.card_statement_rule_applications,
  public.client_club_streaming_history,public.club_joining_bonus_credits to authenticated;

revoke all on function public.get_card_catalog(text,text,text,text,boolean),
  public.associate_catalog_card(uuid,uuid,date,text,text,text,text,text,text,boolean,boolean,numeric,text,text,text,text,date),
  public.calculate_client_card_points(uuid,date,jsonb,numeric),
  public.record_catalog_card_statement(uuid,date,jsonb,numeric,numeric,numeric,date,text,text,uuid),
  public.duplicate_card_catalog_version(uuid,text),
  public.set_card_catalog_active(uuid,boolean,text),
  public.update_card_catalog_rule(uuid,numeric,numeric,boolean,boolean,date,text,date,text),
  public.upsert_client_club_subscription_v2(uuid,uuid,uuid,uuid,public.club_subscription_status,date,date,smallint,date,text,numeric,text,text,boolean,jsonb),
  public.get_client_catalog_cards(uuid) from public,anon;
grant execute on function public.get_card_catalog(text,text,text,text,boolean),
  public.associate_catalog_card(uuid,uuid,date,text,text,text,text,text,text,boolean,boolean,numeric,text,text,text,text,date),
  public.calculate_client_card_points(uuid,date,jsonb,numeric),
  public.record_catalog_card_statement(uuid,date,jsonb,numeric,numeric,numeric,date,text,text,uuid),
  public.duplicate_card_catalog_version(uuid,text),
  public.set_card_catalog_active(uuid,boolean,text),
  public.update_card_catalog_rule(uuid,numeric,numeric,boolean,boolean,date,text,date,text),
  public.upsert_client_club_subscription_v2(uuid,uuid,uuid,uuid,public.club_subscription_status,date,date,smallint,date,text,numeric,text,text,boolean,jsonb),
  public.get_client_catalog_cards(uuid) to authenticated;

commit;
