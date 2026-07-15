begin;

insert into public.loyalty_programs (
  slug,
  name,
  default_value_per_thousand
)
values
  ('azul_fidelidade', 'Azul Fidelidade', 16.30),
  ('latam_pass', 'LATAM Pass', 27.00),
  ('smiles', 'Smiles', 18.00),
  ('livelo', 'Livelo', 20.37),
  ('esfera', 'Esfera', 35.00),
  ('atomos', 'Átomos', 22.00)
on conflict (slug) do update set
  name = excluded.name,
  default_value_per_thousand = excluded.default_value_per_thousand,
  active = true,
  updated_at = now();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_client_storage(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select public.is_staff() or exists (
    select 1
    from public.client_users cu
    where cu.user_id = auth.uid()
      and cu.active
      and cu.client_id::text = (storage.foldername(object_name))[1]
  );
$$;

create or replace function public.is_valid_client_storage_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select exists (
    select 1
    from public.clients c
    where c.id::text = (storage.foldername(object_name))[1]
  );
$$;

revoke all on function public.can_access_client_storage(text) from public, anon;
revoke all on function public.is_valid_client_storage_path(text) from public, anon;
grant execute on function public.can_access_client_storage(text) to authenticated;
grant execute on function public.is_valid_client_storage_path(text) to authenticated;

create policy client_documents_select_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'client-documents'
  and public.can_access_client_storage(name)
);

create policy client_documents_insert_staff
on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-documents'
  and public.can_write_client_data()
  and public.is_valid_client_storage_path(name)
);

create policy client_documents_update_staff
on storage.objects for update to authenticated
using (
  bucket_id = 'client-documents'
  and public.can_write_client_data()
)
with check (
  bucket_id = 'client-documents'
  and public.can_write_client_data()
  and public.is_valid_client_storage_path(name)
);

create policy client_documents_delete_staff
on storage.objects for delete to authenticated
using (
  bucket_id = 'client-documents'
  and public.can_write_client_data()
);

commit;
