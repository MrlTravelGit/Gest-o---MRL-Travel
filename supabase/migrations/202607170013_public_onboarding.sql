-- PATCH MRL 0.4.5 / 011
-- Onboarding publico por link unico, sem sessao Supabase do cliente.

create table if not exists public.client_onboarding_forms (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'pending',
  token_hash text not null unique,
  token_hint text,
  expires_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  form_version text not null default '2026-07-17',
  draft_payload jsonb not null default '{}'::jsonb,
  notes text,
  constraint onboarding_form_status_valid check (status in ('pending','in_progress','submitted','expired','revoked','reopened')),
  constraint onboarding_token_hash_length check (char_length(token_hash) = 64),
  constraint onboarding_token_hint_safe check (token_hint is null or char_length(token_hint) between 4 and 16)
);

create unique index if not exists client_onboarding_forms_one_active_idx
  on public.client_onboarding_forms(client_id)
  where status in ('pending','in_progress','reopened');

create index if not exists client_onboarding_forms_client_status_idx
  on public.client_onboarding_forms(client_id, status, created_at desc);

create table if not exists public.client_onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null unique references public.client_onboarding_forms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  form_version text not null,
  source text not null default 'onboarding',
  full_name text not null,
  full_name_diverges boolean not null default false,
  cpf_encrypted text,
  cpf_hash text,
  cpf_last4 text,
  rg_encrypted text,
  rg_hash text,
  rg_display_encrypted text,
  birth_date date not null,
  email text not null,
  whatsapp_e164 text not null,
  marital_status text not null,
  postal_code text,
  state text,
  city text,
  neighborhood text,
  street text,
  address_number text,
  address_complement text,
  has_children boolean not null default false,
  children_count integer,
  children_notes text,
  profession text,
  business_sector text,
  preferred_contact_period text,
  preferred_contact_time text,
  referral_source text,
  referral_other text,
  best_bank text,
  pf_monthly_spend numeric(14,2) not null default 0,
  has_pj_card boolean not null default false,
  pj_monthly_spend numeric(14,2) not null default 0,
  vip_lounge_interest text,
  uber_monthly_spend numeric(14,2) not null default 0,
  ifood_monthly_spend numeric(14,2) not null default 0,
  fuel_monthly_spend numeric(14,2) not null default 0,
  preferred_airports text[] not null default '{}',
  domestic_trips_12m integer not null default 0,
  international_trips_12m integer not null default 0,
  has_planned_trip boolean not null default false,
  frequent_national_destinations text[] not null default '{}',
  desired_destinations text[] not null default '{}',
  free_months text[] not null default '{}',
  business_class_interest text,
  seat_priority text,
  preferred_seat text,
  all_inclusive_interest text,
  previous_ticket_purchase_methods text[] not null default '{}',
  expectation_priorities text[] not null default '{}',
  service_expectations text not null,
  privacy_acknowledged boolean not null default false,
  marketing_consent boolean not null default false,
  response_snapshot jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint onboarding_children_count_valid check (children_count is null or children_count >= 0),
  constraint onboarding_trip_counts_valid check (domestic_trips_12m >= 0 and international_trips_12m >= 0),
  constraint onboarding_money_nonnegative check (pf_monthly_spend >= 0 and pj_monthly_spend >= 0 and uber_monthly_spend >= 0 and ifood_monthly_spend >= 0 and fuel_monthly_spend >= 0),
  constraint onboarding_privacy_ack_required check (privacy_acknowledged)
);

create index if not exists client_onboarding_submissions_client_idx
  on public.client_onboarding_submissions(client_id, submitted_at desc);

create table if not exists public.client_onboarding_cards (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.client_onboarding_submissions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  card_kind text not null,
  bank_name text not null,
  card_brand text not null,
  product_name text not null,
  pays_annual_fee boolean,
  annual_fee_monthly numeric(14,2),
  created_at timestamptz not null default now(),
  constraint onboarding_card_kind_valid check (card_kind in ('pf','pj')),
  constraint onboarding_card_fee_valid check (annual_fee_monthly is null or annual_fee_monthly >= 0)
);

create index if not exists client_onboarding_cards_submission_idx
  on public.client_onboarding_cards(submission_id, card_kind);

