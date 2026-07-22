-- PATCH MRL 20260721-021
-- Reativação segura, edição administrativa, revisão contratual e limpeza controlada de nomes.

begin;

alter table public.clients
  add column if not exists display_name text,
  add column if not exists document_ciphertext text,
  add column if not exists document_hash text,
  add column if not exists document_last4 text,
  add column if not exists document_kind text,
  add column if not exists whatsapp_e164 text,
  add column if not exists registration_source text not null default 'manual',
  add column if not exists activated_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null,
  add column if not exists archive_reason text,
  add column if not exists contract_review_status text not null default 'pending_review',
  add column if not exists row_version bigint not null default 1;

alter table public.clients drop constraint if exists clients_display_name_length;
alter table public.clients add constraint clients_display_name_length
  check (display_name is null or char_length(trim(display_name)) between 2 and 160);
alter table public.clients drop constraint if exists clients_document_metadata_valid;
alter table public.clients add constraint clients_document_metadata_valid check (
  (document_ciphertext is null and document_hash is null and document_last4 is null and document_kind is null)
  or (
    document_ciphertext is not null and document_hash is not null
    and document_last4 ~ '^[0-9]{4}$' and document_kind in ('cpf','cnpj')
  )
);
alter table public.clients drop constraint if exists clients_whatsapp_format;
alter table public.clients add constraint clients_whatsapp_format
  check (whatsapp_e164 is null or whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$');
alter table public.clients drop constraint if exists clients_registration_source_valid;
alter table public.clients add constraint clients_registration_source_valid
  check (registration_source in ('manual','onboarding','notion','iddas','other'));
alter table public.clients drop constraint if exists clients_contract_review_status_valid;
alter table public.clients add constraint clients_contract_review_status_valid
  check (contract_review_status in ('pending_review','complete'));
alter table public.clients drop constraint if exists clients_archive_metadata_valid;
alter table public.clients add constraint clients_archive_metadata_valid check (
  status = 'ended'::public.client_status or (archived_at is null and archived_by is null and archive_reason is null)
);

alter table public.management_contracts
  add column if not exists contract_value numeric(14,2),
  add column if not exists auto_renew boolean not null default false,
  add column if not exists revision_reason text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.management_contracts alter column ends_on drop not null;
alter table public.management_contracts drop constraint if exists contracts_date_order;
alter table public.management_contracts add constraint contracts_date_order
  check (ends_on is null or ends_on >= starts_on);
alter table public.management_contracts drop constraint if exists contracts_value_nonnegative;
alter table public.management_contracts add constraint contracts_value_nonnegative
  check (contract_value is null or contract_value >= 0);

update public.clients c
set registration_source = case
  when exists(select 1 from public.client_onboarding_submissions s where s.client_id=c.id) then 'onboarding'
  when exists(select 1 from public.external_source_map esm where esm.entity_type='client' and esm.local_entity_id=c.id and esm.source_system like 'iddas%') then 'iddas'
  when exists(select 1 from public.external_source_map esm where esm.entity_type='client' and esm.local_entity_id=c.id and esm.source_system='notion') then 'notion'
  else registration_source
end
where registration_source='manual';

update public.clients c
set contract_review_status = case when exists (
  select 1 from public.management_contracts mc
  where mc.client_id=c.id and mc.status in ('active','paused')
    and mc.starts_on <= current_date and (mc.ends_on is null or mc.ends_on >= current_date)
) then 'complete' else 'pending_review' end;

update public.clients
set activated_at=coalesce(activated_at,created_at)
where status='active' and activated_at is null;

create or replace function public.bump_client_row_version()
returns trigger language plpgsql set search_path=public as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

drop trigger if exists clients_bump_row_version on public.clients;
create trigger clients_bump_row_version
before update on public.clients
for each row execute function public.bump_client_row_version();

create table if not exists public.client_reactivation_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  note text,
  requested_count integer not null default 0,
  reactivated_count integer not null default 0,
  already_active_count integer not null default 0,
  blocked_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.client_reactivation_batch_items (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.client_reactivation_batches(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  result_status text not null,
  safe_message text not null,
  points_before bigint not null default 0,
  points_after bigint not null default 0,
  programs_before integer not null default 0,
  programs_after integer not null default 0,
  contract_action text,
  created_at timestamptz not null default now(),
  constraint reactivation_item_status_valid check (result_status in ('reactivated','already_active','blocked','failed'))
);

create index if not exists client_reactivation_batches_actor_idx
  on public.client_reactivation_batches(created_by,created_at desc);
create index if not exists client_reactivation_items_batch_idx
  on public.client_reactivation_batch_items(batch_id,id);

create table if not exists public.client_name_cleanup_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  old_name text not null,
  new_name text not null,
  removed_text text,
  reason text,
  applied_by uuid not null references auth.users(id) on delete restrict,
  applied_at timestamptz not null default now(),
  reverted_by uuid references auth.users(id) on delete set null,
  reverted_at timestamptz,
  revert_reason text
);

create index if not exists client_name_cleanup_client_idx
  on public.client_name_cleanup_actions(client_id,applied_at desc);

alter table public.client_reactivation_batches enable row level security;
alter table public.client_reactivation_batches force row level security;
alter table public.client_reactivation_batch_items enable row level security;
alter table public.client_reactivation_batch_items force row level security;
alter table public.client_name_cleanup_actions enable row level security;
alter table public.client_name_cleanup_actions force row level security;

revoke all on public.client_reactivation_batches,public.client_reactivation_batch_items,public.client_name_cleanup_actions from anon,authenticated;
grant all on public.client_reactivation_batches,public.client_reactivation_batch_items,public.client_name_cleanup_actions to service_role;

create or replace function public.require_client_admin()
returns public.app_role
language plpgsql stable security definer set search_path=public as $$
declare resolved_role public.app_role;
begin
  select sm.role into resolved_role from public.staff_members sm
  where sm.user_id=auth.uid() and sm.active limit 1;
  if auth.uid() is null or resolved_role is null or resolved_role not in ('super_admin','manager') then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  return resolved_role;
end;
$$;

create or replace function public.safe_client_totals(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'points',coalesce(sum(coalesce(latest.balance,0)),0),
    'programs',count(pa.id)
  )
  from public.program_accounts pa
  left join lateral (
    select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id
    order by bs.captured_at desc,bs.id desc limit 1
  ) latest on true
  where pa.client_id=p_client_id and pa.active;
$$;

revoke all on function public.safe_client_totals(uuid) from public,anon,authenticated;

create or replace function public.suggest_client_name_cleanup(p_name text)
returns jsonb language plpgsql immutable set search_path=public as $$
declare
  original_name text:=trim(coalesce(p_name,''));
  parts text[];
  cleaned text;
  removed text;
begin
  parts:=regexp_match(original_name,'(?i)^(.*?)(?:\s*(?:[-:|/]\s*|\(\s*)?)(ainda aguarda revisão e ativação|contato pendente|aguardando ativação|aguardando revisão|recebido pelo onboarding)(?:\s*\))?\s*$');
  if parts is not null then cleaned:=trim(regexp_replace(parts[1],'[-:|/\s]+$','','g')); removed:=parts[2]; end if;
  if parts is null then
    parts:=regexp_match(original_name,'(?i)^(.*?)(?:\s*[-:|/]\s*|\s*\(\s*)(lead|arquivado)\s*\)?\s*$');
    if parts is not null then cleaned:=trim(regexp_replace(parts[1],'[-:|/\s]+$','','g')); removed:=parts[2]; end if;
  end if;
  if parts is null then
    parts:=regexp_match(original_name,'(?i)^\s*(ainda aguarda revisão e ativação|contato pendente|aguardando ativação|aguardando revisão|recebido pelo onboarding)\s*[-:|/]\s*(.+)$');
    if parts is not null then cleaned:=trim(parts[2]); removed:=parts[1]; end if;
  end if;
  if cleaned is null or char_length(regexp_replace(cleaned,'[^[:alnum:]]','','g'))<2 or cleaned=original_name then return null; end if;
  return jsonb_build_object('currentName',original_name,'suggestedName',cleaned,'removedText',removed);
end;
$$;

revoke all on function public.suggest_client_name_cleanup(text) from public,anon,authenticated;

create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path=public as $$
declare old_row jsonb; new_row jsonb; resolved_client_id uuid; resolved_account_id uuid; resolved_record_id text;
begin
  old_row:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  new_row:=case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  resolved_account_id:=coalesce(nullif(new_row->>'account_id','')::uuid,nullif(old_row->>'account_id','')::uuid);
  resolved_client_id:=coalesce(
    nullif(new_row->>'client_id','')::uuid,nullif(old_row->>'client_id','')::uuid,
    case when tg_table_name='clients' then coalesce(nullif(new_row->>'id','')::uuid,nullif(old_row->>'id','')::uuid) end,
    (select pa.client_id from public.program_accounts pa where pa.id=resolved_account_id)
  );
  resolved_record_id:=coalesce(new_row->>'id',old_row->>'id');
  if tg_table_name='clients' then
    old_row:=old_row-array['email','phone_e164','whatsapp_e164','notes','birth_date','document_ciphertext','document_hash','document_last4'];
    new_row:=new_row-array['email','phone_e164','whatsapp_e164','notes','birth_date','document_ciphertext','document_hash','document_last4'];
  elsif tg_table_name='client_addresses' then
    old_row:=case when old_row is null then null else jsonb_build_object('id',old_row->'id','client_id',old_row->'client_id') end;
    new_row:=case when new_row is null then null else jsonb_build_object('id',new_row->'id','client_id',new_row->'client_id') end;
  elsif tg_table_name='travel_interests' then old_row:=old_row-array['details']; new_row:=new_row-array['details'];
  elsif tg_table_name='redemptions' then old_row:=old_row-array['description','notes','cash_reference_total','taxes_paid','additional_cash_paid','attributed_points_cost','effective_cost','savings_amount','travel_points_used']; new_row:=new_row-array['description','notes','cash_reference_total','taxes_paid','additional_cash_paid','attributed_points_cost','effective_cost','savings_amount','travel_points_used'];
  elsif tg_table_name='transfers' then old_row:=old_row-array['notes','source_points','destination_points','destination_base_points','bonus_points','bonus_percentage','parity']; new_row:=new_row-array['notes','source_points','destination_points','destination_base_points','bonus_points','bonus_percentage','parity'];
  elsif tg_table_name='point_transactions' then old_row:=old_row-array['description','points_delta','cash_total','cost_per_thousand','metadata']; new_row:=new_row-array['description','points_delta','cash_total','cost_per_thousand','metadata'];
  elsif tg_table_name='balance_snapshots' then old_row:=old_row-array['balance','average_cost_per_thousand','value_per_thousand','estimated_value','source_book_value','notes']; new_row:=new_row-array['balance','average_cost_per_thousand','value_per_thousand','estimated_value','source_book_value','notes'];
  end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(auth.uid(),resolved_client_id,lower(tg_op),tg_table_name,resolved_record_id,old_row,new_row);
  return coalesce(new,old);
end;
$$;

drop function if exists public.archive_client(uuid,text);

create or replace function public.archive_client(p_client_id uuid,p_confirmation_name text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); client_row public.clients%rowtype; affected_users uuid[]; contract_ids uuid[];
begin
  if actor_id is null or not exists(select 1 from public.staff_members sm where sm.user_id=actor_id and sm.active and sm.role in ('super_admin','manager')) then
    raise exception 'Somente gestores podem arquivar clientes.' using errcode='42501';
  end if;
  select * into client_row from public.clients where id=p_client_id for update;
  if client_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  if trim(coalesce(p_confirmation_name,''))<>client_row.full_name then raise exception 'CONFIRMATION_NAME_MISMATCH' using errcode='22023'; end if;
  if client_row.status='ended' then return jsonb_build_object('clientId',p_client_id,'status','ended','alreadyArchived',true); end if;
  select array_agg(user_id) into affected_users from public.client_users where client_id=p_client_id and active;
  select array_agg(id) into contract_ids from public.management_contracts where client_id=p_client_id and status in ('draft','active','paused');
  update public.clients set status='ended',archived_at=clock_timestamp(),archived_by=actor_id,
    archive_reason=nullif(left(trim(coalesce(p_reason,'')),500),''),updated_at=clock_timestamp() where id=p_client_id;
  update public.client_users set active=false,updated_at=clock_timestamp() where client_id=p_client_id and active;
  update public.management_contracts set status=case when status='active' then 'ended'::public.contract_status else 'cancelled'::public.contract_status end,
    updated_by=actor_id,revision_reason='Arquivamento do cliente',updated_at=clock_timestamp()
    where client_id=p_client_id and status in ('draft','active','paused');
  update public.profiles p set active=false,updated_at=clock_timestamp()
    where p.id=any(coalesce(affected_users,array[]::uuid[]))
      and not exists(select 1 from public.client_users cu where cu.user_id=p.id and cu.active)
      and not exists(select 1 from public.staff_members sm where sm.user_id=p.id and sm.active);
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor_id,p_client_id,'archive_client','clients',p_client_id::text,
    jsonb_build_object('status',client_row.status,'archivedAt',client_row.archived_at,'contractIds',coalesce(to_jsonb(contract_ids),'[]'::jsonb)),
    jsonb_build_object('status','ended','reason',nullif(left(trim(coalesce(p_reason,'')),500),'')));
  return jsonb_build_object('clientId',p_client_id,'status','ended','alreadyArchived',false);
