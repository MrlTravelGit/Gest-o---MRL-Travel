-- PATCH 064 - Administrative card catalog CRUD on top of the versioned catalog.

begin;

alter table public.card_catalog_versions
  add column if not exists display_name text,
  add column if not exists account_type text,
  add column if not exists earning_currency char(3) default 'USD',
  add column if not exists notes text;

update public.card_catalog_versions
set display_name = concat_ws(' ', issuer, card_name, nullif(card_variant, ''))
where nullif(trim(display_name), '') is null;

update public.card_catalog_versions
set earning_currency = 'USD'
where earning_currency is null;

alter table public.card_catalog_versions
  alter column display_name set not null,
  alter column earning_currency set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.card_catalog_versions'::regclass
      and conname = 'card_catalog_account_type_valid'
  ) then
    alter table public.card_catalog_versions
      add constraint card_catalog_account_type_valid
      check (account_type is null or account_type in ('Pessoa Física', 'Pessoa Jurídica', 'Ambos'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.card_catalog_versions'::regclass
      and conname = 'card_catalog_earning_currency_valid'
  ) then
    alter table public.card_catalog_versions
      add constraint card_catalog_earning_currency_valid
      check (earning_currency ~ '^[A-Z]{3}$');
  end if;
end $$;

create index if not exists card_catalog_admin_search_idx
  on public.card_catalog_versions using gin (
    to_tsvector('simple'::regconfig,
      coalesce(issuer, '') || ' ' || coalesce(card_name, '') || ' ' ||
      coalesce(display_name, '') || ' ' || coalesce(rewards_program, ''))
  );

create index if not exists card_catalog_duplicate_lookup_idx
  on public.card_catalog_versions (
    lower(trim(issuer)),
    lower(trim(card_name)),
    coalesce(lower(trim(account_type)), '')
  ) where active;

create or replace function public.admin_upsert_card_catalog(
  p_id uuid,
  p_issuer text,
  p_card_name text,
  p_display_name text,
  p_account_type text,
  p_points_per_usd numeric,
  p_earning_currency text,
  p_default_program text,
  p_notes text,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  catalog public.card_catalog_versions%rowtype;
  old_catalog public.card_catalog_versions%rowtype;
  default_rule public.card_catalog_rules%rowtype;
  generated_id uuid := coalesce(p_id, gen_random_uuid());
  generated_slug text;
  normalized_account_type text := nullif(trim(coalesce(p_account_type, '')), '');
  normalized_currency text := upper(coalesce(nullif(trim(p_earning_currency), ''), 'USD'));
  normalized_program text := coalesce(nullif(trim(p_default_program), ''), 'Não informado');
  normalized_display_name text;
begin
  if actor_id is null or not public.has_staff_role(array['super_admin', 'manager']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_issuer, '')), '') is null then
    raise exception 'CARD_ISSUER_REQUIRED' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_card_name, '')), '') is null then
    raise exception 'CARD_NAME_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(p_points_per_usd, 0) <= 0 then
    raise exception 'CARD_POINTS_RULE_REQUIRED' using errcode = '22023';
  end if;
  if normalized_account_type is not null and normalized_account_type not in ('Pessoa Física', 'Pessoa Jurídica', 'Ambos') then
    raise exception 'CARD_ACCOUNT_TYPE_INVALID' using errcode = '22023';
  end if;
  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'CARD_CURRENCY_INVALID' using errcode = '22023';
  end if;

  normalized_display_name := coalesce(
    nullif(trim(coalesce(p_display_name, '')), ''),
    trim(p_issuer) || ' ' || trim(p_card_name)
  );

  if coalesce(p_is_active, true) and exists (
    select 1
    from public.card_catalog_versions existing
    where existing.active
      and existing.id <> generated_id
      and lower(trim(existing.issuer)) = lower(trim(p_issuer))
      and lower(trim(existing.card_name)) = lower(trim(p_card_name))
      and coalesce(lower(trim(existing.account_type)), '') = coalesce(lower(normalized_account_type), '')
  ) then
    raise exception 'CARD_CATALOG_DUPLICATE' using errcode = '23505';
  end if;

  if p_id is null then
    generated_slug := trim(both '-' from regexp_replace(
      lower(translate(trim(p_issuer) || '-' || trim(p_card_name),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn')),
      '[^a-z0-9]+', '-', 'g'
    ));
    if generated_slug = '' then generated_slug := 'cartao'; end if;
    if exists (select 1 from public.card_catalog_versions where card_slug = generated_slug) then
      generated_slug := generated_slug || '-' || substr(md5(generated_id::text), 1, 8);
    end if;

    insert into public.card_catalog_versions (
      id, card_slug, version, issuer, card_name, display_name, account_type,
      earning_currency, rewards_program, source_url, source_checked_at, valid_from,
      source_quality, calculation_enabled, requires_review, review_notes, notes,
      active, idempotency_key, created_by, updated_by
    ) values (
      generated_id, generated_slug, 1, trim(p_issuer), trim(p_card_name),
      normalized_display_name, normalized_account_type, normalized_currency,
      normalized_program, 'manual://admin-card-catalog', current_date, current_date,
      'official_exact', true, false, null, nullif(trim(coalesce(p_notes, '')), ''),
      coalesce(p_is_active, true), 'card_catalog:manual:' || generated_id::text,
      actor_id, actor_id
    ) returning * into catalog;
  else
    select * into old_catalog
    from public.card_catalog_versions
    where id = p_id
    for update;

    if old_catalog.id is null then
      raise exception 'CARD_NOT_FOUND' using errcode = 'P0002';
    end if;

    update public.card_catalog_versions
    set issuer = trim(p_issuer),
        card_name = trim(p_card_name),
        display_name = normalized_display_name,
        account_type = normalized_account_type,
        earning_currency = normalized_currency,
        rewards_program = normalized_program,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        active = coalesce(p_is_active, true),
        calculation_enabled = true,
        updated_by = actor_id,
        updated_at = now()
    where id = p_id
    returning * into catalog;
  end if;

  select * into default_rule
  from public.card_catalog_rules
  where catalog_version_id = catalog.id
    and rule_scope = 'default'
  order by (unit_type = 'points_per_usd') desc, priority desc, created_at
  limit 1
  for update;

  if default_rule.id is null then
    insert into public.card_catalog_rules (
      catalog_version_id, rule_scope, unit_type, rate, denominator, spend_currency,
      spend_location, merchant_scope, priority, valid_from, source_url,
      source_checked_at, source_quality, calculation_enabled, requires_review,
      version, idempotency_key, created_by
    ) values (
      catalog.id, 'default', 'points_per_usd', p_points_per_usd, null, 'BRL',
      'any', 'any', 100, current_date, 'manual://admin-card-catalog',
      current_date, 'official_exact', true, false, catalog.version,
      'card_rule:manual:' || catalog.id::text || ':default:' || catalog.version::text,
      actor_id
    );
  else
    update public.card_catalog_rules
    set unit_type = 'points_per_usd',
        rate = p_points_per_usd,
        denominator = null,
        calculation_enabled = true,
        requires_review = false,
        source_checked_at = current_date,
        source_quality = 'official_exact'
    where id = default_rule.id;
  end if;

  insert into public.audit_logs (actor_user_id, action, table_name, record_id, old_data, new_data)
  values (
    actor_id,
    case when p_id is null then 'create_card_catalog' else 'update_card_catalog' end,
    'card_catalog_versions',
    catalog.id::text,
    case when p_id is null then null else to_jsonb(old_catalog) end,
    to_jsonb(catalog) || jsonb_build_object('pointsPerUsd', p_points_per_usd)
  );

  return jsonb_build_object('catalogVersionId', catalog.id, 'created', p_id is null);
end;
$$;

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
    'canManage', public.has_staff_role(array['super_admin', 'manager']::public.app_role[]),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'catalogVersionId',c.id,'cardSlug',c.card_slug,'version',c.version,
        'issuer',c.issuer,'cardName',c.card_name,'displayName',c.display_name,
        'accountType',c.account_type,'earningCurrency',c.earning_currency,
        'notes',c.notes,'cardVariant',c.card_variant,'brand',c.brand,
        'rewardsProgram',c.rewards_program,'sourceUrl',c.source_url,
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

create or replace function public.set_card_catalog_active(
  p_catalog_version_id uuid, p_active boolean, p_reason text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  actor_id uuid := auth.uid();
  old public.card_catalog_versions%rowtype;
  updated public.card_catalog_versions%rowtype;
begin
  if actor_id is null or not public.has_staff_role(array['super_admin', 'manager']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if length(trim(coalesce(p_reason,''))) < 10 then
    raise exception 'Informe o motivo.' using errcode='22023';
  end if;
  select * into old from public.card_catalog_versions where id=p_catalog_version_id for update;
  if old.id is null then raise exception 'Versao nao encontrada.' using errcode='P0002'; end if;
  if p_active and exists (
    select 1 from public.card_catalog_versions existing
    where existing.active and existing.id <> old.id
      and lower(trim(existing.issuer)) = lower(trim(old.issuer))
      and lower(trim(existing.card_name)) = lower(trim(old.card_name))
      and coalesce(lower(trim(existing.account_type)), '') = coalesce(lower(trim(old.account_type)), '')
  ) then
    raise exception 'CARD_CATALOG_DUPLICATE' using errcode='23505';
  end if;
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
declare
  actor_id uuid := auth.uid();
  old public.card_catalog_rules%rowtype;
  updated public.card_catalog_rules%rowtype;
begin
  if actor_id is null or not public.has_staff_role(array['super_admin', 'manager']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
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

create or replace function public.duplicate_card_catalog_version(
  p_catalog_version_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  actor_id uuid := auth.uid();
  old public.card_catalog_versions%rowtype;
  new_row public.card_catalog_versions%rowtype;
  new_version integer;
  r public.card_catalog_rules%rowtype;
begin
  if actor_id is null or not public.has_staff_role(array['super_admin', 'manager']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if length(trim(coalesce(p_reason,'')))<10 then raise exception 'Informe o motivo da nova versao.' using errcode='22023'; end if;
  select * into old from public.card_catalog_versions where id=p_catalog_version_id;
  if old.id is null then raise exception 'Versao nao encontrada.' using errcode='P0002'; end if;
  select coalesce(max(version),0)+1 into new_version from public.card_catalog_versions where card_slug=old.card_slug;
  insert into public.card_catalog_versions(
    card_slug,version,issuer,card_name,display_name,account_type,earning_currency,notes,
    card_variant,brand,rewards_program,source_url,source_checked_at,valid_from,valid_until,
    source_quality,calculation_enabled,requires_review,review_notes,idempotency_key,created_by,updated_by
  ) values (
    old.card_slug,new_version,old.issuer,old.card_name,old.display_name,old.account_type,
    old.earning_currency,old.notes,old.card_variant,old.brand,old.rewards_program,old.source_url,
    current_date,current_date,null,old.source_quality,false,true,
    'Nova versao pendente de revisao. '||trim(p_reason),
    'card_catalog:'||old.card_slug||':'||new_version,actor_id,actor_id
  ) returning * into new_row;
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

revoke all on function public.admin_upsert_card_catalog(uuid,text,text,text,text,numeric,text,text,text,boolean) from public, anon;
grant execute on function public.admin_upsert_card_catalog(uuid,text,text,text,text,numeric,text,text,text,boolean) to authenticated;

commit;