create table if not exists public.client_onboarding_loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.client_onboarding_submissions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  program_name text not null,
  has_account boolean not null default false,
  declared_points bigint not null default 0,
  notes text,
  review_status text not null default 'pending_review',
  created_at timestamptz not null default now(),
  constraint onboarding_declared_points_valid check (declared_points >= 0),
  constraint onboarding_loyalty_review_status_valid check (review_status in ('pending_review','confirmed','ignored'))
);

create index if not exists client_onboarding_loyalty_submission_idx
  on public.client_onboarding_loyalty_accounts(submission_id);

create table if not exists public.client_onboarding_planned_trips (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.client_onboarding_submissions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  destination text not null,
  approximate_date text,
  notes text,
  travel_interest_id uuid references public.travel_interests(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists client_onboarding_planned_trips_unique_idx
  on public.client_onboarding_planned_trips(submission_id, lower(destination));

create table if not exists public.client_onboarding_divergences (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.client_onboarding_submissions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  field_name text not null,
  current_value text,
  declared_value text,
  status text not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint onboarding_divergence_status_valid check (status in ('pending','applied','kept'))
);

create index if not exists client_onboarding_divergences_submission_idx
  on public.client_onboarding_divergences(submission_id, status);

create table if not exists public.client_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  form_id uuid references public.client_onboarding_forms(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  fingerprint_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint onboarding_event_type_valid check (event_type in ('created','rotated','revoked','reopened','metadata','draft_saved','submitted','already_submitted','invalid','expired','rate_limited','submit_failed','draft_failed'))
);

create index if not exists client_onboarding_events_form_idx
  on public.client_onboarding_events(form_id, created_at desc);

create trigger client_onboarding_forms_set_updated_at before update on public.client_onboarding_forms
for each row execute function public.set_updated_at();

create trigger client_onboarding_submissions_set_updated_at before update on public.client_onboarding_submissions
for each row execute function public.set_updated_at();

alter table public.client_onboarding_forms enable row level security;
alter table public.client_onboarding_forms force row level security;
alter table public.client_onboarding_submissions enable row level security;
alter table public.client_onboarding_submissions force row level security;
alter table public.client_onboarding_cards enable row level security;
alter table public.client_onboarding_cards force row level security;
alter table public.client_onboarding_loyalty_accounts enable row level security;
alter table public.client_onboarding_loyalty_accounts force row level security;
alter table public.client_onboarding_planned_trips enable row level security;
alter table public.client_onboarding_planned_trips force row level security;
alter table public.client_onboarding_divergences enable row level security;
alter table public.client_onboarding_divergences force row level security;
alter table public.client_onboarding_events enable row level security;
alter table public.client_onboarding_events force row level security;

revoke all on public.client_onboarding_forms, public.client_onboarding_submissions, public.client_onboarding_cards,
  public.client_onboarding_loyalty_accounts, public.client_onboarding_planned_trips, public.client_onboarding_divergences,
  public.client_onboarding_events from anon, authenticated;

grant select on public.client_onboarding_forms, public.client_onboarding_submissions, public.client_onboarding_cards,
  public.client_onboarding_loyalty_accounts, public.client_onboarding_planned_trips, public.client_onboarding_divergences,
  public.client_onboarding_events to authenticated;

grant all on public.client_onboarding_forms, public.client_onboarding_submissions, public.client_onboarding_cards,
  public.client_onboarding_loyalty_accounts, public.client_onboarding_planned_trips, public.client_onboarding_divergences,
  public.client_onboarding_events to service_role;

create policy onboarding_forms_staff_read on public.client_onboarding_forms for select to authenticated using (public.is_staff());
create policy onboarding_submissions_staff_read on public.client_onboarding_submissions for select to authenticated using (public.is_staff());
create policy onboarding_cards_staff_read on public.client_onboarding_cards for select to authenticated using (public.is_staff());
create policy onboarding_loyalty_staff_read on public.client_onboarding_loyalty_accounts for select to authenticated using (public.is_staff());
create policy onboarding_trips_staff_read on public.client_onboarding_planned_trips for select to authenticated using (public.is_staff());
create policy onboarding_divergences_staff_read on public.client_onboarding_divergences for select to authenticated using (public.is_staff());
create policy onboarding_events_staff_read on public.client_onboarding_events for select to authenticated using (public.is_staff());

create or replace function public.onboarding_form_status(p_status text, p_expires_at timestamptz)
returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when p_status in ('pending','in_progress','reopened') and p_expires_at is not null and p_expires_at < now() then 'expired'
    else p_status
  end
$$;

create or replace function public.create_client_onboarding_form(
  p_client_id uuid,
  p_expires_at timestamptz default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash text := encode(extensions.digest(token, 'sha256'), 'hex');
  form_row public.client_onboarding_forms%rowtype;
begin
  if actor_id is null or not public.can_manage_security() then
    raise exception 'Somente gestores podem gerar formulários.' using errcode = '42501';
  end if;

  if not exists(select 1 from public.clients c where c.id = p_client_id and c.status = 'active') then
    raise exception 'Cliente ativo não encontrado.' using errcode = 'P0002';
  end if;

  update public.client_onboarding_forms
     set status = 'revoked',
         revoked_at = clock_timestamp(),
         revoked_by = actor_id
   where client_id = p_client_id
     and status in ('pending','in_progress','reopened');

  insert into public.client_onboarding_forms(client_id, status, token_hash, token_hint, expires_at, created_by, notes)
  values(p_client_id, 'pending', token_hash, right(token, 6), coalesce(p_expires_at, now() + interval '30 days'), actor_id, nullif(trim(coalesce(p_notes,'')), ''))
  returning * into form_row;

  insert into public.client_onboarding_events(form_id, client_id, event_type, actor_user_id)
  values(form_row.id, p_client_id, 'created', actor_id);

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, p_client_id, 'create_onboarding_form', 'client_onboarding_forms', form_row.id::text, jsonb_build_object('expiresAt', form_row.expires_at, 'formVersion', form_row.form_version));

  return jsonb_build_object('formId', form_row.id, 'token', token, 'path', '/onboarding/' || token, 'expiresAt', form_row.expires_at);
end;
$$;

create or replace function public.revoke_client_onboarding_form(p_form_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  form_row public.client_onboarding_forms%rowtype;
begin
  if actor_id is null or not public.can_manage_security() then
    raise exception 'Somente gestores podem revogar formulários.' using errcode = '42501';
  end if;

  update public.client_onboarding_forms
     set status = 'revoked',
         revoked_at = clock_timestamp(),
         revoked_by = actor_id,
         notes = coalesce(nullif(trim(coalesce(p_reason,'')), ''), notes)
   where id = p_form_id
     and status <> 'revoked'
   returning * into form_row;

  if form_row.id is null then
    raise exception 'Formulário não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.client_onboarding_events(form_id, client_id, event_type, actor_user_id)
  values(form_row.id, form_row.client_id, 'revoked', actor_id);

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, form_row.client_id, 'revoke_onboarding_form', 'client_onboarding_forms', form_row.id::text, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('formId', form_row.id, 'status', form_row.status);
end;
$$;

create or replace function public.reopen_client_onboarding_form(p_form_id uuid, p_expires_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  form_row public.client_onboarding_forms%rowtype;
begin
  if actor_id is null or not public.can_manage_security() then
    raise exception 'Somente gestores podem reabrir formulários.' using errcode = '42501';
  end if;

  update public.client_onboarding_forms
     set status = 'reopened',
         expires_at = coalesce(p_expires_at, now() + interval '30 days'),
         submitted_at = null
   where id = p_form_id
   returning * into form_row;

  if form_row.id is null then
    raise exception 'Formulário não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.client_onboarding_events(form_id, client_id, event_type, actor_user_id)
  values(form_row.id, form_row.client_id, 'reopened', actor_id);

  return jsonb_build_object('formId', form_row.id, 'status', form_row.status);
end;
$$;

create or replace function public.get_client_onboarding_forms(
  p_search text default null,
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized text := nullif(trim(coalesce(p_search, '')), '');
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  return (
    with filtered as materialized (
      select f.*, c.full_name, public.onboarding_form_status(f.status, f.expires_at) as effective_status,
        s.id as submission_id
      from public.client_onboarding_forms f
      join public.clients c on c.id = f.client_id
      left join public.client_onboarding_submissions s on s.form_id = f.id
      where (normalized is null or c.full_name ilike '%' || normalized || '%')
        and (nullif(p_status, '') is null or public.onboarding_form_status(f.status, f.expires_at) = p_status)
    ), paged as (
      select * from filtered order by created_at desc limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'formId', id,
        'clientId', client_id,
        'clientName', full_name,
        'status', effective_status,
        'expiresAt', expires_at,
        'startedAt', started_at,
        'submittedAt', submitted_at,
        'createdAt', created_at,
        'tokenHint', token_hint,
        'submissionId', submission_id
      ) order by created_at desc), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'limit', safe_limit,
      'offset', safe_offset,
      'summary', jsonb_build_object(
        'pending', (select count(*) from filtered where effective_status = 'pending'),
        'inProgress', (select count(*) from filtered where effective_status in ('in_progress','reopened')),
        'submitted', (select count(*) from filtered where effective_status = 'submitted'),
        'expired', (select count(*) from filtered where effective_status = 'expired')
      )
    ) from paged
  );
end;
$$;

create or replace function public.get_client_onboarding_detail(p_form_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  form_row record;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  select f.*, c.full_name into form_row
  from public.client_onboarding_forms f
  join public.clients c on c.id = f.client_id
  where f.id = p_form_id;

  if form_row.id is null then
    raise exception 'Formulário não encontrado.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'form', jsonb_build_object(
      'formId', form_row.id,
      'clientId', form_row.client_id,
      'clientName', form_row.full_name,
      'status', public.onboarding_form_status(form_row.status, form_row.expires_at),
      'expiresAt', form_row.expires_at,
      'startedAt', form_row.started_at,
      'submittedAt', form_row.submitted_at,
      'createdAt', form_row.created_at,
      'tokenHint', form_row.token_hint
    ),
    'submission', (select to_jsonb(s) - array['cpf_encrypted','rg_encrypted','rg_display_encrypted','response_snapshot'] from public.client_onboarding_submissions s where s.form_id = p_form_id),
    'cards', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.client_onboarding_cards c join public.client_onboarding_submissions s on s.id = c.submission_id where s.form_id = p_form_id), '[]'::jsonb),
    'loyaltyAccounts', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.client_onboarding_loyalty_accounts l join public.client_onboarding_submissions s on s.id = l.submission_id where s.form_id = p_form_id), '[]'::jsonb),
    'plannedTrips', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.client_onboarding_planned_trips t join public.client_onboarding_submissions s on s.id = t.submission_id where s.form_id = p_form_id), '[]'::jsonb),
    'divergences', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.client_onboarding_divergences d join public.client_onboarding_submissions s on s.id = d.submission_id where s.form_id = p_form_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('eventType', e.event_type, 'createdAt', e.created_at) order by e.created_at desc) from public.client_onboarding_events e where e.form_id = p_form_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.resolve_onboarding_form_by_hash(p_token_hash text, p_event_type text default 'metadata', p_fingerprint_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  form_row public.client_onboarding_forms%rowtype;
  client_name text;
  effective_status text;
begin
  select * into form_row from public.client_onboarding_forms where token_hash = p_token_hash;

  if form_row.id is null then
    insert into public.client_onboarding_events(event_type, fingerprint_hash) values('invalid', p_fingerprint_hash);
    return jsonb_build_object('ok', false, 'code', 'LINK_NOT_FOUND');
  end if;

  effective_status := public.onboarding_form_status(form_row.status, form_row.expires_at);

  if effective_status = 'expired' and form_row.status <> 'expired' then
    update public.client_onboarding_forms set status = 'expired' where id = form_row.id;
  end if;

  insert into public.client_onboarding_events(form_id, client_id, event_type, fingerprint_hash)
  values(form_row.id, form_row.client_id, coalesce(nullif(p_event_type, ''), 'metadata'), p_fingerprint_hash);

  select full_name into client_name from public.clients where id = form_row.client_id;

  return jsonb_build_object(
    'ok', effective_status in ('pending','in_progress','reopened','submitted'),
    'code', case when effective_status in ('pending','in_progress','reopened','submitted') then 'OK' else upper(effective_status) end,
    'formId', form_row.id,
    'clientDisplayName', client_name,
    'status', effective_status,
    'expiresAt', form_row.expires_at,
    'submittedAt', form_row.submitted_at,
    'formVersion', form_row.form_version,
    'draft', case when effective_status = 'submitted' then '{}'::jsonb else form_row.draft_payload end
  );
end;
$$;

create or replace function public.save_onboarding_draft_by_hash(p_token_hash text, p_payload jsonb, p_fingerprint_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  form_row public.client_onboarding_forms%rowtype;
  effective_status text;
begin
  select * into form_row from public.client_onboarding_forms where token_hash = p_token_hash for update;
  if form_row.id is null then
    insert into public.client_onboarding_events(event_type, fingerprint_hash) values('invalid', p_fingerprint_hash);
    return jsonb_build_object('ok', false, 'code', 'LINK_NOT_FOUND');
  end if;

  effective_status := public.onboarding_form_status(form_row.status, form_row.expires_at);
  if effective_status not in ('pending','in_progress','reopened') then
    insert into public.client_onboarding_events(form_id, client_id, event_type, fingerprint_hash) values(form_row.id, form_row.client_id, 'draft_failed', p_fingerprint_hash);
    return jsonb_build_object('ok', false, 'code', upper(effective_status));
  end if;

  update public.client_onboarding_forms
     set status = 'in_progress',
         started_at = coalesce(started_at, clock_timestamp()),
         draft_payload = coalesce(p_payload, '{}'::jsonb)
   where id = form_row.id;

  insert into public.client_onboarding_events(form_id, client_id, event_type, fingerprint_hash)
  values(form_row.id, form_row.client_id, 'draft_saved', p_fingerprint_hash);

  return jsonb_build_object('ok', true, 'status', 'in_progress');
end;
$$;

create or replace function public.submit_onboarding_by_hash(p_token_hash text, p_payload jsonb, p_secure jsonb, p_fingerprint_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  form_row public.client_onboarding_forms%rowtype;
  client_row public.clients%rowtype;
  submission_row public.client_onboarding_submissions%rowtype;
  effective_status text;
  item jsonb;
  declared_full_name text := trim(coalesce(p_payload #>> '{personal,fullName}', ''));
  normalized_email text := lower(trim(coalesce(p_payload #>> '{personal,email}', '')));
  normalized_phone text := trim(coalesce(p_payload #>> '{personal,whatsappE164}', ''));
begin
  select * into form_row from public.client_onboarding_forms where token_hash = p_token_hash for update;
  if form_row.id is null then
    insert into public.client_onboarding_events(event_type, fingerprint_hash) values('invalid', p_fingerprint_hash);
    return jsonb_build_object('ok', false, 'code', 'LINK_NOT_FOUND');
  end if;

  effective_status := public.onboarding_form_status(form_row.status, form_row.expires_at);
  if effective_status = 'submitted' then
    select * into submission_row from public.client_onboarding_submissions where form_id = form_row.id;
    insert into public.client_onboarding_events(form_id, client_id, event_type, fingerprint_hash) values(form_row.id, form_row.client_id, 'already_submitted', p_fingerprint_hash);
    return jsonb_build_object('ok', true, 'status', 'submitted', 'submissionId', submission_row.id, 'alreadySubmitted', true);
  end if;
  if effective_status not in ('pending','in_progress','reopened') then
    insert into public.client_onboarding_events(form_id, client_id, event_type, fingerprint_hash) values(form_row.id, form_row.client_id, 'submit_failed', p_fingerprint_hash);
    return jsonb_build_object('ok', false, 'code', upper(effective_status));
  end if;

  select * into client_row from public.clients where id = form_row.client_id for update;
  if client_row.id is null or client_row.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'CLIENT_INACTIVE');
  end if;

  insert into public.client_onboarding_submissions(
    form_id, client_id, form_version, full_name, full_name_diverges,
    cpf_encrypted, cpf_hash, cpf_last4, rg_encrypted, rg_hash, rg_display_encrypted,
    birth_date, email, whatsapp_e164, marital_status,
    postal_code, state, city, neighborhood, street, address_number, address_complement,
    has_children, children_count, children_notes, profession, business_sector,
    preferred_contact_period, preferred_contact_time, referral_source, referral_other,
    best_bank, pf_monthly_spend, has_pj_card, pj_monthly_spend, vip_lounge_interest,
    uber_monthly_spend, ifood_monthly_spend, fuel_monthly_spend,
    preferred_airports, domestic_trips_12m, international_trips_12m, has_planned_trip,
    frequent_national_destinations, desired_destinations, free_months, business_class_interest,
    seat_priority, preferred_seat, all_inclusive_interest, previous_ticket_purchase_methods,
    expectation_priorities, service_expectations, privacy_acknowledged, marketing_consent, response_snapshot
  ) values (
    form_row.id, form_row.client_id, form_row.form_version, declared_full_name,
    lower(trim(client_row.full_name)) <> lower(declared_full_name),
    p_secure->>'cpfEncrypted', p_secure->>'cpfHash', p_secure->>'cpfLast4',
    p_secure->>'rgEncrypted', p_secure->>'rgHash', p_secure->>'rgDisplayEncrypted',
    (p_payload #>> '{personal,birthDate}')::date, normalized_email, normalized_phone, p_payload #>> '{personal,maritalStatus}',
    p_payload #>> '{personal,address,postalCode}', p_payload #>> '{personal,address,state}', p_payload #>> '{personal,address,city}',
    p_payload #>> '{personal,address,neighborhood}', p_payload #>> '{personal,address,street}', p_payload #>> '{personal,address,number}',
    p_payload #>> '{personal,address,complement}', coalesce((p_payload #>> '{personal,hasChildren}')::boolean, false),
    nullif(p_payload #>> '{personal,childrenCount}', '')::integer, p_payload #>> '{personal,childrenNotes}',
    p_payload #>> '{personal,profession}', p_payload #>> '{personal,businessSector}',
    p_payload #>> '{personal,preferredContactPeriod}', p_payload #>> '{personal,preferredContactTime}',
    p_payload #>> '{personal,referralSource}', p_payload #>> '{personal,referralOther}',
    p_payload #>> '{technical,bestBank}', coalesce(nullif(p_payload #>> '{technical,pfMonthlySpend}', '')::numeric, 0),
    coalesce((p_payload #>> '{technical,hasPjCard}')::boolean, false), coalesce(nullif(p_payload #>> '{technical,pjMonthlySpend}', '')::numeric, 0),
    p_payload #>> '{technical,vipLoungeInterest}', coalesce(nullif(p_payload #>> '{technical,uberMonthlySpend}', '')::numeric, 0),
    coalesce(nullif(p_payload #>> '{technical,ifoodMonthlySpend}', '')::numeric, 0), coalesce(nullif(p_payload #>> '{technical,fuelMonthlySpend}', '')::numeric, 0),
    coalesce(array(select jsonb_array_elements_text(p_payload #> '{goals,preferredAirports}')), '{}'),
    coalesce(nullif(p_payload #>> '{goals,domesticTrips12m}', '')::integer, 0), coalesce(nullif(p_payload #>> '{goals,internationalTrips12m}', '')::integer, 0),
    coalesce((p_payload #>> '{goals,hasPlannedTrip}')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(p_payload #> '{goals,frequentNationalDestinations}')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_payload #> '{goals,desiredDestinations}')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_payload #> '{goals,freeMonths}')), '{}'),
    p_payload #>> '{goals,businessClassInterest}', p_payload #>> '{goals,seatPriority}', p_payload #>> '{goals,preferredSeat}',
    p_payload #>> '{goals,allInclusiveInterest}', coalesce(array(select jsonb_array_elements_text(p_payload #> '{goals,previousTicketPurchaseMethods}')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_payload #> '{expectations,priorities}')), '{}'),
    p_payload #>> '{expectations,serviceExpectations}', coalesce((p_payload #>> '{expectations,privacyAcknowledged}')::boolean, false),
    coalesce((p_payload #>> '{expectations,marketingConsent}')::boolean, false), p_payload
  ) returning * into submission_row;

  for item in select * from jsonb_array_elements(coalesce(p_payload #> '{technical,pfCards}', '[]'::jsonb)) loop
    insert into public.client_onboarding_cards(submission_id, client_id, card_kind, bank_name, card_brand, product_name, pays_annual_fee, annual_fee_monthly)
    values(submission_row.id, form_row.client_id, 'pf', item->>'bank', item->>'brand', item->>'product', coalesce((item->>'paysAnnualFee')::boolean, false), nullif(item->>'annualFeeMonthly','')::numeric);
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_payload #> '{technical,pjCards}', '[]'::jsonb)) loop
    insert into public.client_onboarding_cards(submission_id, client_id, card_kind, bank_name, card_brand, product_name)
    values(submission_row.id, form_row.client_id, 'pj', item->>'bank', item->>'brand', item->>'product');
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_payload #> '{technical,loyaltyAccounts}', '[]'::jsonb)) loop
    insert into public.client_onboarding_loyalty_accounts(submission_id, client_id, program_name, has_account, declared_points, notes)
    values(submission_row.id, form_row.client_id, item->>'program', coalesce((item->>'hasAccount')::boolean, false), coalesce(nullif(item->>'declaredPoints','')::bigint, 0), item->>'notes');
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_payload #> '{goals,plannedTrips}', '[]'::jsonb)) loop
    insert into public.client_onboarding_planned_trips(submission_id, client_id, destination, approximate_date, notes)
    values(submission_row.id, form_row.client_id, item->>'destination', item->>'approximateDate', item->>'notes')
    on conflict do nothing;

    insert into public.travel_interests(client_id, destination, desired_start_date, desired_end_date, details, status, created_by)
    select form_row.client_id, item->>'destination', null, null, coalesce(nullif(item->>'notes',''), 'Origem: onboarding'), 'open', form_row.created_by
    where nullif(item->>'destination','') is not null
      and not exists (
        select 1 from public.travel_interests ti
         where ti.client_id = form_row.client_id
           and lower(ti.destination) = lower(item->>'destination')
           and ti.details ilike '%onboarding%'
      );
  end loop;

  if client_row.email is null and normalized_email <> '' then
    update public.clients set email = normalized_email::extensions.citext where id = form_row.client_id;
  elsif client_row.email is not null and lower(client_row.email::text) <> normalized_email then
    insert into public.client_onboarding_divergences(submission_id, client_id, field_name, current_value, declared_value)
    values(submission_row.id, form_row.client_id, 'email', client_row.email::text, normalized_email);
  end if;

  if client_row.phone_e164 is null and normalized_phone <> '' then
    update public.clients set phone_e164 = normalized_phone where id = form_row.client_id;
  elsif client_row.phone_e164 is not null and client_row.phone_e164 <> normalized_phone then
    insert into public.client_onboarding_divergences(submission_id, client_id, field_name, current_value, declared_value)
    values(submission_row.id, form_row.client_id, 'phone_e164', client_row.phone_e164, normalized_phone);
  end if;

  if lower(trim(client_row.full_name)) <> lower(declared_full_name) then
    insert into public.client_onboarding_divergences(submission_id, client_id, field_name, current_value, declared_value)
    values(submission_row.id, form_row.client_id, 'full_name', client_row.full_name, declared_full_name);
  end if;

  update public.client_onboarding_forms
     set status = 'submitted',
         submitted_at = clock_timestamp(),
         started_at = coalesce(started_at, clock_timestamp()),
         draft_payload = '{}'::jsonb
   where id = form_row.id;

  insert into public.client_onboarding_events(form_id, client_id, event_type, fingerprint_hash)
  values(form_row.id, form_row.client_id, 'submitted', p_fingerprint_hash);

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(null, form_row.client_id, 'submit_onboarding', 'client_onboarding_submissions', submission_row.id::text, jsonb_build_object('formId', form_row.id, 'source', 'onboarding'));

  return jsonb_build_object('ok', true, 'status', 'submitted', 'submissionId', submission_row.id, 'alreadySubmitted', false);
end;
$$;

revoke all on function public.onboarding_form_status(text, timestamptz) from public, anon;
revoke all on function public.create_client_onboarding_form(uuid, timestamptz, text) from public, anon;
revoke all on function public.revoke_client_onboarding_form(uuid, text) from public, anon;
revoke all on function public.reopen_client_onboarding_form(uuid, timestamptz) from public, anon;
revoke all on function public.get_client_onboarding_forms(text, text, integer, integer) from public, anon;
revoke all on function public.get_client_onboarding_detail(uuid) from public, anon;
revoke all on function public.resolve_onboarding_form_by_hash(text, text, text) from public, anon, authenticated;
revoke all on function public.save_onboarding_draft_by_hash(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.submit_onboarding_by_hash(text, jsonb, jsonb, text) from public, anon, authenticated;

grant execute on function public.create_client_onboarding_form(uuid, timestamptz, text),
  public.revoke_client_onboarding_form(uuid, text),
  public.reopen_client_onboarding_form(uuid, timestamptz),
  public.get_client_onboarding_forms(text, text, integer, integer),
  public.get_client_onboarding_detail(uuid)
to authenticated;

grant execute on function public.resolve_onboarding_form_by_hash(text, text, text),
  public.save_onboarding_draft_by_hash(text, jsonb, text),
  public.submit_onboarding_by_hash(text, jsonb, jsonb, text)
to service_role;

notify pgrst, 'reload schema';
