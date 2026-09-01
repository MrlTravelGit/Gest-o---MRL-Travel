begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.expiration_alert_settings (
  id boolean primary key default true check (id),
  points_enabled boolean not null default true,
  management_enabled boolean not null default true,
  threshold_days smallint[] not null default array[90,60,30,15,7,1]::smallint[],
  daily_time time not null default time '08:00',
  timezone text not null default 'America/Sao_Paulo',
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expiration_alert_thresholds_valid check (
    cardinality(threshold_days) between 1 and 12
    and threshold_days <@ array[1,2,3,4,5,6,7,10,15,20,30,45,60,90,120,180]::smallint[]
    and 90 = any(threshold_days)
  ),
  constraint expiration_alert_timezone_valid check (timezone = 'America/Sao_Paulo')
);

insert into public.expiration_alert_settings(id) values(true)
on conflict(id) do nothing;

create table if not exists public.expiration_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  client_id uuid not null references public.clients(id) on delete cascade,
  program_name text not null default '',
  points_amount bigint,
  expires_at date not null,
  threshold_days smallint not null,
  sent_at timestamptz,
  telegram_chat_id text,
  telegram_message_id bigint,
  status text not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expiration_alert_type_valid check (alert_type in ('points_expiration','management_expiration')),
  constraint expiration_alert_status_valid check (status in ('pending','sent','failed')),
  constraint expiration_alert_points_valid check (
    (alert_type = 'points_expiration' and points_amount is not null and points_amount > 0 and program_name <> '')
    or (alert_type = 'management_expiration' and points_amount is null)
  ),
  constraint expiration_alert_threshold_valid check (threshold_days > 0)
);

create unique index if not exists expiration_alerts_dedup_idx
  on public.expiration_alerts(client_id, alert_type, program_name, expires_at, threshold_days);
create index if not exists expiration_alerts_history_idx
  on public.expiration_alerts(created_at desc);
create index if not exists expiration_alerts_client_idx
  on public.expiration_alerts(client_id, expires_at, threshold_days);

drop trigger if exists expiration_alert_settings_updated_at on public.expiration_alert_settings;
create trigger expiration_alert_settings_updated_at before update on public.expiration_alert_settings
for each row execute function public.set_updated_at();
drop trigger if exists expiration_alerts_updated_at on public.expiration_alerts;
create trigger expiration_alerts_updated_at before update on public.expiration_alerts
for each row execute function public.set_updated_at();

alter table public.expiration_alert_settings enable row level security;
alter table public.expiration_alerts enable row level security;

drop policy if exists expiration_alert_settings_admin_read on public.expiration_alert_settings;
create policy expiration_alert_settings_admin_read on public.expiration_alert_settings
for select to authenticated using (public.is_staff());
drop policy if exists expiration_alerts_admin_read on public.expiration_alerts;
create policy expiration_alerts_admin_read on public.expiration_alerts
for select to authenticated using (public.is_staff());

revoke all on public.expiration_alert_settings, public.expiration_alerts from public, anon, authenticated;
grant select on public.expiration_alert_settings, public.expiration_alerts to authenticated;
grant all on public.expiration_alert_settings, public.expiration_alerts to service_role;

