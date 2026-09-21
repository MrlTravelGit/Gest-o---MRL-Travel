begin;

-- Keep later imports/reactivations from putting a test name back into any
-- active selector or dashboard. Historical rows remain intact.
create or replace function public.enforce_test_client_archival()
returns trigger
language plpgsql
set search_path=pg_catalog,public
as $$
begin
  if not public.is_operational_client_name(new.full_name) then
    new.status:='ended'::public.client_status;
    new.archived_at:=coalesce(new.archived_at,clock_timestamp());
    new.archive_reason:=coalesce(nullif(new.archive_reason,''),'Cadastro de teste ocultado pelo PATCH 061');
  end if;
  return new;
end;
$$;

drop trigger if exists clients_test_name_archival_trg on public.clients;
create trigger clients_test_name_archival_trg
before insert or update of full_name,status on public.clients
for each row execute function public.enforce_test_client_archival();

revoke all on function public.enforce_test_client_archival() from public,anon,authenticated;

commit;
