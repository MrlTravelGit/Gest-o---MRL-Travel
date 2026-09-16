begin;

alter table public.client_contracts
  add column if not exists contract_data jsonb not null default '{}'::jsonb,
  add column if not exists clauses jsonb not null default '{}'::jsonb,
  add column if not exists document_format text not null default 'pdf',
  add column if not exists generation_version text not null default 'legacy-browser-pdf-v1';

do $$ begin
  alter table public.client_contracts add constraint client_contracts_document_format_valid check(document_format in ('pdf','html'));
exception when duplicate_object then null; end $$;

-- A Edge Function usa service_role. O navegador permanece limitado às políticas
-- de leitura/arquivamento e não recebe permissão para escrever objetos diretamente.
drop policy if exists contracts_staff_insert on storage.objects;
drop policy if exists contracts_staff_update on storage.objects;

commit;
