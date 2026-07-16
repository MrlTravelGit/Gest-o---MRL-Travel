-- PATCH MRL 0.4.0 - Sidebar, clubes, faturas, historico e acesso direto.

do $$
begin
  create type public.club_subscription_status as enum ('active', 'paused', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.scheduled_credit_status as enum ('expected', 'confirmed', 'missed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.direct_access_link_status as enum ('active', 'revoked', 'expired');
exception when duplicate_object then null;
end $$;

alter type public.statement_status add value if not exists 'calculated';
alter type public.statement_status add value if not exists 'reconciled';
alter type public.statement_status add value if not exists 'divergent';
alter type public.statement_status add value if not exists 'cancelled';

create or replace function public.can_write_client_data()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.has_staff_role(array[
    'super_admin'::public.app_role,
    'manager'::public.app_role,
    'operator'::public.app_role
  ]);
$$;

create or replace function public.can_manage_security()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.has_staff_role(array[
    'super_admin'::public.app_role,
    'manager'::public.app_role
  ]);
$$;

create table if not exists public.loyalty_club_plans (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  stable_code text not null,
  name text not null,
  monthly_points bigint not null default 0,
  qualifying_points bigint not null default 0,
  billing_period text not null default 'monthly',
  points_validity_months integer,
  points_do_not_expire boolean not null default false,
  informative_price numeric(16,2),
  currency char(3) not null default 'BRL',
  status text not null default 'active',
  valid_from date not null default current_date,
  valid_to date,
  source_url text not null,
  source_verified_on date not null,
  source_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_plan_code_format check (stable_code ~ '^[a-z0-9_]+$'),
  constraint club_plan_points_nonnegative check (monthly_points >= 0 and qualifying_points >= 0),
  constraint club_plan_validity_positive check (points_validity_months is null or points_validity_months > 0),
  constraint club_plan_status_valid check (status in ('active','inactive','informational')),
  constraint club_plan_date_order check (valid_to is null or valid_to >= valid_from),
  unique(program_id, stable_code)
);

create table if not exists public.loyalty_club_plan_benefits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.loyalty_club_plans(id) on delete cascade,
  benefit_type text not null,
  title text not null,
  description text not null,
  numeric_value numeric(16,4),
  unit text,
  rule jsonb not null default '{}'::jsonb,
  valid_from date not null default current_date,
  valid_to date,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint club_benefit_date_order check (valid_to is null or valid_to >= valid_from)
);

create table if not exists public.loyalty_status_tiers (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  name text not null,
  requirements jsonb not null default '{}'::jsonb,
  benefits_description text not null,
  valid_from date not null default current_date,
  valid_to date,
  source_url text not null,
  source_verified_on date not null,
  created_at timestamptz not null default now(),
  constraint status_tier_date_order check (valid_to is null or valid_to >= valid_from),
  unique(program_id, name, valid_from)
);

create table if not exists public.client_club_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  account_id uuid not null references public.program_accounts(id) on delete cascade,
  plan_id uuid not null references public.loyalty_club_plans(id) on delete restrict,
  status public.club_subscription_status not null default 'active',
  starts_on date not null,
  ends_on date,
  expected_credit_day smallint not null default 1,
  next_competence date not null,
  granted_tier_id uuid references public.loyalty_status_tiers(id) on delete set null,
  plan_snapshot jsonb not null default '{}'::jsonb,
  overrides jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_date_order check (ends_on is null or ends_on >= starts_on),
  constraint subscription_credit_day check (expected_credit_day between 1 and 28),
  constraint subscription_competence_month check (extract(day from next_competence) = 1)
);

create unique index if not exists active_client_club_subscription_idx
  on public.client_club_subscriptions(account_id)
  where status = 'active';

create table if not exists public.scheduled_point_credits (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.client_club_subscriptions(id) on delete cascade,
  competence date not null,
  expected_points bigint not null,
  expected_credit_on date not null,
  status public.scheduled_credit_status not null default 'expected',
  confirmed_transaction_id uuid references public.point_transactions(id) on delete set null,
  operation_id uuid,
  source_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_credit_competence_month check (extract(day from competence) = 1),
  constraint scheduled_credit_points_positive check (expected_points > 0),
  unique(subscription_id, competence)
);

create unique index if not exists scheduled_credit_operation_idx
  on public.scheduled_point_credits(operation_id)
  where operation_id is not null;

alter table public.card_statements
  add column if not exists closing_on date,
  add column if not exists due_on date,
  add column if not exists currency char(3) not null default 'BRL',
  add column if not exists earning_rule_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists fx_rate_date date,
  add column if not exists fx_source text,
  add column if not exists operation_id uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

create unique index if not exists card_statements_operation_idx
  on public.card_statements(operation_id)
  where operation_id is not null;

alter table public.point_transactions
  add column if not exists status text not null default 'confirmed',
  add column if not exists reversal_of_transaction_id uuid references public.point_transactions(id) on delete set null,
  add column if not exists correction_reason text,
  add column if not exists corrected_by uuid references auth.users(id) on delete set null,
  add column if not exists corrected_at timestamptz;

create index if not exists point_transactions_reversal_idx
  on public.point_transactions(reversal_of_transaction_id)
  where reversal_of_transaction_id is not null;

create table if not exists public.client_direct_access_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  token_hash text not null unique,
  status public.direct_access_link_status not null default 'active',
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  use_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  notes text,
  constraint direct_access_use_count_nonnegative check (use_count >= 0)
);

create index if not exists client_direct_access_links_client_idx
  on public.client_direct_access_links(client_id, status, created_at desc);