end;
$$;

create or replace function public.get_client_reactivation_preview(p_client_ids uuid[] default null,p_search text default '')
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare normalized_search text:=nullif(trim(coalesce(p_search,'')),'');
begin
  perform public.require_client_admin();
  return (
    with rows as (
      select c.id,c.full_name,c.status,c.archived_at,c.archive_reason,c.row_version,
        public.safe_client_totals(c.id) totals,
        exists(select 1 from public.management_contracts mc where mc.client_id=c.id and mc.starts_on<=current_date and (mc.ends_on is null or mc.ends_on>=current_date) and mc.status in ('active','paused','ended')) has_reusable_contract,
        (select mc.status::text from public.management_contracts mc where mc.client_id=c.id order by case when mc.status='active' then 0 when mc.status='ended' then 1 else 2 end,mc.updated_at desc limit 1) contract_status
      from public.clients c
      where c.status='ended'
        and (p_client_ids is null or c.id=any(p_client_ids))
        and (normalized_search is null or c.full_name ilike '%'||normalized_search||'%')
    )
    select jsonb_build_object(
      'items',coalesce(jsonb_agg(jsonb_build_object(
        'clientId',id,'fullName',full_name,'status',status,'archivedAt',archived_at,'archiveReason',archive_reason,
        'rowVersion',row_version,'points',coalesce((totals->>'points')::bigint,0),'programs',coalesce((totals->>'programs')::integer,0),
        'hasReusableContract',has_reusable_contract,'contractStatus',contract_status,
        'contractReviewStatus',case when has_reusable_contract then 'complete' else 'pending_review' end
      ) order by full_name),'[]'::jsonb),
      'summary',jsonb_build_object(
        'selected',count(*),'withContract',count(*) filter(where has_reusable_contract),
        'pendingReview',count(*) filter(where not has_reusable_contract),
        'points',coalesce(sum(coalesce((totals->>'points')::bigint,0)),0),
        'programs',coalesce(sum(coalesce((totals->>'programs')::integer,0)),0)
      )
    ) from rows
  );
