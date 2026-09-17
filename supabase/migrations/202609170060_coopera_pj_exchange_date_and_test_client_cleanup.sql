begin;

-- COOPERA PJ is a separate catalog entry. It intentionally reuses Coopera's
-- current artwork, but never reuses or renames the existing `coopera` slug.
insert into public.loyalty_programs (
  slug,name,default_value_per_thousand,logo_url,logo_path,category,program_type,
  conversion_label,active,supports_points_launch,supports_bonus_transfer,
  is_transfer_source,is_transfer_target
)
values (
  'coopera-pj','COOPERA PJ',35.00,'/logos/programs/banks/coopera.png','/logos/programs/banks/coopera.png',
  'bancos','financial_points_program','1 milha a cada 1 ponto Coopera PJ.',true,true,true,true,false
)
on conflict (slug) do update set
  name=excluded.name,
  default_value_per_thousand=excluded.default_value_per_thousand,
  logo_url=excluded.logo_url,
  logo_path=excluded.logo_path,
  category=excluded.category,
  program_type=excluded.program_type,
  conversion_label=excluded.conversion_label,
  active=true,
  supports_points_launch=true,
  supports_bonus_transfer=true,
  is_transfer_source=true,
  is_transfer_target=false,
  updated_at=clock_timestamp();

create or replace function public.admin_delete_test_clients_starting_with_z()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  actor_id uuid:=auth.uid();
  target record;
  dependency record;
  deleted_count integer:=0;
  skipped_count integer:=0;
  errors jsonb:='[]'::jsonb;
  real_client_guard text:='true';
begin
  if actor_id is null or not exists (
    select 1 from public.staff_members sm
    where sm.user_id=actor_id and sm.active and sm.role in ('super_admin','manager')
  ) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  -- Respect an explicit manual/real-client marker if one is introduced in the
  -- deployed schema. The function remains compatible with installations that
  -- do not have any of these optional columns.
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='is_real_client') then
    real_client_guard:='not coalesce(is_real_client,false)';
  elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='is_real') then
    real_client_guard:='not coalesce(is_real,false)';
  elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='manually_marked_real') then
    real_client_guard:='not coalesce(manually_marked_real,false)';
  end if;

  create temporary table if not exists pg_temp.clients_to_purge (
    id uuid primary key,
    full_name text not null
  ) on commit drop;
  truncate pg_temp.clients_to_purge;

  execute format(
    'insert into pg_temp.clients_to_purge(id,full_name)
     select id,full_name from public.clients
     where lower(ltrim(full_name)) like ''z%%''
       and status::text<>''active''
       and (status::text in (''ended'',''archived'') or archived_at is not null)
       and %s',
    real_client_guard
  );

  select count(*) into skipped_count
  from public.clients c
  where lower(ltrim(c.full_name)) like 'z%'
    and not exists(select 1 from pg_temp.clients_to_purge p where p.id=c.id);

  for target in select * from pg_temp.clients_to_purge order by full_name,id loop
    begin
      -- Remove known restrictive grandchildren before their parent records.
      delete from public.travel_interest_status_history where client_id=target.id;
      delete from public.saving_evidence_files where client_id=target.id;
      delete from public.cashback_formula_reconciliations where client_id=target.id;
      delete from public.cashback_transactions where client_id=target.id;
      delete from public.iddas_savings_reconciliations where client_id=target.id;
      delete from public.import_balance_reconciliations where client_id=target.id;
      delete from public.client_name_cleanup_actions where client_id=target.id;
      delete from public.card_statements where client_id=target.id;
      delete from public.vault_provisioning_outbox where client_id=target.id;
      delete from public.travel_interests where client_id=target.id;
      delete from public.client_addresses where client_id=target.id;

      -- Future-proof the cleanup: any later direct client FK declared as
      -- RESTRICT/NO ACTION is cleared too. CASCADE and SET NULL relations are
      -- deliberately left to their declared database behavior.
      for dependency in
        select ns.nspname as schema_name, rel.relname as table_name, att.attname as column_name
        from pg_constraint con
        join pg_class rel on rel.oid=con.conrelid
        join pg_namespace ns on ns.oid=rel.relnamespace
        join pg_attribute att on att.attrelid=con.conrelid and att.attnum=con.conkey[1]
        where con.contype='f'
          and con.confrelid='public.clients'::regclass
          and cardinality(con.conkey)=1
          and con.confdeltype in ('a','r')
      loop
        execute format('delete from %I.%I where %I=$1',dependency.schema_name,dependency.table_name,dependency.column_name)
        using target.id;
      end loop;

      delete from public.clients where id=target.id;
      if found then deleted_count:=deleted_count+1; end if;
    exception when others then
      errors:=errors||jsonb_build_array(jsonb_build_object(
        'clientId',target.id,
        'name',target.full_name,
        'code','dependent_delete_failed'
      ));
    end;
  end loop;

  return jsonb_build_object(
    'deleted',deleted_count,
    'skipped',skipped_count,
    'errors',errors
  );
end;
$$;

revoke all on function public.admin_delete_test_clients_starting_with_z() from public,anon;
grant execute on function public.admin_delete_test_clients_starting_with_z() to authenticated;

comment on function public.admin_delete_test_clients_starting_with_z() is
  'Hard-deletes only archived non-real test clients whose trimmed name starts with Z; returns an auditable operation summary.';

commit;