create table if not exists public.client_direct_access_events (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references public.client_direct_access_links(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  event_type text not null,
  fingerprint_hash text,
  created_at timestamptz not null default now(),
  constraint direct_access_event_type_valid check (event_type in ('success','invalid','revoked','expired','inactive','rate_limited','no_user','exchange_failed'))
);

create or replace function public.first_day(target_date date)
returns date
language sql
immutable
set search_path = pg_catalog, public
as $$
  select date_trunc('month', target_date)::date;
$$;

create or replace function public.get_club_catalog(
  p_program_id uuid default null,
  p_active_only boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not (public.is_staff() or exists(select 1 from public.client_users cu where cu.user_id = auth.uid() and cu.active)) then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'planId', p.id,
        'programId', lp.id,
        'programName', lp.name,
        'code', p.stable_code,
        'name', p.name,
        'monthlyPoints', p.monthly_points,
        'qualifyingPoints', p.qualifying_points,
        'billingPeriod', p.billing_period,
        'validityMonths', p.points_validity_months,
        'pointsDoNotExpire', p.points_do_not_expire,
        'informativePrice', p.informative_price,
        'currency', p.currency,
        'status', p.status,
        'sourceUrl', p.source_url,
        'sourceVerifiedOn', p.source_verified_on,
        'sourceNotes', p.source_notes,
        'benefits', coalesce((
          select jsonb_agg(jsonb_build_object(
            'title', b.title,
            'type', b.benefit_type,
            'description', b.description,
            'numericValue', b.numeric_value,
            'unit', b.unit,
            'rule', b.rule
          ) order by b.display_order, b.title)
          from public.loyalty_club_plan_benefits b
          where b.plan_id = p.id
            and (not p_active_only or b.valid_to is null or b.valid_to >= current_date)
        ), '[]'::jsonb)
      ) order by lp.name, p.monthly_points, p.name)
      from public.loyalty_club_plans p
      join public.loyalty_programs lp on lp.id = p.program_id
      where (p_program_id is null or p.program_id = p_program_id)
        and (not p_active_only or p.status = 'active')
    ), '[]'::jsonb),
    'tiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tierId', t.id,
        'programId', t.program_id,
        'name', t.name,
        'requirements', t.requirements,
        'benefitsDescription', t.benefits_description,
        'sourceUrl', t.source_url,
        'sourceVerifiedOn', t.source_verified_on
      ) order by t.name)
      from public.loyalty_status_tiers t
      where (p_program_id is null or t.program_id = p_program_id)
        and (not p_active_only or t.valid_to is null or t.valid_to >= current_date)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_client_club_subscription(
  p_subscription_id uuid default null,
  p_client_id uuid default null,
  p_account_id uuid default null,
  p_plan_id uuid default null,
  p_status public.club_subscription_status default 'active',
  p_starts_on date default current_date,
  p_ends_on date default null,
  p_expected_credit_day smallint default 1,
  p_next_competence date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  account_row public.program_accounts%rowtype;
  plan_row public.loyalty_club_plans%rowtype;
  sub_row public.client_club_subscriptions%rowtype;
  target_client_id uuid := p_client_id;
  competence_value date := public.first_day(coalesce(p_next_competence, p_starts_on, current_date));
  expected_date date;
begin
  if actor_id is null or not public.can_write_client_data() then
    raise exception 'Você não possui permissão para gerenciar clubes.' using errcode = '42501';
  end if;

  if p_subscription_id is not null then
    select * into sub_row from public.client_club_subscriptions where id = p_subscription_id for update;
    if sub_row.id is null then raise exception 'Assinatura não encontrada.' using errcode = 'P0002'; end if;
    target_client_id := sub_row.client_id;
  end if;

  select * into account_row from public.program_accounts where id = coalesce(p_account_id, sub_row.account_id) for update;
  if account_row.id is null then raise exception 'Conta do programa não encontrada.' using errcode = 'P0002'; end if;
  if target_client_id is null then target_client_id := account_row.client_id; end if;
  if account_row.client_id <> target_client_id then raise exception 'A conta deve pertencer ao cliente.' using errcode = '42501'; end if;

  select * into plan_row from public.loyalty_club_plans where id = coalesce(p_plan_id, sub_row.plan_id);
  if plan_row.id is null then raise exception 'Plano de clube não encontrado.' using errcode = 'P0002'; end if;
  if plan_row.program_id <> account_row.program_id then raise exception 'Plano e conta devem pertencer ao mesmo programa.' using errcode = '42501'; end if;
  if p_expected_credit_day not between 1 and 28 then raise exception 'Dia de crédito inválido.' using errcode = '22023'; end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then raise exception 'Fim não pode ser anterior ao início.' using errcode = '22007'; end if;

  expected_date := competence_value + (p_expected_credit_day - 1);

  if p_subscription_id is null then
    insert into public.client_club_subscriptions (
      client_id, account_id, plan_id, status, starts_on, ends_on,
      expected_credit_day, next_competence, plan_snapshot, notes, created_by, updated_by
    ) values (
      target_client_id, account_row.id, plan_row.id, p_status, p_starts_on, p_ends_on,
      p_expected_credit_day, competence_value,
      to_jsonb(plan_row) - array['created_at','updated_at'], nullif(trim(coalesce(p_notes,'')),''), actor_id, actor_id
    ) returning * into sub_row;
  else
    update public.client_club_subscriptions set
      account_id = account_row.id,
      plan_id = plan_row.id,
      status = p_status,
      starts_on = p_starts_on,
      ends_on = p_ends_on,
      expected_credit_day = p_expected_credit_day,
      next_competence = competence_value,
      plan_snapshot = to_jsonb(plan_row) - array['created_at','updated_at'],
      notes = nullif(trim(coalesce(p_notes,'')),''),
      updated_by = actor_id,
      updated_at = now()
    where id = p_subscription_id
    returning * into sub_row;
  end if;

  if sub_row.status = 'active' and plan_row.monthly_points > 0 then
    insert into public.scheduled_point_credits (
      subscription_id, competence, expected_points, expected_credit_on, source_snapshot, notes, created_by
    ) values (
      sub_row.id, competence_value, plan_row.monthly_points, expected_date,
      jsonb_build_object('planId', plan_row.id, 'planName', plan_row.name, 'monthlyPoints', plan_row.monthly_points),
      'Previsão criada a partir da assinatura de clube.', actor_id
    )
    on conflict (subscription_id, competence) do update set
      expected_points = excluded.expected_points,
      expected_credit_on = excluded.expected_credit_on,
      source_snapshot = excluded.source_snapshot,
      updated_at = now();
  end if;

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, target_client_id, case when p_subscription_id is null then 'create_club_subscription' else 'update_club_subscription' end, 'client_club_subscriptions', sub_row.id::text, to_jsonb(sub_row));

  return jsonb_build_object('subscriptionId', sub_row.id, 'status', sub_row.status);