end;
$$;

create or replace function public.reactivate_client_admin(p_client_id uuid,p_note text default null,p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); client_row public.clients%rowtype; totals_before jsonb; totals_after jsonb; reusable_contract public.management_contracts%rowtype; contract_action text:='pending_review';
begin
  perform public.require_client_admin();
  select * into client_row from public.clients where id=p_client_id for update;
  if client_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_version is not null and client_row.row_version<>p_expected_version then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
  totals_before:=public.safe_client_totals(p_client_id);
  if client_row.status='active' then
    return jsonb_build_object('clientId',p_client_id,'status','already_active','pointsBefore',(totals_before->>'points')::bigint,'pointsAfter',(totals_before->>'points')::bigint,'programsBefore',(totals_before->>'programs')::integer,'programsAfter',(totals_before->>'programs')::integer,'contractAction',client_row.contract_review_status);
  end if;
  if client_row.status<>'ended' then raise exception 'CLIENT_NOT_ARCHIVED' using errcode='22023'; end if;
  select * into reusable_contract from public.management_contracts mc
  where mc.client_id=p_client_id and mc.starts_on<=current_date and (mc.ends_on is null or mc.ends_on>=current_date)
    and mc.status in ('active','paused','ended')
  order by case when mc.status='active' then 0 when mc.status='paused' then 1 else 2 end,mc.updated_at desc,mc.id desc limit 1 for update;
  if reusable_contract.id is not null then
    update public.management_contracts set status='active',updated_by=actor_id,
      revision_reason=coalesce(nullif(left(trim(coalesce(p_note,'')),500),''),'Reativação do cliente'),updated_at=clock_timestamp()
    where id=reusable_contract.id and status<>'active';
    contract_action:='preserved';
  end if;
  update public.clients set status='active',activated_at=coalesce(activated_at,clock_timestamp()),archived_at=null,archived_by=null,archive_reason=null,
    contract_review_status=case when reusable_contract.id is null then 'pending_review' else 'complete' end,updated_at=clock_timestamp()
  where id=p_client_id;
  totals_after:=public.safe_client_totals(p_client_id);
  if totals_before<>totals_after then raise exception 'LEDGER_CHANGED_DURING_REACTIVATION' using errcode='40001'; end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor_id,p_client_id,'reactivate_client','clients',p_client_id::text,
    jsonb_build_object('status',client_row.status,'archivedAt',client_row.archived_at,'archivedBy',client_row.archived_by,'archiveReason',client_row.archive_reason,'points',totals_before->'points','programs',totals_before->'programs'),
    jsonb_build_object('status','active','contractAction',contract_action,'contractId',reusable_contract.id,'note',nullif(left(trim(coalesce(p_note,'')),500),''),'points',totals_after->'points','programs',totals_after->'programs'));
  return jsonb_build_object('clientId',p_client_id,'status','reactivated','pointsBefore',(totals_before->>'points')::bigint,'pointsAfter',(totals_after->>'points')::bigint,'programsBefore',(totals_before->>'programs')::integer,'programsAfter',(totals_after->>'programs')::integer,'contractAction',contract_action);
