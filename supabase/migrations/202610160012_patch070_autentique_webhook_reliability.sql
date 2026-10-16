begin;

alter table public.autentique_webhook_events
  add column if not exists processing_status text not null default 'received',
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_error text;

update public.autentique_webhook_events
set processing_status = case
      when processed_at is not null then 'processed'
      when error_message is not null then 'failed'
      else 'received'
    end,
    received_at = coalesce(received_at, created_at),
    attempt_count = greatest(attempt_count, 1),
    last_error = coalesce(last_error, error_message)
where processing_status = 'received'
   or attempt_count = 0
   or last_error is null;

alter table public.autentique_webhook_events
  drop constraint if exists autentique_webhook_events_processing_status_valid;
alter table public.autentique_webhook_events
  add constraint autentique_webhook_events_processing_status_valid
  check (processing_status in ('received', 'processing', 'processed', 'ignored', 'failed'));

alter table public.autentique_webhook_events
  drop constraint if exists autentique_webhook_events_attempt_count_valid;
alter table public.autentique_webhook_events
  add constraint autentique_webhook_events_attempt_count_valid check (attempt_count >= 0);

create index if not exists autentique_webhook_events_reprocessing_idx
  on public.autentique_webhook_events(processing_status, last_attempt_at)
  where processing_status in ('received', 'processing', 'failed');

create or replace function public.claim_autentique_webhook_event(
  p_event_id text,
  p_event_type text,
  p_document_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_row public.autentique_webhook_events%rowtype;
begin
  if nullif(trim(p_event_id), '') is null or nullif(trim(p_event_type), '') is null then
    raise exception 'INVALID_AUTENTIQUE_EVENT' using errcode = '22023';
  end if;

  insert into public.autentique_webhook_events(
    provider_event_id,
    event_type,
    provider_document_id,
    payload,
    processing_status,
    received_at,
    last_attempt_at,
    attempt_count
  )
  values (
    trim(p_event_id),
    trim(p_event_type),
    nullif(trim(coalesce(p_document_id, '')), ''),
    coalesce(p_payload, '{}'::jsonb),
    'processing',
    clock_timestamp(),
    clock_timestamp(),
    1
  )
  on conflict (provider_event_id) do nothing
  returning * into event_row;

  if event_row.id is not null then
    return jsonb_build_object('claimed', true, 'eventRowId', event_row.id, 'attemptCount', event_row.attempt_count);
  end if;

  select * into event_row
  from public.autentique_webhook_events
  where provider_event_id = trim(p_event_id)
  for update;

  if event_row.processing_status in ('processed', 'ignored')
     or (event_row.processing_status = 'processing' and event_row.last_attempt_at > clock_timestamp() - interval '10 minutes') then
    return jsonb_build_object('claimed', false, 'eventRowId', event_row.id, 'attemptCount', event_row.attempt_count);
  end if;

  update public.autentique_webhook_events
  set event_type = trim(p_event_type),
      provider_document_id = coalesce(nullif(trim(coalesce(p_document_id, '')), ''), provider_document_id),
      payload = coalesce(p_payload, payload),
      processing_status = 'processing',
      processed_at = null,
      last_attempt_at = clock_timestamp(),
      attempt_count = attempt_count + 1,
      last_error = null,
      error_message = null
  where id = event_row.id
  returning * into event_row;

  return jsonb_build_object('claimed', true, 'eventRowId', event_row.id, 'attemptCount', event_row.attempt_count);
end;
$$;

revoke all on function public.claim_autentique_webhook_event(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.claim_autentique_webhook_event(text,text,text,jsonb) to service_role;
grant all on public.autentique_webhook_events to service_role;

notify pgrst, 'reload schema';

commit;