end;
$$;

create or replace function public.get_client_club_subscriptions(
  p_client_id uuid default null,
  p_status text default 'all',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  safe_offset integer := greatest(coalesce(p_offset,0),0);
  normalized_status text := nullif(lower(trim(coalesce(p_status,'all'))),'all');
begin
  if auth.uid() is null then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if p_client_id is not null and not (public.is_staff() or public.has_client_access(p_client_id)) then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if p_client_id is null and not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;

  return (
    with filtered as materialized (
      select s.*, c.full_name, lp.name as program_name, pa.id as account_id_value, plan.name as plan_name, plan.monthly_points,
        (select jsonb_agg(jsonb_build_object('creditId', sc.id, 'competence', sc.competence, 'expectedPoints', sc.expected_points, 'expectedCreditOn', sc.expected_credit_on, 'status', sc.status, 'transactionId', sc.confirmed_transaction_id) order by sc.competence desc)
         from public.scheduled_point_credits sc where sc.subscription_id = s.id) as credits
      from public.client_club_subscriptions s
      join public.clients c on c.id = s.client_id
      join public.program_accounts pa on pa.id = s.account_id
      join public.loyalty_programs lp on lp.id = pa.program_id
      join public.loyalty_club_plans plan on plan.id = s.plan_id
      where (p_client_id is null or s.client_id = p_client_id)
        and (normalized_status is null or s.status::text = normalized_status)
        and (public.is_staff() or public.has_client_access(s.client_id))
    ), paged as (
      select * from filtered order by full_name, program_name, created_at desc limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object(
        'subscriptionId', p.id, 'clientId', p.client_id, 'clientName', p.full_name,
        'accountId', p.account_id_value, 'programName', p.program_name, 'planId', p.plan_id,
        'planName', p.plan_name, 'monthlyPoints', p.monthly_points, 'status', p.status,
        'startsOn', p.starts_on, 'endsOn', p.ends_on, 'expectedCreditDay', p.expected_credit_day,
        'nextCompetence', p.next_competence, 'notes', p.notes, 'credits', coalesce(p.credits,'[]'::jsonb)
      ) order by p.full_name, p.program_name) from paged p),'[]'::jsonb),
      'total', (select count(*) from filtered), 'limit', safe_limit, 'offset', safe_offset
    )
  );
end;
$$;

create or replace function public.confirm_scheduled_point_credit(
  p_credit_id uuid,
  p_operation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  credit_row public.scheduled_point_credits%rowtype;
  sub_row public.client_club_subscriptions%rowtype;
  account_row public.program_accounts%rowtype;
  program_row public.loyalty_programs%rowtype;
  current_balance bigint := 0;
  current_average numeric(14,4) := 0;
  tx_row public.point_transactions%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Você não possui permissão para confirmar créditos.' using errcode='42501'; end if;
  select * into credit_row from public.scheduled_point_credits where id = p_credit_id for update;
  if credit_row.id is null then raise exception 'Crédito previsto não encontrado.' using errcode='P0002'; end if;
  if credit_row.status = 'confirmed' then
    return jsonb_build_object('creditId', credit_row.id, 'transactionId', credit_row.confirmed_transaction_id, 'idempotentReplay', true);
  end if;
  if credit_row.status <> 'expected' then raise exception 'Somente créditos esperados podem ser confirmados.' using errcode='22023'; end if;

  select * into sub_row from public.client_club_subscriptions where id = credit_row.subscription_id for update;
  select * into account_row from public.program_accounts where id = sub_row.account_id for update;
  select * into program_row from public.loyalty_programs where id = account_row.program_id;

  select coalesce(bs.balance,0), coalesce(bs.average_cost_per_thousand,0)
  into current_balance, current_average
  from public.balance_snapshots bs
  where bs.account_id = account_row.id
  order by bs.captured_at desc, bs.id desc limit 1;
  if not found then current_balance := 0; current_average := 0; end if;

  insert into public.point_transactions(account_id, occurred_at, transaction_type, points_delta, description, expires_on, source, metadata, created_by, entry_category, entry_date, operation_id)
  values(account_row.id, credit_row.expected_credit_on::timestamp at time zone 'America/Sao_Paulo', 'credit', credit_row.expected_points, 'Crédito confirmado de clube: ' || coalesce(sub_row.plan_snapshot->>'name','Plano de clube'), null, 'club', jsonb_build_object('scheduledCreditId', credit_row.id, 'subscriptionId', sub_row.id), actor_id, 'other', credit_row.expected_credit_on, p_operation_id)
  returning * into tx_row;

  insert into public.balance_snapshots(account_id, captured_at, balance, average_cost_per_thousand, value_per_thousand, source, notes, created_by)
  values(account_row.id, clock_timestamp(), current_balance + credit_row.expected_points, current_average, program_row.default_value_per_thousand, 'club_credit', 'Crédito confirmado de clube.', actor_id);

  update public.scheduled_point_credits set status='confirmed', confirmed_transaction_id=tx_row.id, operation_id=p_operation_id, confirmed_by=actor_id, confirmed_at=clock_timestamp(), updated_at=now()
  where id = credit_row.id returning * into credit_row;

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, sub_row.client_id, 'confirm_club_credit', 'scheduled_point_credits', credit_row.id::text, jsonb_build_object('transactionId', tx_row.id));

  return jsonb_build_object('creditId', credit_row.id, 'transactionId', tx_row.id, 'idempotentReplay', false);
exception when unique_violation then
  select * into credit_row from public.scheduled_point_credits where operation_id = p_operation_id;
  return jsonb_build_object('creditId', credit_row.id, 'transactionId', credit_row.confirmed_transaction_id, 'idempotentReplay', true);