end;
$$;

create or replace function public.bulk_reactivate_clients_admin(p_client_ids uuid[],p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); batch_row public.client_reactivation_batches%rowtype; cid uuid; result jsonb; safe_status text; safe_message text; requested integer:=0;
begin
  perform public.require_client_admin();
  if p_client_ids is null or cardinality(p_client_ids)=0 then raise exception 'NO_CLIENTS_SELECTED' using errcode='22023'; end if;
  select count(*) into requested from (select distinct unnest(p_client_ids) id) ids;
  insert into public.client_reactivation_batches(created_by,note,requested_count) values(actor_id,nullif(left(trim(coalesce(p_note,'')),500),''),requested) returning * into batch_row;
  for cid in select distinct unnest(p_client_ids) loop
    begin
      result:=public.reactivate_client_admin(cid,p_note,null);
      safe_status:=case when result->>'status'='reactivated' then 'reactivated' else 'already_active' end;
      safe_message:=case when safe_status='reactivated' then 'Cliente reativado.' else 'Cliente já estava ativo.' end;
      insert into public.client_reactivation_batch_items(batch_id,client_id,result_status,safe_message,points_before,points_after,programs_before,programs_after,contract_action)
      values(batch_row.id,cid,safe_status,safe_message,coalesce((result->>'pointsBefore')::bigint,0),coalesce((result->>'pointsAfter')::bigint,0),coalesce((result->>'programsBefore')::integer,0),coalesce((result->>'programsAfter')::integer,0),result->>'contractAction');
    exception when others then
      safe_status:=case when sqlstate in ('22023','P0002') then 'blocked' else 'failed' end;
      safe_message:=case when sqlerrm like '%CLIENT_NOT_ARCHIVED%' then 'Somente clientes arquivados podem ser reativados em lote.' when sqlerrm like '%CLIENT_NOT_FOUND%' then 'Cliente não encontrado.' else 'Não foi possível reativar este cliente.' end;
      insert into public.client_reactivation_batch_items(batch_id,client_id,result_status,safe_message) values(batch_row.id,cid,safe_status,safe_message);
    end;
  end loop;
  update public.client_reactivation_batches b set
    reactivated_count=(select count(*) from public.client_reactivation_batch_items i where i.batch_id=b.id and i.result_status='reactivated'),
    already_active_count=(select count(*) from public.client_reactivation_batch_items i where i.batch_id=b.id and i.result_status='already_active'),
    blocked_count=(select count(*) from public.client_reactivation_batch_items i where i.batch_id=b.id and i.result_status='blocked'),
    failed_count=(select count(*) from public.client_reactivation_batch_items i where i.batch_id=b.id and i.result_status='failed'),finished_at=clock_timestamp()
  where b.id=batch_row.id returning * into batch_row;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data)
  values(actor_id,'bulk_reactivate_clients','client_reactivation_batches',batch_row.id::text,jsonb_build_object('requested',batch_row.requested_count,'reactivated',batch_row.reactivated_count,'alreadyActive',batch_row.already_active_count,'blocked',batch_row.blocked_count,'failed',batch_row.failed_count));
  return jsonb_build_object('batchId',batch_row.id,'requested',batch_row.requested_count,'reactivated',batch_row.reactivated_count,'alreadyActive',batch_row.already_active_count,'blocked',batch_row.blocked_count,'failed',batch_row.failed_count,
    'items',coalesce((select jsonb_agg(jsonb_build_object('clientId',i.client_id,'status',i.result_status,'message',i.safe_message,'pointsBefore',i.points_before,'pointsAfter',i.points_after,'programsBefore',i.programs_before,'programsAfter',i.programs_after,'contractAction',i.contract_action) order by i.id) from public.client_reactivation_batch_items i where i.batch_id=batch_row.id),'[]'::jsonb));
end;
$$;

