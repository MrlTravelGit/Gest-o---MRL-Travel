begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create type public.app_role as enum (
  'super_admin',
  'manager',
  'operator',
  'auditor',
  'client'
);

create type public.client_status as enum (
  'lead',
  'active',
  'paused',
  'ended'
);

create type public.contract_status as enum (
  'draft',
  'active',
  'paused',
  'ended',
  'cancelled'
);

create type public.access_channel as enum ('email', 'phone');
create type public.access_challenge_status as enum (
  'pending',
  'verified',
  'expired',
  'blocked'
);

create type public.earning_basis as enum ('brl', 'usd');
create type public.statement_status as enum ('draft', 'confirmed');
create type public.point_transaction_type as enum (
  'credit',
  'bonus',
  'transfer_in',
  'transfer_out',
  'redemption',
  'expiration',
  'adjustment'
);

create type public.redemption_type as enum ('flight', 'hotel', 'other');
create type public.redemption_status as enum ('draft', 'confirmed', 'cancelled');
create type public.task_status as enum ('open', 'in_progress', 'completed', 'cancelled');
create type public.notification_status as enum ('pending', 'sent', 'failed', 'cancelled');

create or replace function public.normalize_first_name(input text)
returns text
language sql
immutable
returns null on null input
set search_path = ''
as $$
  select regexp_replace(
    translate(
      lower(trim(split_part(input, ' ', 1))),
      'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
      'aaaaaaeeeeiiiiooooouuuucnyy'
    ),
    '[^a-z0-9]',
    '',
    'g'
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  first_name_normalized text not null,
  email extensions.citext,
  phone_e164 text,
  preferred_access_channel public.access_channel not null default 'email',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_contact_required check (email is not null or phone_e164 is not null),
  constraint profiles_phone_format check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  )
);

create table public.staff_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_role_not_client check (role <> 'client')
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  full_name text not null,
  first_name_normalized text not null,
  email extensions.citext,
  phone_e164 text,
  status public.client_status not null default 'active',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_contact_required check (email is not null or phone_e164 is not null),
  constraint clients_phone_format check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  )
);

create table public.client_users (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'client',
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, user_id),
  constraint client_users_role_client check (role = 'client')
);

create table public.management_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status public.contract_status not null default 'active',
  plan_name text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_date_order check (ends_on >= starts_on)
);

create table public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  logo_url text,
  default_value_per_thousand numeric(14,4) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_slug_format check (slug ~ '^[a-z0-9_]+$'),
  constraint loyalty_value_nonnegative check (default_value_per_thousand >= 0)
);

create table public.program_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null references public.loyalty_programs(id),
  membership_number_masked text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, program_id)
);

create table public.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.program_accounts(id) on delete cascade,
  captured_at timestamptz not null,
  balance bigint not null,
  average_cost_per_thousand numeric(14,4) not null default 0,
  value_per_thousand numeric(14,4) not null default 0,
  estimated_value numeric(16,2) generated always as (
    round((balance::numeric / 1000) * value_per_thousand, 2)
  ) stored,
  source text not null default 'manual',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint snapshots_balance_nonnegative check (balance >= 0),
  constraint snapshots_cost_nonnegative check (average_cost_per_thousand >= 0),
  constraint snapshots_value_nonnegative check (value_per_thousand >= 0),
  unique (account_id, captured_at)
);

create table public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.program_accounts(id) on delete cascade,
  occurred_at timestamptz not null,
  transaction_type public.point_transaction_type not null,
  points_delta bigint not null,
  description text not null,
  external_reference text,
  expires_on date,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint point_transactions_nonzero check (points_delta <> 0)
);