end;
$$;

create or replace function public.get_card_statement_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'clients', coalesce((select jsonb_agg(jsonb_build_object('clientId', c.id, 'fullName', c.full_name) order by c.full_name) from public.clients c where c.status='active'),'[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('cardId', cc.id, 'clientId', cc.client_id, 'label', cc.issuer || ' ' || cc.product_name || ' final ' || cc.last_four, 'basis', cr.basis, 'pointsPerUnit', cr.points_per_unit) order by cc.issuer, cc.product_name)
      from public.credit_cards cc
      left join lateral (select * from public.card_earning_rules r where r.card_id=cc.id and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date) order by r.valid_from desc limit 1) cr on true
      where cc.active),'[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_credit_card(
  p_card_id uuid default null,
  p_client_id uuid default null,
  p_issuer text default null,
  p_product_name text default null,
  p_brand text default null,
  p_last_four text default null,
  p_program_id uuid default null,
  p_basis public.earning_basis default 'brl',
  p_points_per_unit numeric default 1,
  p_rule_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  card_row public.credit_cards%rowtype;
  target_client uuid := p_client_id;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Você não possui permissão para cartões.' using errcode='42501'; end if;
  if p_card_id is not null then
    select * into card_row from public.credit_cards where id=p_card_id for update;
    if card_row.id is null then raise exception 'Cartão não encontrado.' using errcode='P0002'; end if;
    target_client := card_row.client_id;
  end if;
  if target_client is null then raise exception 'Selecione o cliente.' using errcode='22023'; end if;
  if p_last_four is not null and p_last_four !~ '^[0-9]{4}$' then raise exception 'Informe somente os quatro últimos dígitos.' using errcode='22023'; end if;
  if p_points_per_unit is null or p_points_per_unit <= 0 then raise exception 'Regra de pontos inválida.' using errcode='22003'; end if;

  if p_card_id is null then
    insert into public.credit_cards(client_id, issuer, product_name, brand, last_four, linked_program_id, created_by)
    values(target_client, trim(p_issuer), trim(p_product_name), nullif(trim(coalesce(p_brand,'')),''), p_last_four, p_program_id, actor_id)
    returning * into card_row;
  else
    update public.credit_cards set issuer=trim(p_issuer), product_name=trim(p_product_name), brand=nullif(trim(coalesce(p_brand,'')),''), last_four=p_last_four, linked_program_id=p_program_id, updated_at=now()
    where id=p_card_id returning * into card_row;
  end if;

  insert into public.card_earning_rules(card_id, valid_from, basis, points_per_unit, description, created_by)
  values(card_row.id, current_date, p_basis, p_points_per_unit, nullif(trim(coalesce(p_rule_description,'')),''), actor_id);

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, card_row.client_id, 'upsert_credit_card', 'credit_cards', card_row.id::text, jsonb_build_object('issuer', card_row.issuer, 'productName', card_row.product_name, 'lastFour', card_row.last_four));

  return jsonb_build_object('cardId', card_row.id);
end;
$$;

create or replace function public.record_card_statement(
  p_card_id uuid,
  p_statement_month date,
  p_total_spend numeric,
  p_eligible_spend numeric,
  p_received_points numeric default 0,
  p_fx_rate numeric default null,
  p_fx_rate_date date default null,
  p_fx_source text default null,
  p_closing_on date default null,
  p_due_on date default null,
  p_notes text default null,
  p_operation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  card_row public.credit_cards%rowtype;
  rule_row public.card_earning_rules%rowtype;
  stmt_row public.card_statements%rowtype;
  month_value date := public.first_day(p_statement_month);
  expected numeric(16,2);
  status_value public.statement_status;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Você não possui permissão para faturas.' using errcode='42501'; end if;
  select * into card_row from public.credit_cards where id=p_card_id and active for update;
  if card_row.id is null then raise exception 'Cartão não encontrado.' using errcode='P0002'; end if;
  select * into rule_row from public.card_earning_rules where card_id=p_card_id and valid_from <= month_value and (valid_to is null or valid_to >= month_value) order by valid_from desc limit 1;
  if rule_row.id is null then raise exception 'Cadastre uma regra vigente para o cartão.' using errcode='P0002'; end if;
  if p_total_spend < 0 or p_eligible_spend < 0 or p_received_points < 0 or p_eligible_spend > p_total_spend then raise exception 'Valores da fatura inválidos.' using errcode='22003'; end if;
  if rule_row.basis = 'usd' and (p_fx_rate is null or p_fx_rate <= 0) then raise exception 'Informe a cotação para regra por dólar.' using errcode='22023'; end if;

  expected := round(case when rule_row.basis='brl' then p_eligible_spend * rule_row.points_per_unit else (p_eligible_spend / p_fx_rate) * rule_row.points_per_unit end, 2);
  status_value := case when p_received_points = 0 then 'calculated'::public.statement_status when p_received_points = expected then 'reconciled'::public.statement_status else 'divergent'::public.statement_status end;

  insert into public.card_statements(card_id, statement_month, total_spend, eligible_spend, earning_basis, earning_rate, fx_rate, received_points, status, notes, created_by, closing_on, due_on, currency, earning_rule_snapshot, fx_rate_date, fx_source, operation_id)
  values(p_card_id, month_value, round(p_total_spend,2), round(p_eligible_spend,2), rule_row.basis, rule_row.points_per_unit, p_fx_rate, round(coalesce(p_received_points,0),2), status_value, nullif(trim(coalesce(p_notes,'')),''), actor_id, p_closing_on, p_due_on, 'BRL', to_jsonb(rule_row)-array['created_at'], p_fx_rate_date, nullif(trim(coalesce(p_fx_source,'')),''), p_operation_id)
  on conflict (card_id, statement_month) do update set
    total_spend=excluded.total_spend, eligible_spend=excluded.eligible_spend, earning_basis=excluded.earning_basis, earning_rate=excluded.earning_rate, fx_rate=excluded.fx_rate, received_points=excluded.received_points, status=excluded.status, notes=excluded.notes, closing_on=excluded.closing_on, due_on=excluded.due_on, earning_rule_snapshot=excluded.earning_rule_snapshot, fx_rate_date=excluded.fx_rate_date, fx_source=excluded.fx_source, updated_at=now()
  returning * into stmt_row;

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, card_row.client_id, 'record_card_statement', 'card_statements', stmt_row.id::text, jsonb_build_object('statementMonth', stmt_row.statement_month, 'expectedPoints', stmt_row.expected_points, 'status', stmt_row.status));

  return jsonb_build_object('statementId', stmt_row.id, 'expectedPoints', stmt_row.expected_points, 'receivedPoints', stmt_row.received_points, 'difference', stmt_row.divergence, 'status', stmt_row.status);