create or replace function public.get_admin_client_management(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare client_row public.clients%rowtype;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into client_row from public.clients where id=p_client_id;
  if client_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object(
    'client',jsonb_build_object(
      'clientId',client_row.id,'fullName',client_row.full_name,'displayName',client_row.display_name,
      'documentMasked',case when client_row.document_last4 is null then null when client_row.document_kind='cnpj' then '**.***.***/****-'||client_row.document_last4 else '***.***.***-'||right(client_row.document_last4,2) end,
      'documentKind',client_row.document_kind,'birthDate',client_row.birth_date,'email',client_row.email,'phone',client_row.phone_e164,'whatsapp',client_row.whatsapp_e164,
      'notes',client_row.notes,'status',client_row.status,'registrationSource',client_row.registration_source,'createdAt',client_row.created_at,
      'activatedAt',client_row.activated_at,'archivedAt',client_row.archived_at,'archiveReason',client_row.archive_reason,
      'contractReviewStatus',client_row.contract_review_status,'rowVersion',client_row.row_version,'legacyContactPending',client_row.legacy_contact_pending
    ),
    'address',(
      select jsonb_build_object('postalCode',a.postal_code,'street',a.street,'number',a.number,'complement',a.complement,'neighborhood',a.neighborhood,'city',a.city,'state',a.state,'countryCode',a.country_code)
      from public.client_addresses a where a.client_id=client_row.id limit 1
    ),
    'contract',(
      select jsonb_build_object('contractId',mc.id,'startsOn',mc.starts_on,'endsOn',mc.ends_on,'status',mc.status,'planName',mc.plan_name,'contractValue',mc.contract_value,'autoRenew',mc.auto_renew,'notes',mc.notes,'updatedAt',mc.updated_at)
      from public.management_contracts mc where mc.client_id=client_row.id
      order by case when mc.status='active' then 0 when mc.status='paused' then 1 else 2 end,mc.updated_at desc,mc.id desc limit 1
    ),
    'financial',public.safe_client_totals(client_row.id),
    'access',jsonb_build_object(
      'activeLinks',(select count(*) from public.client_direct_access_links l where l.client_id=client_row.id and l.status='active'),
      'revokedLinks',(select count(*) from public.client_direct_access_links l where l.client_id=client_row.id and l.status='revoked')
    ),
    'canEdit',public.has_staff_role(array['super_admin','manager']::public.app_role[])
  );
end;
$$;

create or replace function public.update_client_profile_admin(
  p_actor_user_id uuid,p_client_id uuid,p_expected_version bigint,p_full_name text,p_display_name text,
  p_birth_date date,p_email text,p_phone_e164 text,p_whatsapp_e164 text,p_notes text,p_address jsonb,p_secure_document jsonb default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare client_row public.clients%rowtype; address_row public.client_addresses%rowtype; changed_fields text[]:=array[]::text[]; normalized_email text:=nullif(lower(trim(coalesce(p_email,''))),''); normalized_phone text:=nullif(trim(coalesce(p_phone_e164,'')),''); normalized_whatsapp text:=nullif(trim(coalesce(p_whatsapp_e164,'')),'');
begin
  if not exists(select 1 from public.staff_members sm where sm.user_id=p_actor_user_id and sm.active and sm.role in ('super_admin','manager')) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into client_row from public.clients where id=p_client_id for update;
  if client_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  if client_row.row_version<>p_expected_version then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
  if char_length(trim(coalesce(p_full_name,'')))<2 then raise exception 'INVALID_NAME' using errcode='22023'; end if;
  if normalized_email is not null and normalized_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL' using errcode='22023'; end if;
  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'INVALID_PHONE' using errcode='22023'; end if;
  if normalized_whatsapp is not null and normalized_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'INVALID_WHATSAPP' using errcode='22023'; end if;
  if normalized_email is null and normalized_phone is null and not (client_row.status='lead' and client_row.legacy_contact_pending) then raise exception 'CONTACT_REQUIRED' using errcode='23514'; end if;
  if p_birth_date is not null and p_birth_date>current_date then raise exception 'INVALID_BIRTH_DATE' using errcode='22007'; end if;
  if client_row.full_name is distinct from trim(p_full_name) then changed_fields:=array_append(changed_fields,'fullName'); end if;
  if client_row.display_name is distinct from nullif(trim(coalesce(p_display_name,'')),'') then changed_fields:=array_append(changed_fields,'displayName'); end if;
  if client_row.birth_date is distinct from p_birth_date then changed_fields:=array_append(changed_fields,'birthDate'); end if;
  if client_row.email::text is distinct from normalized_email then changed_fields:=array_append(changed_fields,'email'); end if;
  if client_row.phone_e164 is distinct from normalized_phone then changed_fields:=array_append(changed_fields,'phone'); end if;
  if client_row.whatsapp_e164 is distinct from normalized_whatsapp then changed_fields:=array_append(changed_fields,'whatsapp'); end if;
  if client_row.notes is distinct from nullif(trim(coalesce(p_notes,'')),'') then changed_fields:=array_append(changed_fields,'notes'); end if;
  if p_secure_document is not null then changed_fields:=array_append(changed_fields,'document'); end if;
  update public.clients set full_name=trim(p_full_name),display_name=nullif(trim(coalesce(p_display_name,'')),''),birth_date=p_birth_date,
    email=normalized_email::extensions.citext,phone_e164=normalized_phone,whatsapp_e164=normalized_whatsapp,notes=nullif(trim(coalesce(p_notes,'')),''),
    document_ciphertext=case when p_secure_document is null then document_ciphertext else p_secure_document->>'ciphertext' end,
    document_hash=case when p_secure_document is null then document_hash else p_secure_document->>'hash' end,
    document_last4=case when p_secure_document is null then document_last4 else p_secure_document->>'last4' end,
    document_kind=case when p_secure_document is null then document_kind else p_secure_document->>'kind' end,
    legacy_contact_pending=case when normalized_email is not null or normalized_phone is not null then false else legacy_contact_pending end,
    updated_at=clock_timestamp() where id=p_client_id returning * into client_row;
  if p_address is not null and jsonb_typeof(p_address)='object' then
    if nullif(trim(coalesce(p_address->>'postalCode','')),'') is null or nullif(trim(coalesce(p_address->>'street','')),'') is null or nullif(trim(coalesce(p_address->>'number','')),'') is null or nullif(trim(coalesce(p_address->>'neighborhood','')),'') is null or nullif(trim(coalesce(p_address->>'city','')),'') is null then raise exception 'INCOMPLETE_ADDRESS' using errcode='22023'; end if;
    insert into public.client_addresses(client_id,postal_code,street,number,complement,neighborhood,city,state,country_code,created_by)
    values(p_client_id,trim(p_address->>'postalCode'),trim(p_address->>'street'),trim(p_address->>'number'),nullif(trim(coalesce(p_address->>'complement','')),''),trim(p_address->>'neighborhood'),trim(p_address->>'city'),upper(trim(p_address->>'state')),upper(coalesce(nullif(trim(p_address->>'countryCode'),''),'BR')),p_actor_user_id)
    on conflict(client_id) do update set postal_code=excluded.postal_code,street=excluded.street,number=excluded.number,complement=excluded.complement,neighborhood=excluded.neighborhood,city=excluded.city,state=excluded.state,country_code=excluded.country_code,updated_at=clock_timestamp()
    returning * into address_row;
    changed_fields:=array_append(changed_fields,'address');
  end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(p_actor_user_id,p_client_id,'update_client_profile_admin','clients',p_client_id::text,jsonb_build_object('rowVersion',p_expected_version),jsonb_build_object('rowVersion',client_row.row_version,'changedFields',changed_fields,'sensitiveValuesProtected',true));
  return jsonb_build_object('clientId',p_client_id,'rowVersion',client_row.row_version,'changedFields',changed_fields);
end;
$$;

create or replace function public.update_client_contract_admin(
  p_client_id uuid,p_contract_id uuid,p_starts_on date,p_ends_on date,p_plan_name text,p_contract_value numeric,
  p_status public.contract_status,p_auto_renew boolean,p_notes text,p_reason text,p_expected_client_version bigint,p_expected_contract_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); client_row public.clients%rowtype; contract_row public.management_contracts%rowtype; old_contract jsonb; dates_changed boolean:=false;
begin
  perform public.require_client_admin();
  select * into client_row from public.clients where id=p_client_id for update;
  if client_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  if client_row.row_version<>p_expected_client_version then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
  if p_starts_on is null then raise exception 'CONTRACT_START_REQUIRED' using errcode='22007'; end if;
  if p_ends_on is not null and p_ends_on<p_starts_on then raise exception 'INVALID_CONTRACT_DATES' using errcode='22007'; end if;
  if p_contract_value is not null and p_contract_value<0 then raise exception 'INVALID_CONTRACT_VALUE' using errcode='22003'; end if;
  if p_status not in ('draft','active','paused','ended','cancelled') then raise exception 'INVALID_CONTRACT_STATUS' using errcode='22023'; end if;
  if p_contract_id is not null then
    select * into contract_row from public.management_contracts where id=p_contract_id and client_id=p_client_id for update;
    if contract_row.id is null then raise exception 'CONTRACT_NOT_FOUND' using errcode='P0002'; end if;
    if p_expected_contract_updated_at is not null and contract_row.updated_at<>p_expected_contract_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
    dates_changed:=contract_row.starts_on is distinct from p_starts_on or contract_row.ends_on is distinct from p_ends_on;
    if dates_changed and char_length(trim(coalesce(p_reason,'')))<5 then raise exception 'CHANGE_REASON_REQUIRED' using errcode='22023'; end if;
    old_contract:=jsonb_build_object('startsOn',contract_row.starts_on,'endsOn',contract_row.ends_on,'status',contract_row.status,'planName',contract_row.plan_name,'contractValue',contract_row.contract_value,'autoRenew',contract_row.auto_renew);
    update public.management_contracts set starts_on=p_starts_on,ends_on=p_ends_on,status=p_status,plan_name=nullif(trim(coalesce(p_plan_name,'')),''),contract_value=p_contract_value,auto_renew=coalesce(p_auto_renew,false),notes=nullif(trim(coalesce(p_notes,'')),''),revision_reason=nullif(left(trim(coalesce(p_reason,'')),500),''),updated_by=actor_id,updated_at=clock_timestamp() where id=contract_row.id returning * into contract_row;
  else
    if p_status='active' and exists(select 1 from public.management_contracts mc where mc.client_id=p_client_id and mc.status='active' and daterange(mc.starts_on,mc.ends_on,'[]')&&daterange(p_starts_on,p_ends_on,'[]')) then raise exception 'ACTIVE_CONTRACT_OVERLAP' using errcode='23P01'; end if;
    insert into public.management_contracts(client_id,starts_on,ends_on,status,plan_name,contract_value,auto_renew,notes,revision_reason,created_by,updated_by)
    values(p_client_id,p_starts_on,p_ends_on,p_status,nullif(trim(coalesce(p_plan_name,'')),''),p_contract_value,coalesce(p_auto_renew,false),nullif(trim(coalesce(p_notes,'')),''),nullif(left(trim(coalesce(p_reason,'')),500),''),actor_id,actor_id) returning * into contract_row;
    old_contract:=null;
  end if;
  update public.clients set contract_review_status=case when p_status in ('active','paused') then 'complete' else 'pending_review' end,updated_at=clock_timestamp() where id=p_client_id returning * into client_row;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor_id,p_client_id,'update_client_contract_admin','management_contracts',contract_row.id::text,old_contract,jsonb_build_object('startsOn',contract_row.starts_on,'endsOn',contract_row.ends_on,'status',contract_row.status,'planName',contract_row.plan_name,'contractValue',contract_row.contract_value,'autoRenew',contract_row.auto_renew,'reason',nullif(left(trim(coalesce(p_reason,'')),500),'')));
  return jsonb_build_object('contractId',contract_row.id,'clientId',p_client_id,'rowVersion',client_row.row_version,'updatedAt',contract_row.updated_at,'created',p_contract_id is null);
end;
$$;

create or replace function public.preview_client_name_cleanup_admin()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_client_admin();
  return jsonb_build_object('items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'clientId',c.id,'currentName',suggestion->>'currentName','suggestedName',suggestion->>'suggestedName','removedText',suggestion->>'removedText',
      'origin',case when exists(select 1 from public.client_onboarding_submissions s where s.client_id=c.id) then 'onboarding'
        when exists(select 1 from public.external_source_map esm where esm.entity_type='client' and esm.local_entity_id=c.id and esm.source_system like 'iddas%') then 'iddas'
        when exists(select 1 from public.external_source_map esm where esm.entity_type='client' and esm.local_entity_id=c.id and esm.source_system='notion') then 'notion'
        else c.registration_source end,
      'status',c.status,'rowVersion',c.row_version
    ) order by c.full_name)
    from public.clients c cross join lateral public.suggest_client_name_cleanup(c.full_name) s(suggestion)
    where suggestion is not null
  ),'[]'::jsonb));
