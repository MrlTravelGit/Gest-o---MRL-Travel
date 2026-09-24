-- PATCH 065 - Autentique contract signature tracking.

begin;

create table if not exists public.contract_signature_requests (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.client_contracts(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  provider text not null default 'autentique',
  provider_document_id text,
  provider_document_name text,
  status text not null default 'draft',
  sandbox boolean not null default true,
  original_pdf_path text,
  signed_pdf_url text,
  pades_pdf_url text,
  raw_response jsonb,
  last_webhook_payload jsonb,
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_signature_request_status_valid check (
    status in ('draft','sent','pending_signature','partially_signed','completed','rejected','failed')
  )
);

create table if not exists public.contract_signature_signers (
  id uuid primary key default gen_random_uuid(),
  signature_request_id uuid not null references public.contract_signature_requests(id) on delete cascade,
  provider_public_id text,
  name text not null,
  email text,
  phone text,
  cpf text,
  action text not null default 'SIGN',
  delivery_method text,
  signature_link text,
  status text not null default 'pending',
  signed_at timestamptz,
  viewed_at timestamptz,
  rejected_at timestamptz,
  raw_signature jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_signature_signer_status_valid check (
    status in ('pending','viewed','signed','rejected','failed')
  )
);

create table if not exists public.autentique_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  provider_document_id text,
  payload jsonb not null,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists contract_signature_requests_contract_idx
  on public.contract_signature_requests(contract_id, created_at desc);
create unique index if not exists contract_signature_requests_provider_document_key
  on public.contract_signature_requests(provider, provider_document_id)
  where provider_document_id is not null;
create index if not exists contract_signature_signers_request_idx
  on public.contract_signature_signers(signature_request_id, created_at);
create unique index if not exists contract_signature_signers_provider_key
  on public.contract_signature_signers(signature_request_id, provider_public_id)
  where provider_public_id is not null;

drop trigger if exists contract_signature_requests_set_updated_at on public.contract_signature_requests;
create trigger contract_signature_requests_set_updated_at
before update on public.contract_signature_requests
for each row execute function public.set_updated_at();

drop trigger if exists contract_signature_signers_set_updated_at on public.contract_signature_signers;
create trigger contract_signature_signers_set_updated_at
before update on public.contract_signature_signers
for each row execute function public.set_updated_at();

alter table public.contract_signature_requests enable row level security;
alter table public.contract_signature_signers enable row level security;
alter table public.autentique_webhook_events enable row level security;

drop policy if exists contract_signature_requests_staff_select on public.contract_signature_requests;
create policy contract_signature_requests_staff_select on public.contract_signature_requests
for select to authenticated using (public.is_staff());

drop policy if exists contract_signature_signers_staff_select on public.contract_signature_signers;
create policy contract_signature_signers_staff_select on public.contract_signature_signers
for select to authenticated using (
  exists (
    select 1 from public.contract_signature_requests request
    where request.id = signature_request_id and public.is_staff()
  )
);

revoke all on public.contract_signature_requests, public.contract_signature_signers, public.autentique_webhook_events from anon;
revoke insert, update, delete on public.contract_signature_requests, public.contract_signature_signers, public.autentique_webhook_events from authenticated;
grant select on public.contract_signature_requests, public.contract_signature_signers to authenticated;

commit;