end;
$$;

create or replace function public.get_card_statements(
  p_client_id uuid default null,
  p_card_id uuid default null,
  p_status text default 'all',
  p_start_month date default null,
  p_end_month date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  safe_offset integer := greatest(coalesce(p_offset,0),0);
  normalized_status text := nullif(lower(trim(coalesce(p_status,'all'))),'all');
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return (
    with filtered as materialized (
      select cs.*, cc.client_id, cc.issuer, cc.product_name, cc.brand, cc.last_four, c.full_name
      from public.card_statements cs
      join public.credit_cards cc on cc.id=cs.card_id
      join public.clients c on c.id=cc.client_id
      where (p_client_id is null or cc.client_id=p_client_id)
        and (p_card_id is null or cs.card_id=p_card_id)
        and (normalized_status is null or cs.status::text=normalized_status)
        and (p_start_month is null or cs.statement_month >= public.first_day(p_start_month))
        and (p_end_month is null or cs.statement_month <= public.first_day(p_end_month))
    ), paged as (select * from filtered order by statement_month desc, full_name limit safe_limit offset safe_offset)
    select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
      'statementId', p.id, 'clientId', p.client_id, 'clientName', p.full_name, 'cardId', p.card_id,
      'cardLabel', p.issuer || ' ' || p.product_name || ' final ' || p.last_four,
      'statementMonth', p.statement_month, 'totalSpend', p.total_spend, 'eligibleSpend', p.eligible_spend,
      'earningBasis', p.earning_basis, 'earningRate', p.earning_rate, 'fxRate', p.fx_rate,
      'fxRateDate', p.fx_rate_date, 'fxSource', p.fx_source, 'expectedPoints', p.expected_points,
      'receivedPoints', p.received_points, 'difference', p.divergence, 'status', p.status,
      'notes', p.notes, 'ruleSnapshot', p.earning_rule_snapshot
    ) order by p.statement_month desc, p.full_name) from paged p),'[]'::jsonb), 'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset)
  );
end;
$$;

create or replace function public.get_point_movements(
  p_client_id uuid default null,
  p_program_id uuid default null,
  p_source text default 'all',
  p_status text default 'all',
  p_start_date date default null,
  p_end_date date default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  safe_offset integer := greatest(coalesce(p_offset,0),0);
  normalized_source text := nullif(lower(trim(coalesce(p_source,'all'))),'all');
  normalized_status text := nullif(lower(trim(coalesce(p_status,'all'))),'all');
begin
  if auth.uid() is null then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if p_client_id is not null and not (public.is_staff() or public.has_client_access(p_client_id)) then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if p_client_id is null and not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;

  return (
    with filtered as materialized (
      select pt.*, pa.client_id, pa.program_id, c.full_name, lp.name as program_name, coalesce(pt.metadata->>'transferId', pt.metadata->>'redemptionId', pt.metadata->>'scheduledCreditId') as origin_id
      from public.point_transactions pt
      join public.program_accounts pa on pa.id=pt.account_id
      join public.clients c on c.id=pa.client_id
      join public.loyalty_programs lp on lp.id=pa.program_id
      where (p_client_id is null or pa.client_id=p_client_id)
        and (p_program_id is null or pa.program_id=p_program_id)
        and (normalized_source is null or pt.source=normalized_source)
        and (normalized_status is null or pt.status=normalized_status)
        and (p_start_date is null or pt.occurred_at::date >= p_start_date)
        and (p_end_date is null or pt.occurred_at::date <= p_end_date)
        and (public.is_staff() or public.has_client_access(pa.client_id))
    ), paged as (select * from filtered order by occurred_at desc, created_at desc limit safe_limit offset safe_offset)
    select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
      'transactionId', p.id, 'clientId', p.client_id, 'clientName', p.full_name, 'accountId', p.account_id,
      'programId', p.program_id, 'programName', p.program_name, 'occurredAt', p.occurred_at,
      'transactionType', p.transaction_type, 'direction', case when p.points_delta >= 0 then 'in' else 'out' end,
      'pointsDelta', p.points_delta, 'source', p.source, 'description', p.description,
      'status', p.status, 'originId', p.origin_id, 'createdBy', p.created_by, 'createdAt', p.created_at,
      'reversalOfTransactionId', p.reversal_of_transaction_id, 'correctionReason', p.correction_reason,
      'correctedBy', p.corrected_by, 'correctedAt', p.corrected_at
    ) order by p.occurred_at desc, p.created_at desc) from paged p),'[]'::jsonb), 'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset)
  );
end;
$$;