end;
$$;

create or replace function public.apply_client_name_cleanup_admin(p_client_id uuid,p_new_name text,p_reason text default null,p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); client_row public.clients%rowtype; suggestion jsonb; action_row public.client_name_cleanup_actions%rowtype; normalized_name text:=trim(coalesce(p_new_name,''));
begin
  perform public.require_client_admin();
  select * into client_row from public.clients where id=p_client_id for update;
  if client_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_version is not null and client_row.row_version<>p_expected_version then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
  suggestion:=public.suggest_client_name_cleanup(client_row.full_name);
  if suggestion is null then return jsonb_build_object('clientId',p_client_id,'status','already_clean','fullName',client_row.full_name,'rowVersion',client_row.row_version); end if;
  if char_length(regexp_replace(normalized_name,'[^[:alnum:]]','','g'))<2 then raise exception 'INVALID_NAME' using errcode='22023'; end if;
  insert into public.client_name_cleanup_actions(client_id,old_name,new_name,removed_text,reason,applied_by)
  values(p_client_id,client_row.full_name,normalized_name,suggestion->>'removedText',nullif(left(trim(coalesce(p_reason,'')),500),''),actor_id) returning * into action_row;
  update public.clients set full_name=normalized_name,updated_at=clock_timestamp() where id=p_client_id returning * into client_row;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor_id,p_client_id,'apply_client_name_cleanup_admin','clients',p_client_id::text,jsonb_build_object('fullName',action_row.old_name),jsonb_build_object('fullName',action_row.new_name,'removedText',action_row.removed_text,'actionId',action_row.id,'reason',action_row.reason));
  return jsonb_build_object('clientId',p_client_id,'status','applied','fullName',client_row.full_name,'rowVersion',client_row.row_version,'actionId',action_row.id);
