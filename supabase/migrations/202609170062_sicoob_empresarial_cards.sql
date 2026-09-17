-- PATCH 053 - Sicoob Empresarial cards for invoice prediction.

begin;

with seed(card_slug, issuer, card_name, card_variant, brand, rewards_program, source_url, source_quality, calculation_enabled, requires_review, review_notes, rate) as (
  values
    ('sicoob-empresarial','Sicoob','Sicoob Empresarial',null,null,'Coopera','https://www.sicoob.com.br/web/sicoob/noticias/-/asset_publisher/xAioIawpOI5S/content/id/307547791','official_exact',true,false,null,1::numeric),
    ('sicoob-platinum-empresarial','Sicoob','Sicoob Platinum Empresarial',null,null,'Coopera','https://www.sicoob.com.br/web/sicoob/noticias/-/asset_publisher/xAioIawpOI5S/content/id/307547791','official_exact',true,false,null,1.5::numeric)
)
insert into public.card_catalog_versions(
  card_slug, version, issuer, card_name, card_variant, brand, rewards_program,
  source_url, source_checked_at, valid_from, valid_until, source_quality,
  calculation_enabled, requires_review, review_notes, active, idempotency_key
)
select card_slug, 1, issuer, card_name, card_variant, brand, rewards_program,
  source_url, date '2026-09-17', date '2026-09-17', null, source_quality,
  calculation_enabled, requires_review, review_notes, true, 'card_catalog:' || card_slug || ':1'
from seed
on conflict (card_slug, version) do update set
  issuer=excluded.issuer,
  card_name=excluded.card_name,
  card_variant=excluded.card_variant,
  brand=excluded.brand,
  rewards_program=excluded.rewards_program,
  source_url=excluded.source_url,
  source_checked_at=excluded.source_checked_at,
  source_quality=excluded.source_quality,
  calculation_enabled=excluded.calculation_enabled,
  requires_review=excluded.requires_review,
  review_notes=excluded.review_notes,
  active=true,
  updated_at=now();

with rule_seed(card_slug, rate) as (
  values
    ('sicoob-empresarial',1::numeric),
    ('sicoob-platinum-empresarial',1.5::numeric)
)
insert into public.card_catalog_rules(
  catalog_version_id, rule_scope, unit_type, rate, denominator, spend_currency,
  spend_location, merchant_scope, merchant_match, minimum_statement_amount,
  maximum_statement_amount, relationship_condition, club_condition,
  accelerator_condition, reward_mode_condition, automatic_debit_condition,
  priority, valid_from, valid_until, source_url, source_checked_at, source_quality,
  calculation_enabled, requires_review, version, idempotency_key
)
select c.id, 'default', 'points_per_usd', r.rate, null, 'BRL',
  'any', 'any', null, null, null, null, null, null, null, null,
  100, date '2026-09-17', null, c.source_url, date '2026-09-17', c.source_quality,
  true, false, 1, 'card_rule:' || r.card_slug || ':default:1'
from rule_seed r
join public.card_catalog_versions c on c.card_slug=r.card_slug and c.version=1
on conflict (idempotency_key) do update set
  rate=excluded.rate,
  unit_type=excluded.unit_type,
  denominator=null,
  spend_currency=excluded.spend_currency,
  spend_location=excluded.spend_location,
  merchant_scope=excluded.merchant_scope,
  priority=excluded.priority,
  valid_from=excluded.valid_from,
  valid_until=null,
  source_url=excluded.source_url,
  source_checked_at=excluded.source_checked_at,
  source_quality=excluded.source_quality,
  calculation_enabled=true,
  requires_review=false;

commit;
