begin;

alter table public.expiration_alert_settings
  add column if not exists cron_secret_hash text;

alter table public.expiration_alert_settings
  drop constraint if exists expiration_alert_cron_hash_valid;
alter table public.expiration_alert_settings
  add constraint expiration_alert_cron_hash_valid
  check (cron_secret_hash is null or cron_secret_hash ~ '^[0-9a-f]{64}$');

do $$
declare cron_secret text;
begin
  select decrypted_secret into cron_secret
  from vault.decrypted_secrets where name = 'expiration_alerts_cron_secret' limit 1;

  if nullif(cron_secret, '') is null then
    cron_secret := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(cron_secret, 'expiration_alerts_cron_secret', 'Autenticação interna do cron de vencimentos MRL');
  end if;

  if not exists(select 1 from vault.decrypted_secrets where name = 'project_url') then
    perform vault.create_secret('https://bdkazlhvnowjehdgxege.supabase.co', 'project_url', 'URL interna do projeto para pg_cron');
  end if;

  update public.expiration_alert_settings
  set cron_secret_hash = encode(extensions.digest(cron_secret, 'sha256'), 'hex')
  where id = true;
end;
$$;

create or replace function public.configure_expiration_alerts_cron_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, vault, cron
as $$
declare project_url text; cron_secret text; existing_job bigint; new_job bigint;
begin
  if auth.role() <> 'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'expiration_alerts_cron_secret' limit 1;
  if nullif(project_url,'') is null or nullif(cron_secret,'') is null then
    raise exception 'CRON_SECRETS_MISSING';
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
        'X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name='expiration_alerts_cron_secret')
      ),
      body := '{"action":"run"}'::jsonb,
      timeout_milliseconds := 55000
    );$job$
  ) into new_job;

  return jsonb_build_object('configured', true, 'jobId', new_job, 'scheduleUtc', '*/5 * * * *', 'timezone', 'America/Sao_Paulo');
end;
$$;

revoke all on function public.configure_expiration_alerts_cron_v1() from public, anon, authenticated;
grant execute on function public.configure_expiration_alerts_cron_v1() to service_role;

select public.configure_expiration_alerts_cron_v1();

commit;