end;
$$;

create or replace function public.revert_client_name_cleanup_admin(p_action_id uuid,p_reason text,p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); action_row public.client_name_cleanup_actions%rowtype; client_row public.clients%rowtype;
begin
  perform public.require_client_admin();
  select * into action_row from public.client_name_cleanup_actions where id=p_action_id for update;
  if action_row.id is null then raise exception 'CLEANUP_ACTION_NOT_FOUND' using errcode='P0002'; end if;
  if action_row.reverted_at is not null then return jsonb_build_object('actionId',p_action_id,'status','already_reverted'); end if;
  select * into client_row from public.clients where id=action_row.client_id for update;
  if p_expected_version is not null and client_row.row_version<>p_expected_version then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
  if client_row.full_name<>action_row.new_name then raise exception 'NAME_CHANGED_AFTER_CLEANUP' using errcode='40001'; end if;
  update public.clients set full_name=action_row.old_name,updated_at=clock_timestamp() where id=client_row.id returning * into client_row;
  update public.client_name_cleanup_actions set reverted_by=actor_id,reverted_at=clock_timestamp(),revert_reason=nullif(left(trim(coalesce(p_reason,'')),500),'') where id=p_action_id;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor_id,client_row.id,'revert_client_name_cleanup_admin','clients',client_row.id::text,jsonb_build_object('fullName',action_row.new_name),jsonb_build_object('fullName',action_row.old_name,'actionId',action_row.id,'reason',nullif(left(trim(coalesce(p_reason,'')),500),'')));
  return jsonb_build_object('actionId',p_action_id,'status','reverted','clientId',client_row.id,'fullName',client_row.full_name,'rowVersion',client_row.row_version);
end;
$$;

create or replace function public.get_client_name_cleanup_history_admin(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  perform public.require_client_admin();
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'actionId',a.id,'oldName',a.old_name,'newName',a.new_name,'removedText',a.removed_text,'reason',a.reason,
    'appliedAt',a.applied_at,'revertedAt',a.reverted_at,'revertReason',a.revert_reason
  ) order by a.applied_at desc) from public.client_name_cleanup_actions a where a.client_id=p_client_id),'[]'::jsonb));