create or replace function public.void_point_transaction(
  p_transaction_id uuid,
  p_reason text,
  p_operation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  original public.point_transactions%rowtype;
  reversal public.point_transactions%rowtype;
  account_row public.program_accounts%rowtype;
  program_row public.loyalty_programs%rowtype;
  current_balance bigint := 0;
  current_average numeric(14,4) := 0;
begin
  if actor_id is null or not public.can_manage_security() then raise exception 'Somente gestores podem estornar movimentações.' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Informe o motivo do estorno.' using errcode='22023'; end if;
  select * into original from public.point_transactions where id=p_transaction_id for update;
  if original.id is null then raise exception 'Movimentação não encontrada.' using errcode='P0002'; end if;
  if original.status='voided' or original.reversal_of_transaction_id is not null then raise exception 'Movimentação já estornada.' using errcode='22023'; end if;
  if exists(select 1 from public.point_transactions pt where pt.reversal_of_transaction_id=original.id) then raise exception 'Movimentação já possui estorno.' using errcode='23505'; end if;

  select * into account_row from public.program_accounts where id=original.account_id for update;
  select * into program_row from public.loyalty_programs where id=account_row.program_id;
  select coalesce(bs.balance,0), coalesce(bs.average_cost_per_thousand,0) into current_balance, current_average from public.balance_snapshots bs where bs.account_id=account_row.id order by bs.captured_at desc,bs.id desc limit 1;
  if not found then current_balance := 0; current_average := 0; end if;
  if current_balance - original.points_delta < 0 then raise exception 'O estorno deixaria saldo negativo.' using errcode='23514'; end if;

  insert into public.point_transactions(account_id, occurred_at, transaction_type, points_delta, description, source, metadata, created_by, entry_date, operation_id, reversal_of_transaction_id, correction_reason)
  values(original.account_id, clock_timestamp(), 'adjustment', -original.points_delta, 'Estorno: ' || original.description, 'reversal', jsonb_build_object('originalTransactionId', original.id), actor_id, current_date, p_operation_id, original.id, trim(p_reason))
  returning * into reversal;

  update public.point_transactions set status='voided', correction_reason=trim(p_reason), corrected_by=actor_id, corrected_at=clock_timestamp()
  where id=original.id;

  insert into public.balance_snapshots(account_id, captured_at, balance, average_cost_per_thousand, value_per_thousand, source, notes, created_by)
  values(account_row.id, clock_timestamp(), current_balance - original.points_delta, current_average, program_row.default_value_per_thousand, 'reversal', trim(p_reason), actor_id);

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, old_data, new_data)
  values(actor_id, account_row.client_id, 'void_point_transaction', 'point_transactions', original.id::text, jsonb_build_object('pointsDelta', original.points_delta), jsonb_build_object('reversalId', reversal.id, 'reason', trim(p_reason)));

  return jsonb_build_object('transactionId', original.id, 'reversalTransactionId', reversal.id);
end;
$$;

create or replace function public.create_client_direct_access_link(
  p_client_id uuid,
  p_expires_at timestamptz default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash text := encode(extensions.digest(token, 'sha256'), 'hex');
  link_row public.client_direct_access_links%rowtype;
begin
  if actor_id is null or not public.can_manage_security() then raise exception 'Somente gestores podem gerar links.' using errcode='42501'; end if;
  if not exists(select 1 from public.clients c where c.id=p_client_id and c.status='active') then raise exception 'Cliente ativo não encontrado.' using errcode='P0002'; end if;

  update public.client_direct_access_links set status='revoked', revoked_at=clock_timestamp(), revoked_by=actor_id
  where client_id=p_client_id and status='active';

  insert into public.client_direct_access_links(client_id, token_hash, expires_at, notes, created_by)
  values(p_client_id, token_hash, p_expires_at, nullif(trim(coalesce(p_notes,'')),''), actor_id)
  returning * into link_row;

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, p_client_id, 'create_direct_access_link', 'client_direct_access_links', link_row.id::text, jsonb_build_object('expiresAt', p_expires_at));

  return jsonb_build_object('linkId', link_row.id, 'token', token, 'path', '/c/link/' || token, 'expiresAt', p_expires_at);
end;
$$;

create or replace function public.revoke_client_direct_access_link(
  p_link_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  link_row public.client_direct_access_links%rowtype;
begin
  if actor_id is null or not public.can_manage_security() then raise exception 'Somente gestores podem revogar links.' using errcode='42501'; end if;
  update public.client_direct_access_links set status='revoked', revoked_at=clock_timestamp(), revoked_by=actor_id, notes=coalesce(nullif(trim(coalesce(p_reason,'')),''), notes)
  where id=p_link_id returning * into link_row;
  if link_row.id is null then raise exception 'Link não encontrado.' using errcode='P0002'; end if;
  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, link_row.client_id, 'revoke_direct_access_link', 'client_direct_access_links', link_row.id::text, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('linkId', link_row.id, 'status', link_row.status);
end;
$$;

create or replace function public.get_client_direct_access_links(
  p_client_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
    'linkId', l.id, 'clientId', l.client_id, 'clientName', c.full_name, 'status', l.status, 'expiresAt', l.expires_at,
    'lastUsedAt', l.last_used_at, 'useCount', l.use_count, 'createdAt', l.created_at, 'revokedAt', l.revoked_at
  ) order by l.created_at desc) from public.client_direct_access_links l join public.clients c on c.id=l.client_id where p_client_id is null or l.client_id=p_client_id),'[]'::jsonb));
end;
$$;

create or replace function public.get_my_client_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  target_public_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Acesso não autorizado' using errcode='42501';
  end if;

  select c.public_id into target_public_id
  from public.client_users cu
  join public.clients c on c.id = cu.client_id
  where cu.user_id = auth.uid()
    and cu.active
    and c.status = 'active'
  order by cu.created_at desc
  limit 1;

  if target_public_id is null then
    raise exception 'Acesso não autorizado' using errcode='42501';
  end if;

  return public.get_client_dashboard(target_public_id);
end;
$$;

do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'loyalty_club_plans','loyalty_club_plan_benefits','loyalty_status_tiers',
    'client_club_subscriptions','scheduled_point_credits','client_direct_access_links','client_direct_access_events'
  ] loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I force row level security', relation_name);
  end loop;
end $$;

