begin;

create table if not exists public.client_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contract_number text,
  client_name text not null,
  cpf text,
  rg text,
  email text,
  marital_status text,
  profession text,
  full_address text,
  contract_value numeric(14,2) not null default 0,
  installments integer not null default 1,
  installment_value numeric(14,2) not null default 0,
  signature_city text not null default 'POMPÉU',
  contract_date date not null default current_date,
  include_cashback boolean not null default false,
  cashback_percent numeric(7,2) not null default 2,
  include_roi_guarantee boolean not null default false,
  status text not null default 'generated',
  pdf_path text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint client_contracts_name_required check (length(trim(client_name)) > 0),
  constraint client_contracts_value_positive check (contract_value > 0),
  constraint client_contracts_installments_valid check (installments between 1 and 120),
  constraint client_contracts_installment_value_valid check (installment_value >= 0),
  constraint client_contracts_cashback_valid check (cashback_percent between 0 and 100),
  constraint client_contracts_status_valid check (status in ('generated', 'archived'))
);

create unique index if not exists client_contracts_contract_number_key
  on public.client_contracts(contract_number) where contract_number is not null;
create index if not exists client_contracts_client_id_idx on public.client_contracts(client_id);
create index if not exists client_contracts_created_at_idx on public.client_contracts(created_at desc);

drop trigger if exists client_contracts_set_updated_at on public.client_contracts;
create trigger client_contracts_set_updated_at
before update on public.client_contracts
for each row execute function public.set_updated_at();

alter table public.client_contracts enable row level security;

drop policy if exists client_contracts_staff_select on public.client_contracts;
create policy client_contracts_staff_select on public.client_contracts
for select to authenticated using (public.is_staff());

drop policy if exists client_contracts_staff_insert on public.client_contracts;
create policy client_contracts_staff_insert on public.client_contracts
for insert to authenticated with check (public.can_write_client_data() and created_by = auth.uid());

drop policy if exists client_contracts_staff_update on public.client_contracts;
create policy client_contracts_staff_update on public.client_contracts
for update to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

revoke all on public.client_contracts from anon;
grant select, insert, update on public.client_contracts to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists contracts_staff_select on storage.objects;
create policy contracts_staff_select on storage.objects
for select to authenticated
using (bucket_id = 'contracts' and public.is_staff());

drop policy if exists contracts_staff_insert on storage.objects;
create policy contracts_staff_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'contracts'
  and public.can_write_client_data()
  and exists (
    select 1 from public.clients c
    where c.id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists contracts_staff_update on storage.objects;
create policy contracts_staff_update on storage.objects
for update to authenticated
using (bucket_id = 'contracts' and public.can_write_client_data())
with check (bucket_id = 'contracts' and public.can_write_client_data());

commit;
