-- PATCH 066 - Testemunhas, aprovação, notificação e cota mensal da Autentique.

begin;

alter table public.contract_signature_requests
  add column if not exists production_month_key text,
  add column if not exists approved_at timestamptz,
  add column if not exists customer_notified_at timestamptz,
  add column if not exists customer_notification_status text,
  add column if not exists customer_notification_error text,
  add column if not exists quota_override boolean not null default false;

alter table public.contract_signature_requests
  drop constraint if exists contract_signature_customer_notification_status_valid;
alter table public.contract_signature_requests
  add constraint contract_signature_customer_notification_status_valid check (
    customer_notification_status is null
    or customer_notification_status in ('sending','sent','pending_manual','failed')
  );

create index if not exists contract_signature_requests_production_month_idx
  on public.contract_signature_requests(production_month_key, created_at)
  where sandbox = false and status <> 'failed';

create unique index if not exists notifications_contract_approved_dedupe_key
  on public.notifications ((payload->>'dedupeKey'))
  where template_key = 'contract_approved' and payload ? 'dedupeKey';

create or replace function public.reserve_autentique_production_slot(
  p_request_id uuid,
  p_limit integer,
  p_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  month_key text := to_char(clock_timestamp() at time zone 'America/Sao_Paulo', 'YYYY-MM');
  used_count integer;
  request_row public.contract_signature_requests%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100000 then
    raise exception 'AUTENTIQUE_MONTHLY_LIMIT_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('autentique-production:' || month_key, 0));
  select * into request_row from public.contract_signature_requests where id = p_request_id for update;
  if request_row.id is null then raise exception 'SIGNATURE_REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if request_row.sandbox then raise exception 'AUTENTIQUE_SANDBOX_REQUEST' using errcode = '22023'; end if;

  select count(*)::integer into used_count
  from public.contract_signature_requests
  where sandbox = false
    and production_month_key = month_key
    and status <> 'failed'
    and id <> p_request_id;

  if used_count >= p_limit and not p_override then
    raise exception 'AUTENTIQUE_MONTHLY_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  update public.contract_signature_requests
  set production_month_key = month_key, quota_override = p_override
  where id = p_request_id;

  return jsonb_build_object('monthKey', month_key, 'used', used_count, 'limit', p_limit, 'override', p_override);
end;
$$;

revoke all on function public.reserve_autentique_production_slot(uuid,integer,boolean) from public, anon, authenticated;
grant execute on function public.reserve_autentique_production_slot(uuid,integer,boolean) to service_role;

grant all on public.contract_signature_requests, public.contract_signature_signers, public.autentique_webhook_events to service_role;

commit;