revoke all on public.loyalty_club_plans, public.loyalty_club_plan_benefits, public.loyalty_status_tiers, public.client_club_subscriptions, public.scheduled_point_credits, public.client_direct_access_links, public.client_direct_access_events from anon;
grant select on public.loyalty_club_plans, public.loyalty_club_plan_benefits, public.loyalty_status_tiers to authenticated;
grant select on public.client_club_subscriptions, public.scheduled_point_credits, public.client_direct_access_links to authenticated;
grant insert on public.client_direct_access_events to authenticated;
grant all on public.loyalty_club_plans, public.loyalty_club_plan_benefits, public.loyalty_status_tiers, public.client_club_subscriptions, public.scheduled_point_credits, public.client_direct_access_links, public.client_direct_access_events to service_role;

drop policy if exists club_catalog_read on public.loyalty_club_plans;
create policy club_catalog_read on public.loyalty_club_plans for select to authenticated using (public.is_staff() or exists(select 1 from public.client_users cu where cu.user_id=auth.uid() and cu.active));
drop policy if exists club_benefits_read on public.loyalty_club_plan_benefits;
create policy club_benefits_read on public.loyalty_club_plan_benefits for select to authenticated using (exists(select 1 from public.loyalty_club_plans p where p.id=plan_id));
drop policy if exists status_tiers_read on public.loyalty_status_tiers;
create policy status_tiers_read on public.loyalty_status_tiers for select to authenticated using (public.is_staff() or exists(select 1 from public.client_users cu where cu.user_id=auth.uid() and cu.active));
drop policy if exists subscriptions_read on public.client_club_subscriptions;
create policy subscriptions_read on public.client_club_subscriptions for select to authenticated using (public.is_staff() or public.has_client_access(client_id));
drop policy if exists credits_read on public.scheduled_point_credits;
create policy credits_read on public.scheduled_point_credits for select to authenticated using (exists(select 1 from public.client_club_subscriptions s where s.id=subscription_id and (public.is_staff() or public.has_client_access(s.client_id))));
drop policy if exists direct_links_staff_read on public.client_direct_access_links;
create policy direct_links_staff_read on public.client_direct_access_links for select to authenticated using (public.is_staff());

revoke all on function public.get_club_catalog(uuid, boolean) from public, anon;
revoke all on function public.upsert_client_club_subscription(uuid, uuid, uuid, uuid, public.club_subscription_status, date, date, smallint, date, text) from public, anon;
revoke all on function public.get_client_club_subscriptions(uuid, text, integer, integer) from public, anon;
revoke all on function public.confirm_scheduled_point_credit(uuid, uuid) from public, anon;
revoke all on function public.get_card_statement_options() from public, anon;
revoke all on function public.upsert_credit_card(uuid, uuid, text, text, text, text, uuid, public.earning_basis, numeric, text) from public, anon;
revoke all on function public.record_card_statement(uuid, date, numeric, numeric, numeric, numeric, date, text, date, date, text, uuid) from public, anon;
revoke all on function public.get_card_statements(uuid, uuid, text, date, date, integer, integer) from public, anon;
revoke all on function public.get_point_movements(uuid, uuid, text, text, date, date, integer, integer) from public, anon;
revoke all on function public.void_point_transaction(uuid, text, uuid) from public, anon;
revoke all on function public.create_client_direct_access_link(uuid, timestamptz, text) from public, anon;
revoke all on function public.revoke_client_direct_access_link(uuid, text) from public, anon;
revoke all on function public.get_client_direct_access_links(uuid) from public, anon;
revoke all on function public.get_my_client_dashboard() from public, anon;

grant execute on function public.get_club_catalog(uuid, boolean), public.get_client_club_subscriptions(uuid, text, integer, integer), public.get_card_statements(uuid, uuid, text, date, date, integer, integer), public.get_point_movements(uuid, uuid, text, text, date, date, integer, integer) to authenticated;
grant execute on function public.upsert_client_club_subscription(uuid, uuid, uuid, uuid, public.club_subscription_status, date, date, smallint, date, text), public.confirm_scheduled_point_credit(uuid, uuid), public.get_card_statement_options(), public.upsert_credit_card(uuid, uuid, text, text, text, text, uuid, public.earning_basis, numeric, text), public.record_card_statement(uuid, date, numeric, numeric, numeric, numeric, date, text, date, date, text, uuid), public.void_point_transaction(uuid, text, uuid), public.create_client_direct_access_link(uuid, timestamptz, text), public.revoke_client_direct_access_link(uuid, text), public.get_client_direct_access_links(uuid) to authenticated;
grant execute on function public.get_my_client_dashboard() to authenticated;

