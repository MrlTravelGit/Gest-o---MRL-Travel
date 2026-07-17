-- PATCH MRL 0.4.6 / 012 + 013
-- Link recuperável do dashboard do cliente e onboarding público como porta de entrada.
-- Migration corretiva: não altera migrations já aplicadas e preserva registros legados.

begin;

-- 012: recuperação administrativa segura do token do dashboard público.
alter table public.client_direct_access_links
  add column if not exists token_ciphertext text,
  add column if not exists token_iv text,
  add column if not exists token_key_version integer not null default 1,
  add column if not exists rotated_from uuid references public.client_direct_access_links(id) on delete set null;

alter table public.client_direct_access_links
  drop constraint if exists direct_access_ciphertext_pair_valid;

alter table public.client_direct_access_links
  add constraint direct_access_ciphertext_pair_valid
  check (
    (token_ciphertext is null and token_iv is null)
    or (token_ciphertext is not null and token_iv is not null and token_key_version > 0)
  );

create index if not exists client_direct_access_links_rotated_from_idx
  on public.client_direct_access_links(rotated_from)
  where rotated_from is not null;

-- 013: publicação reutilizável do formulário de entrada.
create table if not exists public.onboarding_form_publications (
  id uuid primary key default gen_random_uuid(),
  public_key text not null unique,
  form_version text not null default '2026-07-17',
  status text not null default 'draft',
  published_at timestamptz,
  paused_at timestamptz,
  retired_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text,
  constraint onboarding_publication_key_format check (public_key ~ '^[A-Za-z0-9_-]{32,96}$'),
  constraint onboarding_publication_status_valid check (status in ('draft','published','paused','retired'))
);

create unique index if not exists onboarding_publications_one_current_idx
  on public.onboarding_form_publications((status = 'published'))
  where status = 'published';

create trigger onboarding_form_publications_set_updated_at
before update on public.onboarding_form_publications
for each row execute function public.set_updated_at();

alter table public.onboarding_form_publications enable row level security;
alter table public.onboarding_form_publications force row level security;

revoke all on public.onboarding_form_publications from anon, authenticated;
grant select on public.onboarding_form_publications to authenticated;
grant all on public.onboarding_form_publications to service_role;

drop policy if exists onboarding_publications_staff_read on public.onboarding_form_publications;
create policy onboarding_publications_staff_read
on public.onboarding_form_publications
for select to authenticated
using (public.is_staff());

-- Reaproveita a tabela de submissões do patch 011 sem apagar submissões antigas.
alter table public.client_onboarding_submissions
  drop constraint if exists client_onboarding_submissions_form_id_key;

alter table public.client_onboarding_submissions
  alter column form_id drop not null,
  alter column client_id drop not null;

alter table public.client_onboarding_submissions
  add column if not exists publication_id uuid references public.onboarding_form_publications(id) on delete set null,
  add column if not exists status text not null default 'client_created',
  add column if not exists idempotency_key text,
  add column if not exists duplicate_candidate_client_id uuid references public.clients(id) on delete set null,
  add column if not exists duplicate_reason text,
  add column if not exists lead_created_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists admin_notes text;

alter table public.client_onboarding_submissions
  drop constraint if exists onboarding_submission_parent_required,
  drop constraint if exists onboarding_submission_status_valid;

alter table public.client_onboarding_submissions
  add constraint onboarding_submission_parent_required
  check (form_id is not null or publication_id is not null),
  add constraint onboarding_submission_status_valid
  check (status in ('received','client_created','duplicate_review','reviewed','activated','rejected'));

create unique index if not exists client_onboarding_submissions_form_unique_idx
  on public.client_onboarding_submissions(form_id)
  where form_id is not null;

create unique index if not exists client_onboarding_submissions_idempotency_idx
  on public.client_onboarding_submissions(publication_id, idempotency_key)
  where publication_id is not null and idempotency_key is not null;

create index if not exists client_onboarding_submissions_publication_idx
  on public.client_onboarding_submissions(publication_id, submitted_at desc);

create index if not exists client_onboarding_submissions_status_idx
  on public.client_onboarding_submissions(status, submitted_at desc);

create index if not exists client_onboarding_submissions_cpf_hash_idx
  on public.client_onboarding_submissions(cpf_hash)
  where cpf_hash is not null;