create table public.expiration_lots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.program_accounts(id) on delete cascade,
  expires_on date not null,
  points_amount bigint not null,
  points_used bigint not null default 0,
  remaining_points bigint generated always as (
    greatest(points_amount - points_used, 0)
  ) stored,
  status text not null default 'active',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expiration_points_positive check (points_amount > 0),
  constraint expiration_used_valid check (points_used >= 0 and points_used <= points_amount),
  constraint expiration_status_valid check (status in ('active', 'used', 'expired', 'cancelled'))
);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_account_id uuid references public.program_accounts(id) on delete set null,
  destination_account_id uuid references public.program_accounts(id) on delete set null,
  transferred_at timestamptz not null,
  source_points bigint not null,
  bonus_percentage numeric(8,4) not null default 0,
  destination_points bigint not null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint transfer_points_positive check (source_points > 0 and destination_points > 0),
  constraint transfer_bonus_nonnegative check (bonus_percentage >= 0),
  constraint transfer_has_account check (
    source_account_id is not null or destination_account_id is not null
  )
);

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  issuer text not null,
  product_name text not null,
  brand text,
  last_four text not null,
  linked_program_id uuid references public.loyalty_programs(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_last_four_format check (last_four ~ '^[0-9]{4}$'),
  unique (client_id, issuer, product_name, last_four)
);

create table public.card_earning_rules (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  valid_from date not null,
  valid_to date,
  basis public.earning_basis not null,
  points_per_unit numeric(12,6) not null,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint earning_rule_date_order check (valid_to is null or valid_to >= valid_from),
  constraint earning_rule_rate_positive check (points_per_unit > 0)
);

create table public.card_statements (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  statement_month date not null,
  total_spend numeric(16,2) not null,
  eligible_spend numeric(16,2) not null,
  earning_basis public.earning_basis not null,
  earning_rate numeric(12,6) not null,
  fx_rate numeric(12,6),
  received_points numeric(16,2) not null default 0,
  expected_points numeric(16,2) generated always as (
    round(
      case
        when earning_basis = 'brl' then eligible_spend * earning_rate
        else (eligible_spend / nullif(fx_rate, 0)) * earning_rate
      end,
      2
    )
  ) stored,
  divergence numeric(16,2) generated always as (
    round(
      received_points - case
        when earning_basis = 'brl' then eligible_spend * earning_rate
        else (eligible_spend / nullif(fx_rate, 0)) * earning_rate
      end,
      2
    )
  ) stored,
  status public.statement_status not null default 'draft',
  formula_version text not null default '1.0.0',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint statement_month_first_day check (extract(day from statement_month) = 1),
  constraint statement_values_nonnegative check (
    total_spend >= 0 and eligible_spend >= 0 and received_points >= 0 and earning_rate > 0
  ),
  constraint statement_eligible_limit check (eligible_spend <= total_spend),
  constraint statement_fx_required check (
    (earning_basis = 'brl' and fx_rate is null)
    or (earning_basis = 'usd' and fx_rate is not null and fx_rate > 0)
  ),
  unique (card_id, statement_month)
);

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  redemption_type public.redemption_type not null,
  description text not null,
  issued_at timestamptz not null,
  cash_reference_total numeric(16,2) not null,
  taxes_paid numeric(16,2) not null default 0,
  additional_cash_paid numeric(16,2) not null default 0,
  attributed_points_cost numeric(16,2) not null default 0,
  effective_cost numeric(16,2) generated always as (
    round(taxes_paid + additional_cash_paid + attributed_points_cost, 2)
  ) stored,
  savings_amount numeric(16,2) generated always as (
    round(cash_reference_total - taxes_paid - additional_cash_paid - attributed_points_cost, 2)
  ) stored,
  formula_version text not null default '1.0.0',
  reference_captured_at timestamptz not null,
  status public.redemption_status not null default 'draft',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint redemption_values_nonnegative check (
    cash_reference_total >= 0 and taxes_paid >= 0
    and additional_cash_paid >= 0 and attributed_points_cost >= 0
  )
);