end;
$$;

create or replace function public.get_admin_clients(
  p_limit integer default 50,p_offset integer default 0,p_search text default '',p_status text default 'all'
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0); normalized_search text:=nullif(trim(coalesce(p_search,'')),''); normalized_status text:=lower(coalesce(nullif(trim(p_status),''),'all'));
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if normalized_status not in ('all','lead','active','paused','ended','archived','contract_pending') then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
  if normalized_status='archived' then normalized_status:='ended'; end if;
  return (
    with base as materialized (
      select c.id,c.public_id,c.full_name,c.email::text email,c.phone_e164,c.status,c.created_at,c.archived_at,c.archive_reason,c.contract_review_status,c.registration_source,c.row_version,
        contract_data.contract_json,coalesce((public.safe_client_totals(c.id)->>'points')::bigint,0) total_points,
        coalesce((public.safe_client_totals(c.id)->>'programs')::integer,0) programs_count,
        coalesce((select sum(r.savings_amount) from public.redemptions r where r.client_id=c.id and r.status='confirmed'),0) generated_savings,
        (select count(*) from public.program_accounts pa where pa.client_id=c.id and pa.active and pa.club_active) active_clubs_count,
        (select min(el.expires_on) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=c.id and el.status='active' and el.remaining_points>0 and el.expires_on>=current_date) next_expiration_date,
        coalesce((select sum(el.remaining_points) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=c.id and el.status='active' and el.remaining_points>0 and el.expires_on between current_date and current_date+90),0) expiring_points,
        (select max(pt.occurred_at) from public.point_transactions pt join public.program_accounts pa on pa.id=pt.account_id where pa.client_id=c.id) last_movement_at
      from public.clients c
      left join lateral (
        select jsonb_build_object('contractId',mc.id,'startsOn',mc.starts_on,'endsOn',mc.ends_on,'status',mc.status,'planName',mc.plan_name,'contractValue',mc.contract_value,'autoRenew',mc.auto_renew,'updatedAt',mc.updated_at) contract_json
        from public.management_contracts mc where mc.client_id=c.id order by case when mc.status='active' then 0 when mc.status='paused' then 1 else 2 end,mc.updated_at desc,mc.id desc limit 1
      ) contract_data on true
      where normalized_search is null or c.full_name ilike '%'||normalized_search||'%'
    ), filtered as materialized (
      select * from base where normalized_status='all' or (normalized_status='contract_pending' and contract_review_status='pending_review') or status::text=normalized_status
    ), paged as (select * from filtered order by full_name,id limit safe_limit offset safe_offset)
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.id,'clientId',p.id,'publicId',p.public_id,'fullName',p.full_name,'email',p.email,'phone',p.phone_e164,'status',p.status,'createdAt',p.created_at,
        'archivedAt',p.archived_at,'archiveReason',p.archive_reason,'contractReviewStatus',p.contract_review_status,'registrationSource',p.registration_source,'rowVersion',p.row_version,
        'contract',coalesce(p.contract_json,'null'::jsonb),'pointsBalance',p.total_points,'totalPoints',p.total_points,'generatedSavings',p.generated_savings,
        'programsCount',p.programs_count,'activeClubsCount',p.active_clubs_count,'nextExpirationDate',p.next_expiration_date,'expiringPoints',p.expiring_points,'lastMovementAt',p.last_movement_at
      ) order by p.full_name,p.id) from paged p),'[]'::jsonb),
      'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset,
      'counts',jsonb_build_object(
        'all',(select count(*) from base),'active',(select count(*) from base where status='active'),'leads',(select count(*) from base where status='lead'),
        'archived',(select count(*) from base where status='ended'),'contractPending',(select count(*) from base where contract_review_status='pending_review')
      )
    )
  );
end;
$$;

revoke insert,update,delete on public.clients,public.client_addresses,public.management_contracts from authenticated;

revoke all on function public.require_client_admin(),public.get_client_reactivation_preview(uuid[],text),public.reactivate_client_admin(uuid,text,bigint),public.bulk_reactivate_clients_admin(uuid[],text),public.get_admin_client_management(uuid),public.update_client_contract_admin(uuid,uuid,date,date,text,numeric,public.contract_status,boolean,text,text,bigint,timestamptz),public.preview_client_name_cleanup_admin(),public.apply_client_name_cleanup_admin(uuid,text,text,bigint),public.revert_client_name_cleanup_admin(uuid,text,bigint),public.get_client_name_cleanup_history_admin(uuid),public.get_admin_clients(integer,integer,text,text),public.archive_client(uuid,text,text) from public,anon;

grant execute on function public.require_client_admin(),public.get_client_reactivation_preview(uuid[],text),public.reactivate_client_admin(uuid,text,bigint),public.bulk_reactivate_clients_admin(uuid[],text),public.get_admin_client_management(uuid),public.update_client_contract_admin(uuid,uuid,date,date,text,numeric,public.contract_status,boolean,text,text,bigint,timestamptz),public.preview_client_name_cleanup_admin(),public.apply_client_name_cleanup_admin(uuid,text,text,bigint),public.revert_client_name_cleanup_admin(uuid,text,bigint),public.get_client_name_cleanup_history_admin(uuid),public.get_admin_clients(integer,integer,text,text),public.archive_client(uuid,text,text) to authenticated;

revoke all on function public.update_client_profile_admin(uuid,uuid,bigint,text,text,date,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.update_client_profile_admin(uuid,uuid,bigint,text,text,date,text,text,text,text,jsonb,jsonb) to service_role;

grant execute on function public.suggest_client_name_cleanup(text),public.safe_client_totals(uuid) to service_role;

notify pgrst,'reload schema';

commit;