-- Permite salvar submissões suspeitas/duplicadas sem criar cliente novo.
alter table public.client_onboarding_cards alter column client_id drop not null;
alter table public.client_onboarding_loyalty_accounts alter column client_id drop not null;
alter table public.client_onboarding_planned_trips alter column client_id drop not null;
alter table public.client_onboarding_divergences alter column client_id drop not null;

alter table public.client_onboarding_events
  add column if not exists publication_id uuid references public.onboarding_form_publications(id) on delete set null,
  add column if not exists submission_id uuid references public.client_onboarding_submissions(id) on delete set null;

alter table public.client_onboarding_events
  drop constraint if exists onboarding_event_type_valid;

alter table public.client_onboarding_events
  add constraint onboarding_event_type_valid
  check (event_type in (
    'created','rotated','revoked','reopened','metadata','draft_saved','submitted','already_submitted','invalid','expired','rate_limited','submit_failed','draft_failed',
    'publication_created','publication_published','publication_paused','publication_rotated','publication_metadata','publication_submit_failed','publication_submitted','publication_duplicate_review',
    'admin_publication_viewed','admin_publication_copied','admin_submission_viewed'
  ));

create index if not exists client_onboarding_events_publication_idx
  on public.client_onboarding_events(publication_id, created_at desc);

create index if not exists client_onboarding_events_submission_idx
  on public.client_onboarding_events(submission_id, created_at desc);

