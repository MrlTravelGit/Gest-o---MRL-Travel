begin;

-- O cadastro legado do Leonardo existe no staging do Notion, mas a fonte não
-- possui e-mail nem telefone. Não inventamos um contato: somente leads criados
-- por esta recuperação explícita podem permanecer com contato pendente.
alter table public.clients
  add column if not exists legacy_contact_pending boolean not null default false;

alter table public.clients
  drop constraint if exists clients_contact_required;

alter table public.clients
  add constraint clients_contact_required check (
    email is not null
    or phone_e164 is not null
    or (status = 'lead'::public.client_status and legacy_contact_pending)
  );

create or replace function public.admin_materialize_iddas_missing_legacy_client(
  p_legacy_person_id bigint,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  v_target_name text;
  v_source_external_id text;
  v_source_batch_id uuid;
  v_source_count integer;
  v_client_count integer;
  v_client_id uuid;
  v_client_status public.client_status;
  v_created boolean := false;
begin
  if actor is null or not public.has_staff_role(array['super_admin'::public.app_role]) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_confirmation is distinct from 'iddas_html_saldos_20260721_v1' then
    raise exception 'CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('iddas-missing-client:' || p_legacy_person_id::text, 0)
  );

  select min(target_client_name)
    into v_target_name
  from public.iddas_balance_source_rows
  where source_key = 'iddas_html_saldos_20260721_v1'
    and legacy_person_id = p_legacy_person_id;

  if v_target_name is null then
    raise exception 'IDDAS_CLIENT_NOT_IN_MANIFEST' using errcode = 'P0002';
  end if;

  select count(distinct r.source_external_id)::integer
    into v_source_count
  from public.import_staging_rows r
  join public.import_batches b on b.id = r.batch_id
  where r.entity_type = 'client'
    and b.source_system = 'notion'
    and r.source_external_id is not null
    and lower(trim(r.normalized_payload ->> 'fullName')) = lower(trim(v_target_name));

  if v_source_count = 0 then
    raise exception 'NOTION_SOURCE_CLIENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_source_count > 1 then
    raise exception 'AMBIGUOUS_NOTION_SOURCE_CLIENT' using errcode = '21000';
  end if;

  select r.source_external_id, r.batch_id
    into v_source_external_id, v_source_batch_id
  from public.import_staging_rows r
  join public.import_batches b on b.id = r.batch_id
  where r.entity_type = 'client'
    and b.source_system = 'notion'
    and r.source_external_id is not null
    and lower(trim(r.normalized_payload ->> 'fullName')) = lower(trim(v_target_name))
  order by b.created_at desc, r.created_at desc
  limit 1;

  select esm.local_entity_id
    into v_client_id
  from public.external_source_map esm
  where esm.source_system = 'notion'
    and esm.source_database_id = 'mrl_notion_export'
    and esm.source_page_id = v_source_external_id
    and esm.entity_type = 'client';

  if v_client_id is not null and not exists(select 1 from public.clients where id = v_client_id) then
    raise exception 'BROKEN_NOTION_CLIENT_MAPPING' using errcode = '23503';
  end if;

  if v_client_id is null then
    select count(*)::integer, (array_agg(c.id order by c.id))[1]
      into v_client_count, v_client_id
    from public.clients c
    where lower(trim(c.full_name)) = lower(trim(v_target_name));

    if v_client_count > 1 then
      raise exception 'AMBIGUOUS_CLIENT' using errcode = '21000';
    end if;

    if v_client_count = 0 then
      insert into public.clients(
        full_name, first_name_normalized, email, phone_e164, status, notes,
        legacy_contact_pending, created_by
      ) values (
        v_target_name, public.normalize_first_name(v_target_name), null, null, 'lead',
        'Cadastro legado recuperado do staging do Notion; contato pendente de revisão administrativa.',
        true, actor
      ) returning id into v_client_id;
      v_created := true;
    end if;
  end if;

  insert into public.external_source_map(
    source_system, source_database_id, source_page_id, entity_type, local_entity_id,
    first_import_batch_id, last_import_batch_id
  ) values (
    'notion', 'mrl_notion_export', v_source_external_id, 'client', v_client_id,
    v_source_batch_id, v_source_batch_id
  )
  on conflict(source_system, source_database_id, source_page_id, entity_type)
  do update set
    local_entity_id = excluded.local_entity_id,
    last_import_batch_id = excluded.last_import_batch_id,
    updated_at = clock_timestamp();

  update public.import_staging_rows
  set target_id = v_client_id,
      resolution_status = case when resolution_status = 'committed' then resolution_status else 'ready_link_existing' end,
      blocks_commit = case when resolution_status = 'committed' then blocks_commit else false end,
      chosen_action = case when resolution_status = 'committed' then chosen_action else 'ready_link_existing' end,
      resolution_reason = case when resolution_status = 'committed' then resolution_reason else 'IDDAS_MISSING_CLIENT_MATERIALIZED' end
  where entity_type = 'client'
    and source_external_id = v_source_external_id;

  select status into v_client_status from public.clients where id = v_client_id;

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values (
    actor, v_client_id, 'materialize_missing_iddas_legacy_client', 'clients', v_client_id::text,
    jsonb_build_object(
      'sourceKey', 'iddas_html_saldos_20260721_v1',
      'legacyPersonId', p_legacy_person_id,
      'created', v_created,
      'status', v_client_status,
      'contactPending', true,
      'sourceMapped', true
    )
  );

  return jsonb_build_object(
    'clientId', v_client_id,
    'legacyPersonId', p_legacy_person_id,
    'fullName', v_target_name,
    'created', v_created,
    'status', v_client_status,
    'contactPending', (select legacy_contact_pending from public.clients where id = v_client_id)
  );
end;
$$;

revoke all on function public.admin_materialize_iddas_missing_legacy_client(bigint, text) from public, anon;
grant execute on function public.admin_materialize_iddas_missing_legacy_client(bigint, text) to authenticated;

comment on column public.clients.legacy_contact_pending is
  'True somente para lead legado sem contato verificável; exige revisão antes da ativação.';
comment on function public.admin_materialize_iddas_missing_legacy_client(bigint, text) is
  'Recupera de forma idempotente um cliente ausente do lote Iddas usando o vínculo exato do staging Notion.';

commit;