create table public.redemption_point_usages (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references public.redemptions(id) on delete cascade,
  account_id uuid not null references public.program_accounts(id),
  points_used bigint not null,
  value_per_thousand numeric(14,4) not null default 0,
  created_at timestamptz not null default now(),
  constraint redemption_usage_positive check (points_used > 0 and value_per_thousand >= 0)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz,
  priority smallint not null default 2,
  status public.task_status not null default 'open',
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_priority_valid check (priority between 1 and 4)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  channel text not null,
  template_key text not null,
  recipient_masked text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  sent_at timestamptz,
  status public.notification_status not null default 'pending',
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint notification_channel_valid check (channel in ('email', 'sms', 'whatsapp', 'in_app'))
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  bucket_id text not null default 'client-documents',
  object_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  category text not null,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint attachment_size_positive check (size_bytes > 0)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  request_id uuid,
  created_at timestamptz not null default now()
);

create table public.client_access_challenges (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel public.access_channel not null,
  status public.access_challenge_status not null default 'pending',
  attempts smallint not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  fingerprint_hash text not null,
  created_at timestamptz not null default now(),
  constraint challenge_attempts_valid check (attempts between 0 and 10)
);

create table public.client_access_attempts (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients(id) on delete cascade,
  public_id_hash text not null,
  fingerprint_hash text not null,
  first_name_hash text not null,
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.login_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  event_type text not null,
  fingerprint_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint login_event_type_valid check (
    event_type in ('code_requested', 'code_verified', 'code_failed', 'blocked', 'logout', 'session_revoked')
  )
);

create index clients_status_idx on public.clients(status);
create index client_users_user_idx on public.client_users(user_id) where active;
create index contracts_client_status_idx on public.management_contracts(client_id, status, ends_on);
create index program_accounts_client_idx on public.program_accounts(client_id) where active;
create index snapshots_account_date_idx on public.balance_snapshots(account_id, captured_at desc);
create index transactions_account_date_idx on public.point_transactions(account_id, occurred_at desc);
create index expiration_account_date_idx on public.expiration_lots(account_id, expires_on) where status = 'active';
create index cards_client_idx on public.credit_cards(client_id) where active;
create index statements_card_month_idx on public.card_statements(card_id, statement_month desc);
create index redemptions_client_date_idx on public.redemptions(client_id, issued_at desc);
create index tasks_status_due_idx on public.tasks(status, due_at);
create index audit_client_date_idx on public.audit_logs(client_id, created_at desc);
create index challenges_user_date_idx on public.client_access_challenges(user_id, created_at desc);
create index attempts_fingerprint_date_idx on public.client_access_attempts(fingerprint_hash, created_at desc);
create index attempts_public_date_idx on public.client_access_attempts(public_id_hash, created_at desc);

create or replace function public.sync_profile_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.full_name = trim(new.full_name);
  new.first_name_normalized = public.normalize_first_name(new.full_name);
  return new;
end;
$$;

create or replace function public.sync_client_names()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.full_name = trim(new.full_name);
  new.first_name_normalized = public.normalize_first_name(new.full_name);
  return new;
end;
$$;

create trigger profiles_sync_names
before insert or update of full_name on public.profiles
for each row execute function public.sync_profile_names();

create trigger clients_sync_names
before insert or update of full_name on public.clients
for each row execute function public.sync_client_names();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  resolved_name text;
begin
  resolved_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Cliente MRL'
  );

  insert into public.profiles (
    id,
    full_name,
    first_name_normalized,
    email,
    phone_e164,
    preferred_access_channel
  )
  values (
    new.id,
    resolved_name,
    public.normalize_first_name(resolved_name),
    new.email,
    new.phone,
    case when new.email is not null then 'email'::public.access_channel else 'phone'::public.access_channel end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'staff_members',
    'clients',
    'client_users',
    'management_contracts',
    'loyalty_programs',
    'program_accounts',
    'expiration_lots',
    'credit_cards',
    'card_statements',
    'redemptions',
    'tasks'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

commit;
