begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('invoice-uploads','invoice-uploads',false,15728640,array['image/png','image/jpeg','application/pdf'])
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.invoice_import_attempts(
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  file_path text not null unique,
  status text not null default 'processing',
  extracted_data jsonb not null default '{}'::jsonb,
  confidence_score numeric(5,2),
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  confirmed_invoice_id uuid references public.card_statements(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint invoice_import_attempt_status_valid check(status in ('processing','extracted','confirmed','failed','discarded')),
  constraint invoice_import_attempt_confidence_valid check(confidence_score is null or confidence_score between 0 and 100)
);

create index if not exists invoice_import_attempts_client_created_idx
  on public.invoice_import_attempts(client_id,created_at desc);

alter table public.invoice_import_attempts enable row level security;

drop policy if exists invoice_import_attempts_staff_select on public.invoice_import_attempts;
create policy invoice_import_attempts_staff_select on public.invoice_import_attempts
  for select to authenticated using(public.is_staff());

drop policy if exists invoice_import_attempts_staff_insert on public.invoice_import_attempts;
create policy invoice_import_attempts_staff_insert on public.invoice_import_attempts
  for insert to authenticated with check(public.is_staff() and created_by=auth.uid());

drop policy if exists invoice_import_attempts_staff_update on public.invoice_import_attempts;
create policy invoice_import_attempts_staff_update on public.invoice_import_attempts
  for update to authenticated using(public.is_staff()) with check(public.is_staff());

drop policy if exists invoice_uploads_staff_insert on storage.objects;
create policy invoice_uploads_staff_insert on storage.objects
  for insert to authenticated with check(bucket_id='invoice-uploads' and public.is_staff());

drop policy if exists invoice_uploads_staff_select on storage.objects;
create policy invoice_uploads_staff_select on storage.objects
  for select to authenticated using(bucket_id='invoice-uploads' and public.is_staff());

drop policy if exists invoice_uploads_staff_delete on storage.objects;
create policy invoice_uploads_staff_delete on storage.objects
  for delete to authenticated using(bucket_id='invoice-uploads' and public.is_staff());

create or replace function public.confirm_invoice_import_attempt(p_attempt_id uuid,p_invoice_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare attempt_client uuid; invoice_client uuid;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  select client_id into attempt_client from public.invoice_import_attempts where id=p_attempt_id and created_by=auth.uid() and status='extracted' for update;
  if attempt_client is null then raise exception 'Tentativa de importacao nao encontrada.' using errcode='P0002'; end if;
  select client_id into invoice_client from public.card_statements where id=p_invoice_id and archived_at is null;
  if invoice_client is null or invoice_client<>attempt_client then raise exception 'A fatura nao pertence ao cliente da importacao.' using errcode='22023'; end if;
  update public.invoice_import_attempts set status='confirmed',confirmed_invoice_id=p_invoice_id,error_message=null where id=p_attempt_id;
end $$;

create or replace function public.discard_invoice_import_attempt(p_attempt_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  update public.invoice_import_attempts set status='discarded'
  where id=p_attempt_id and created_by=auth.uid() and status in ('processing','extracted','failed');
  if not found then raise exception 'Tentativa de importacao nao encontrada.' using errcode='P0002'; end if;
end $$;

revoke all on table public.invoice_import_attempts from public,anon;
grant select,insert,update on table public.invoice_import_attempts to authenticated;
revoke all on function public.confirm_invoice_import_attempt(uuid,uuid),public.discard_invoice_import_attempt(uuid) from public,anon;
grant execute on function public.confirm_invoice_import_attempt(uuid,uuid),public.discard_invoice_import_attempt(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