-- Submissão pública transacional. Executada somente via service_role na Edge Function.
create or replace function public.submit_public_onboarding_publication(
  p_public_key text,
  p_payload jsonb,
  p_secure jsonb,
  p_idempotency_key text,
  p_fingerprint_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  publication_row public.onboarding_form_publications%rowtype;
  existing_submission public.client_onboarding_submissions%rowtype;
  new_client public.clients%rowtype;
  submission_row public.client_onboarding_submissions%rowtype;
  duplicate_client_id uuid;
  duplicate_reason_value text;
  resolved_status text := 'client_created';
  normalized_email text := lower(trim(p_payload #>> '{personal,email}'));
  normalized_phone text := p_payload #>> '{personal,whatsappE164}';
  normalized_name text := trim(p_payload #>> '{personal,fullName}');
  cpf_hash_value text := p_secure->>'cpfHash';
  item jsonb;
begin
  if p_public_key is null or trim(p_public_key) = '' then
    raise exception 'PUBLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into publication_row
    from public.onboarding_form_publications
   where public_key = p_public_key
   for update;

  if publication_row.id is null or publication_row.status <> 'published' then
    insert into public.client_onboarding_events(publication_id, event_type, fingerprint_hash)
    values(publication_row.id, 'invalid', p_fingerprint_hash);
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
  end if;

  if nullif(trim(coalesce(p_idempotency_key, '')), '') is not null then
    select * into existing_submission
      from public.client_onboarding_submissions
     where publication_id = publication_row.id
       and idempotency_key = trim(p_idempotency_key)
     limit 1;

    if existing_submission.id is not null then
      insert into public.client_onboarding_events(publication_id, submission_id, client_id, event_type, fingerprint_hash)
      values(publication_row.id, existing_submission.id, existing_submission.client_id, 'already_submitted', p_fingerprint_hash);
      return jsonb_build_object(
        'ok', true,
        'status', existing_submission.status,
        'submissionId', existing_submission.id,
        'clientId', existing_submission.client_id,
        'alreadySubmitted', true
      );
    end if;
  end if;

  if cpf_hash_value is not null then
    select s.client_id into duplicate_client_id
      from public.client_onboarding_submissions s
     where s.cpf_hash = cpf_hash_value
       and s.client_id is not null
     order by s.submitted_at asc
     limit 1;
    if duplicate_client_id is not null then
      duplicate_reason_value := 'cpf_hash';
    end if;
  end if;

  if duplicate_client_id is null and normalized_email is not null then
    select c.id into duplicate_client_id
      from public.clients c
     where lower(c.email::text) = normalized_email
     order by c.created_at asc
     limit 1;
    if duplicate_client_id is not null then
      duplicate_reason_value := 'email';
    end if;
  end if;

  if duplicate_client_id is null and normalized_phone is not null then
    select c.id into duplicate_client_id
      from public.clients c
     where c.phone_e164 = normalized_phone
     order by c.created_at asc
     limit 1;
    if duplicate_client_id is not null then
      duplicate_reason_value := 'phone';
    end if;
  end if;

  if duplicate_client_id is null then
    insert into public.clients(full_name, first_name_normalized, email, phone_e164, status, notes, created_by)
    values(
      normalized_name,
      public.normalize_first_name(normalized_name),
      nullif(normalized_email, '')::extensions.citext,
      nullif(normalized_phone, ''),
      'lead',
      'Origem: Formulário de onboarding. Aguardando revisão.',
      publication_row.created_by
    )
    returning * into new_client;
    resolved_status := 'client_created';
  else
    resolved_status := 'duplicate_review';
  end if;

  insert into public.client_onboarding_submissions(
    form_id, publication_id, client_id, status, idempotency_key, duplicate_candidate_client_id, duplicate_reason,
    form_version, source, full_name, cpf_encrypted, cpf_hash, cpf_last4, rg_encrypted, rg_hash, rg_display_encrypted,
    birth_date, email, whatsapp_e164, marital_status, postal_code, state, city, neighborhood, street, address_number, address_complement,
    has_children, children_count, children_notes, profession, business_sector, preferred_contact_period, preferred_contact_time, referral_source, referral_other,
    best_bank, pf_monthly_spend, has_pj_card, pj_monthly_spend, vip_lounge_interest, uber_monthly_spend, ifood_monthly_spend, fuel_monthly_spend,
    preferred_airports, domestic_trips_12m, international_trips_12m, has_planned_trip, frequent_national_destinations, desired_destinations, free_months,
    business_class_interest, seat_priority, preferred_seat, all_inclusive_interest, previous_ticket_purchase_methods,
    expectation_priorities, service_expectations, privacy_acknowledged, marketing_consent, response_snapshot, lead_created_at
  )
  values(
    null, publication_row.id, new_client.id, resolved_status, nullif(trim(coalesce(p_idempotency_key, '')), ''), duplicate_client_id, duplicate_reason_value,
    publication_row.form_version, 'public_onboarding', normalized_name, p_secure->>'cpfEncrypted', cpf_hash_value, p_secure->>'cpfLast4', p_secure->>'rgEncrypted', p_secure->>'rgHash', p_secure->>'rgDisplayEncrypted',
    (p_payload #>> '{personal,birthDate}')::date, normalized_email, normalized_phone, p_payload #>> '{personal,maritalStatus}',
    p_payload #>> '{personal,address,postalCode}', p_payload #>> '{personal,address,state}', p_payload #>> '{personal,address,city}', p_payload #>> '{personal,address,neighborhood}', p_payload #>> '{personal,address,street}', p_payload #>> '{personal,address,number}', p_payload #>> '{personal,address,complement}',
    coalesce((p_payload #>> '{personal,hasChildren}')::boolean, false), nullif(p_payload #>> '{personal,childrenCount}', '')::integer, p_payload #>> '{personal,childrenNotes}', p_payload #>> '{personal,profession}', p_payload #>> '{personal,businessSector}', p_payload #>> '{personal,preferredContactPeriod}', p_payload #>> '{personal,preferredContactTime}', p_payload #>> '{personal,referralSource}', p_payload #>> '{personal,referralOther}',
    p_payload #>> '{technical,bestBank}', coalesce(nullif(p_payload #>> '{technical,pfMonthlySpend}', '')::numeric, 0), coalesce((p_payload #>> '{technical,hasPjCard}')::boolean, false), coalesce(nullif(p_payload #>> '{technical,pjMonthlySpend}', '')::numeric, 0), p_payload #>> '{technical,vipLoungeInterest}', coalesce(nullif(p_payload #>> '{technical,uberMonthlySpend}', '')::numeric, 0), coalesce(nullif(p_payload #>> '{technical,ifoodMonthlySpend}', '')::numeric, 0), coalesce(nullif(p_payload #>> '{technical,fuelMonthlySpend}', '')::numeric, 0),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload #> '{goals,preferredAirports}', '[]'::jsonb))), '{}'), coalesce(nullif(p_payload #>> '{goals,domesticTrips12m}', '')::integer, 0), coalesce(nullif(p_payload #>> '{goals,internationalTrips12m}', '')::integer, 0), coalesce((p_payload #>> '{goals,hasPlannedTrip}')::boolean, false), coalesce(array(select jsonb_array_elements_text(coalesce(p_payload #> '{goals,frequentNationalDestinations}', '[]'::jsonb))), '{}'), coalesce(array(select jsonb_array_elements_text(coalesce(p_payload #> '{goals,desiredDestinations}', '[]'::jsonb))), '{}'), coalesce(array(select jsonb_array_elements_text(coalesce(p_payload #> '{goals,freeMonths}', '[]'::jsonb))), '{}'),
    p_payload #>> '{goals,businessClassInterest}', p_payload #>> '{goals,seatPriority}', p_payload #>> '{goals,preferredSeat}', p_payload #>> '{goals,allInclusiveInterest}', coalesce(array(select jsonb_array_elements_text(coalesce(p_payload #> '{goals,previousTicketPurchaseMethods}', '[]'::jsonb))), '{}'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload #> '{expectations,priorities}', '[]'::jsonb))), '{}'), p_payload #>> '{expectations,serviceExpectations}', coalesce((p_payload #>> '{expectations,privacyAcknowledged}')::boolean, false), coalesce((p_payload #>> '{expectations,marketingConsent}')::boolean, false), p_payload, case when new_client.id is null then null else clock_timestamp() end
  )
  returning * into submission_row;

  for item in select * from jsonb_array_elements(coalesce(p_payload #> '{technical,pfCards}', '[]'::jsonb)) loop
    insert into public.client_onboarding_cards(submission_id, client_id, card_kind, bank_name, card_brand, product_name, pays_annual_fee, annual_fee_monthly)
    values(submission_row.id, new_client.id, 'pf', item->>'bank', item->>'brand', item->>'product', coalesce((item->>'paysAnnualFee')::boolean,false), coalesce(nullif(item->>'annualFeeMonthly','')::numeric,0));
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_payload #> '{technical,pjCards}', '[]'::jsonb)) loop
    insert into public.client_onboarding_cards(submission_id, client_id, card_kind, bank_name, card_brand, product_name)
    values(submission_row.id, new_client.id, 'pj', item->>'bank', item->>'brand', item->>'product');
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_payload #> '{technical,loyaltyAccounts}', '[]'::jsonb)) loop
    insert into public.client_onboarding_loyalty_accounts(submission_id, client_id, program_name, has_account, declared_points, notes)
    values(submission_row.id, new_client.id, item->>'program', coalesce((item->>'hasAccount')::boolean,false), coalesce(nullif(item->>'declaredPoints','')::bigint,0), item->>'notes');
  end loop;

  for item in select * from jsonb_array_elements(coalesce(p_payload #> '{goals,plannedTrips}', '[]'::jsonb)) loop
    insert into public.client_onboarding_planned_trips(submission_id, client_id, destination, approximate_date, notes)
    values(submission_row.id, new_client.id, item->>'destination', item->>'approximateDate', item->>'notes')
    on conflict do nothing;
  end loop;

  insert into public.client_onboarding_events(publication_id, submission_id, client_id, event_type, fingerprint_hash, metadata)
  values(
    publication_row.id,
    submission_row.id,
    new_client.id,
    case when resolved_status = 'duplicate_review' then 'publication_duplicate_review' else 'publication_submitted' end,
    p_fingerprint_hash,
    jsonb_build_object('status', resolved_status, 'duplicateReason', duplicate_reason_value)
  );

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(
    null,
    new_client.id,
    'submit_public_onboarding',
    'client_onboarding_submissions',
    submission_row.id::text,
    jsonb_build_object('publicationId', publication_row.id, 'status', resolved_status, 'duplicateReason', duplicate_reason_value)
  );

  return jsonb_build_object(
    'ok', true,
    'status', resolved_status,
    'submissionId', submission_row.id,
    'clientId', new_client.id,
    'duplicateCandidateClientId', duplicate_client_id,
    'alreadySubmitted', false
  );
end;
$$;

revoke all on function public.submit_public_onboarding_publication(text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.submit_public_onboarding_publication(text, jsonb, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