create or replace function public.get_expiration_alert_candidates_v1()
returns table(
  alert_type text,
  client_id uuid,
  client_name text,
  program_name text,
  points_amount bigint,
  expires_at date,
  threshold_days smallint,
  days_remaining integer
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with settings as (
    select s.*, (now() at time zone s.timezone)::date as local_today
    from public.expiration_alert_settings s where s.id = true
  ),
  point_expirations as (
    select c.id as client_id, c.full_name as client_name, lp.name as program_name,
           sum(el.remaining_points)::bigint as points_amount, el.expires_on
    from public.expiration_lots el
    join public.program_accounts pa on pa.id = el.account_id and pa.active
    join public.loyalty_programs lp on lp.id = pa.program_id
    join public.clients c on c.id = pa.client_id and c.status = 'active'
    where el.status = 'active' and el.remaining_points > 0
    group by c.id, c.full_name, lp.name, el.expires_on
  ),
  management_expirations as (
    select c.id as client_id, c.full_name as client_name, mc.ends_on
    from public.management_contracts mc
    join public.clients c on c.id = mc.client_id and c.status = 'active'
    where mc.status = 'active'
  )
  select 'points_expiration'::text, p.client_id, p.client_name, p.program_name,
         p.points_amount, p.expires_on, threshold,
         (p.expires_on - s.local_today)::integer
  from settings s
  cross join lateral unnest(s.threshold_days) threshold
  join point_expirations p on s.points_enabled
    and p.expires_on >= s.local_today
    and p.expires_on - s.local_today <= threshold
    and not exists (
      select 1 from public.expiration_alerts ea
      where ea.client_id = p.client_id and ea.alert_type = 'points_expiration'
        and ea.program_name = p.program_name and ea.expires_at = p.expires_on
        and ea.threshold_days = threshold and ea.status in ('sent','pending')
    )
  union all
  select 'management_expiration'::text, m.client_id, m.client_name,
         'Gestão MRL Travel'::text, null::bigint, m.ends_on, threshold,
         (m.ends_on - s.local_today)::integer
  from settings s
  cross join lateral unnest(s.threshold_days) threshold
  join management_expirations m on s.management_enabled
    and m.ends_on >= s.local_today
    and m.ends_on - s.local_today <= threshold
    and not exists (
      select 1 from public.expiration_alerts ea
      where ea.client_id = m.client_id and ea.alert_type = 'management_expiration'
        and ea.program_name = 'Gestão MRL Travel' and ea.expires_at = m.ends_on
        and ea.threshold_days = threshold and ea.status in ('sent','pending')
    )
  order by 6, 3, 1, 7 desc;
$$;

create or replace function public.claim_expiration_alert_v1(
  p_alert_type text,
  p_client_id uuid,
  p_program_name text,
  p_points_amount bigint,
  p_expires_at date,
  p_threshold_days smallint,
  p_telegram_chat_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare claimed_id uuid;
begin
  if auth.role() <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.expiration_alerts(
    alert_type, client_id, program_name, points_amount, expires_at,
    threshold_days, telegram_chat_id, status, error_message
  ) values(
    p_alert_type, p_client_id, coalesce(p_program_name, ''), p_points_amount,
    p_expires_at, p_threshold_days, p_telegram_chat_id, 'pending', null
  )
  on conflict(client_id, alert_type, program_name, expires_at, threshold_days)
  do update set
    status = 'pending', error_message = null,
    telegram_chat_id = excluded.telegram_chat_id, updated_at = now()
  where public.expiration_alerts.status = 'failed'
  returning id into claimed_id;

  return claimed_id;
end;
$$;

revoke all on function public.get_expiration_alert_candidates_v1() from public, anon, authenticated;
revoke all on function public.claim_expiration_alert_v1(text,uuid,text,bigint,date,smallint,text) from public, anon, authenticated;
grant execute on function public.get_expiration_alert_candidates_v1() to service_role;
grant execute on function public.claim_expiration_alert_v1(text,uuid,text,bigint,date,smallint,text) to service_role;

create or replace function public.configure_expiration_alerts_cron_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, vault, cron
as $$
declare project_url text; anon_key text; cron_secret text; existing_job bigint; new_job bigint;
begin
  if auth.role() <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into anon_key from vault.decrypted_secrets where name = 'anon_key' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'expiration_alerts_cron_secret' limit 1;
  if nullif(project_url,'') is null or nullif(anon_key,'') is null or nullif(cron_secret,'') is null then
    raise exception 'CRON_SECRETS_MISSING' using hint = 'Crie project_url, anon_key e expiration_alerts_cron_secret no Supabase Vault.';
  end if;

  select jobid into existing_job from cron.job where jobname = 'mrl-expiration-alerts-daily' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;

  select cron.schedule(
    'mrl-expiration-alerts-daily',
    '*/5 * * * *',
    $job$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/expiration-alerts',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='anon_key'),
        'X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name='expiration_alerts_cron_secret')
      ),
      body := '{"action":"run"}'::jsonb,
      timeout_milliseconds := 55000
    );$job$
  ) into new_job;

  return jsonb_build_object('configured', true, 'jobId', new_job, 'scheduleUtc', '*/5 * * * *', 'timezone', 'America/Sao_Paulo', 'note', 'A função executa somente uma vez por data local, no primeiro ciclo após daily_time.');
end;
$$;

revoke all on function public.configure_expiration_alerts_cron_v1() from public, anon, authenticated;
grant execute on function public.configure_expiration_alerts_cron_v1() to service_role;

commit;