insert into public.loyalty_club_plans(program_id, stable_code, name, monthly_points, qualifying_points, billing_period, points_validity_months, points_do_not_expire, informative_price, currency, status, source_url, source_verified_on, source_notes)
select lp.id, v.stable_code, v.name, v.monthly_points, v.qualifying_points, 'monthly', v.validity_months, v.no_expire, v.price, 'BRL', v.status, v.source_url, date '2026-07-16', v.notes
from (values
  ('azul_fidelidade','azul_1000','Clube Azul 1.000',1000,0,24,false,null,'active','https://www.voeazul.com.br/br/pt/programa-fidelidade/clube-azul','Fonte oficial carregada sem texto completo pelo extrator; revisar antes de decisões comerciais.'),
  ('azul_fidelidade','azul_2000','Clube Azul 2.000',2000,0,24,false,null,'active','https://www.voeazul.com.br/br/pt/programa-fidelidade/clube-azul','Fonte oficial carregada sem texto completo pelo extrator; revisar antes de decisões comerciais.'),
  ('azul_fidelidade','azul_5000','Clube Azul 5.000',5000,0,24,false,null,'active','https://www.voeazul.com.br/br/pt/programa-fidelidade/clube-azul','Fonte oficial carregada sem texto completo pelo extrator; revisar antes de decisões comerciais.'),
  ('azul_fidelidade','azul_10000','Clube Azul 10.000',10000,0,24,false,null,'active','https://www.voeazul.com.br/br/pt/programa-fidelidade/clube-azul','Fonte oficial carregada sem texto completo pelo extrator; revisar antes de decisões comerciais.'),
  ('smiles','smiles_1000','Clube Smiles 1.000',1000,100,120,false,null,'active','https://www.smiles.com.br/clube-smiles/beneficios-clube','Planos e benefícios variam por campanha; revisar antes de contratar.'),
  ('smiles','smiles_2000','Clube Smiles 2.000',2000,200,120,false,null,'active','https://www.smiles.com.br/clube-smiles/beneficios-clube','Planos e benefícios variam por campanha; revisar antes de contratar.'),
  ('smiles','smiles_5000','Clube Smiles 5.000',5000,500,120,false,null,'active','https://www.smiles.com.br/clube-smiles/beneficios-clube','Planos e benefícios variam por campanha; revisar antes de contratar.'),
  ('smiles','smiles_7000','Clube Smiles 7.000',7000,700,null,true,null,'active','https://www.smiles.com.br/clube-smiles/beneficios-clube','Milhas recorrentes sem expiração conforme material vigente.'),
  ('smiles','smiles_10000','Clube Smiles 10.000',10000,1000,null,true,null,'active','https://www.smiles.com.br/clube-smiles/beneficios-clube','Milhas recorrentes sem expiração conforme material vigente.'),
  ('smiles','smiles_20000','Clube Smiles 20.000',20000,2000,null,true,null,'active','https://www.smiles.com.br/clube-smiles/beneficios-clube','Pode conceder categoria Diamante enquanto ativo/adimplente.'),
  ('latam_pass','latam_base','Clube Base',1000,0,36,false,null,'active','https://latampass.latam.com/pt_br/clube/precos-e-planos','Sem cartão LATAM Pass Itaú.'),
  ('latam_pass','latam_base_mais','Clube Base + Mais',2000,0,36,false,null,'active','https://latampass.latam.com/pt_br/clube/precos-e-planos','Sem cartão LATAM Pass Itaú.'),
  ('latam_pass','latam_base_embarque','Clube Base + Embarque',1000,500,48,false,null,'active','https://latampass.latam.com/pt_br/clube/precos-e-planos','Sem cartão LATAM Pass Itaú.'),
  ('latam_pass','latam_base_acelere','Clube Base + Acelere',5000,0,60,false,null,'active','https://latampass.latam.com/pt_br/clube/precos-e-planos','Elegível a categoria Gold conforme regras oficiais.'),
  ('latam_pass','latam_base_turbo','Clube Base + Turbo',10000,0,84,false,356.80,'active','https://latampass.latam.com/pt_br/clube/precos-e-planos','Elegível a categoria Gold conforme regras oficiais.'),
  ('livelo','livelo_classic','Clube Classic',1000,0,null,true,null,'active','https://www.livelo.com.br/clube','Pontos sem expiração enquanto assinante conforme material oficial.'),
  ('livelo','livelo_special','Clube Special',2000,0,null,true,null,'active','https://www.livelo.com.br/clube','Bônus trimestral no primeiro ano exibido como benefício.'),
  ('livelo','livelo_plus','Clube Plus',3000,0,null,true,null,'active','https://www.livelo.com.br/clube','Bônus trimestral no primeiro ano exibido como benefício.'),
  ('livelo','livelo_super','Clube Super',7000,0,null,true,null,'active','https://www.livelo.com.br/clube','Bônus trimestral no primeiro ano exibido como benefício.'),
  ('livelo','livelo_mega','Clube Mega',12000,0,null,true,null,'active','https://www.livelo.com.br/clube','Bônus trimestral no primeiro ano exibido como benefício.'),
  ('livelo','livelo_top','Clube Top',20000,0,null,true,799.90,'active','https://www.livelo.com.br/clube','Bônus trimestral de 10.000 pontos no primeiro ano exibido pela fonte.'),
  ('livelo','livelo_mini','Clube Mini anual',500,0,null,true,null,'informational','https://www.livelo.com.br/clube','Edição limitada; disponibilidade condicional.')
) as v(program_slug, stable_code, name, monthly_points, qualifying_points, validity_months, no_expire, price, status, source_url, notes)
join public.loyalty_programs lp on lp.slug = v.program_slug
on conflict(program_id, stable_code) do update set
  name=excluded.name, monthly_points=excluded.monthly_points, qualifying_points=excluded.qualifying_points,
  points_validity_months=excluded.points_validity_months, points_do_not_expire=excluded.points_do_not_expire,
  informative_price=excluded.informative_price, status=excluded.status, source_url=excluded.source_url,
  source_verified_on=excluded.source_verified_on, source_notes=excluded.source_notes, updated_at=now();

insert into public.loyalty_club_plan_benefits(plan_id, benefit_type, title, description, numeric_value, unit, rule, display_order)
select p.id, 'catalog', 'Pontos mensais', 'Quantidade mensal de pontos/milhas informada no catálogo versionado.', p.monthly_points, 'points', jsonb_build_object('monthlyPoints', p.monthly_points), 1
from public.loyalty_club_plans p
on conflict do nothing;

insert into public.loyalty_status_tiers(program_id, name, requirements, benefits_description, source_url, source_verified_on)
select lp.id, v.name, v.requirements::jsonb, v.description, v.source_url, date '2026-07-16'
from (values
  ('azul_fidelidade','Safira','{"source":"club_benefit"}','Categoria citada como benefício em planos selecionados; revisar regra oficial vigente.','https://www.voeazul.com.br/br/pt/programa-fidelidade/clube-azul'),
  ('smiles','Diamante','{"source":"club_20000_active"}','Categoria pode ser concedida pelo Clube Smiles 20.000 enquanto ativo e adimplente.','https://www.smiles.com.br/clube-smiles/beneficios-clube'),
  ('latam_pass','Gold','{"source":"boosters_acelere_turbo_embarque"}','Boosters Acelere, Turbo e Embarque elegível podem conceder categoria Gold conforme condições oficiais.','https://latampass.latam.com/pt_br/clube/precos-e-planos')
) as v(program_slug, name, requirements, description, source_url)
join public.loyalty_programs lp on lp.slug = v.program_slug
on conflict(program_id, name, valid_from) do nothing;

notify pgrst, 'reload schema';
