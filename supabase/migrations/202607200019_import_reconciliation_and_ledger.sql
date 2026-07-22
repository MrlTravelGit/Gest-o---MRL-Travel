begin;

alter type public.point_entry_category add value if not exists 'initial_balance_import';

commit;
begin;

alter table public.import_staging_rows drop constraint if exists staging_resolution_valid;
update public.import_staging_rows set resolution_status = case resolution_status
  when 'pending' then 'pending_decision'
  when 'create_new_lead' then 'ready_create'
  when 'create_new' then 'ready_create'
  when 'link_existing' then 'ready_link_existing'
  when 'propose_update' then 'ready_update'
  when 'import_internal' then 'ready_import_internal'
  when 'declared_pending' then 'pending_decision'
  when 'skip' then 'ignored_by_admin'
  when 'unchanged' then 'ready_unchanged'
  when 'rolled_back' then 'failed_commit'
  else resolution_status end;
alter table public.import_staging_rows add constraint staging_resolution_valid check (resolution_status in (
  'ready_create','ready_update','ready_link_existing','ready_unchanged','ready_import_internal',
  'pending_decision','blocked_invalid','ignored_duplicate_view','ignored_by_admin','committed','failed_commit'
));
alter table public.import_staging_rows
  add column if not exists blocks_commit boolean not null default false,
  add column if not exists suggested_action text,
  add column if not exists chosen_action text,
  add column if not exists before_payload jsonb not null default '{}'::jsonb,
  add column if not exists resolution_reason text,
  add column if not exists commit_error_code text;
update public.import_staging_rows set blocks_commit = resolution_status in ('pending_decision','blocked_invalid');

alter table public.import_row_issues drop constraint if exists import_issue_severity_valid;
alter table public.import_row_issues add constraint import_issue_severity_valid check (severity in ('info','warning','error','fatal'));

create table public.import_balance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  staging_row_id uuid not null unique references public.import_staging_rows(id) on delete cascade,
  client_id uuid references public.clients(id) on delete restrict,
  client_source_page_id text,
  program_id uuid references public.loyalty_programs(id) on delete restrict,
  account_id uuid references public.program_accounts(id) on delete restrict,
  current_points bigint not null default 0 check (current_points >= 0),
  imported_points bigint not null default 0 check (imported_points >= 0),
  difference_points bigint not null default 0,
  cost_per_thousand numeric(14,4) not null default 0 check (cost_per_thousand >= 0),
  estimated_value numeric(16,2) generated always as (round((imported_points::numeric / 1000) * cost_per_thousand, 2)) stored,
  expiring_points bigint not null default 0 check (expiring_points >= 0),
  expires_on date,
  reference_date date,
  suggested_action text not null,
  chosen_action text,
  decision_reason text,
  status text not null default 'review',
  operation_id uuid unique,
  transaction_id uuid references public.point_transactions(id) on delete restrict,
  expiration_lot_id uuid references public.expiration_lots(id) on delete restrict,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint import_balance_action_valid check (suggested_action in ('create_imported_initial_balance','link_as_unchanged','keep_current','adjust_to_imported_snapshot','treat_imported_as_additional_entry','create_zero_wallet','ignore') and (chosen_action is null or chosen_action in ('create_imported_initial_balance','link_as_unchanged','keep_current','adjust_to_imported_snapshot','treat_imported_as_additional_entry','create_zero_wallet','ignore'))),
  constraint import_balance_status_valid check (status in ('review','ready','committed','ignored','failed','reversed'))
);
create index import_balance_batch_idx on public.import_balance_reconciliations(batch_id,status);
alter table public.import_balance_reconciliations enable row level security;
create policy import_balance_staff_select on public.import_balance_reconciliations for select to authenticated using (public.is_staff());
create policy import_balance_service_all on public.import_balance_reconciliations for all to service_role using (true) with check (true);
revoke all on public.import_balance_reconciliations from public, anon, authenticated;
grant select on public.import_balance_reconciliations to authenticated;
grant all on public.import_balance_reconciliations to service_role;

create or replace function public.import_operation_uuid(p_batch_id uuid, p_row_id uuid, p_suffix text default 'commit')
returns uuid language sql immutable set search_path = pg_catalog, public as $$
  select (substr(x,1,8)||'-'||substr(x,9,4)||'-'||substr(x,13,4)||'-'||substr(x,17,4)||'-'||substr(x,21,12))::uuid
  from (select md5(p_batch_id::text||':'||p_row_id::text||':'||p_suffix) x) s;
$$;

create or replace function public.import_idempotency_uuid(p_source_external_id text, p_fallback text, p_suffix text)
returns uuid language sql immutable set search_path = pg_catalog, public as $$
  select (substr(x,1,8)||'-'||substr(x,9,4)||'-'||substr(x,13,4)||'-'||substr(x,17,4)||'-'||substr(x,21,12))::uuid
  from (select md5('notion:mrl_notion_export:'||coalesce(nullif(p_source_external_id,''),p_fallback)||':'||p_suffix||':v1') x) s;
$$;

create or replace function public.refresh_import_batch_summary(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  result:=jsonb_build_object(
    'byState',(select coalesce(jsonb_object_agg(resolution_status,total),'{}'::jsonb) from (select resolution_status,count(*) total from public.import_staging_rows where batch_id=p_batch_id group by resolution_status) s),
    'conflicts',(select count(*) from public.import_staging_rows where batch_id=p_batch_id and blocks_commit),
    'invalid',(select count(*) from public.import_staging_rows where batch_id=p_batch_id and resolution_status='blocked_invalid'),
    'blockingRows',(select count(*) from public.import_staging_rows where batch_id=p_batch_id and blocks_commit),
    'balancePreview',jsonb_build_object(
      'initialBalances',(select count(*) from public.import_balance_reconciliations where batch_id=p_batch_id and coalesce(chosen_action,suggested_action)='create_imported_initial_balance'),
      'equalBalances',(select count(*) from public.import_balance_reconciliations where batch_id=p_batch_id and coalesce(chosen_action,suggested_action)='link_as_unchanged'),
      'divergences',(select count(*) from public.import_balance_reconciliations where batch_id=p_batch_id and chosen_action is null and current_points>0 and current_points<>imported_points),
      'zeroWallets',(select count(*) from public.import_balance_reconciliations where batch_id=p_batch_id and coalesce(chosen_action,suggested_action)='create_zero_wallet'),
      'ledgerPoints',(select coalesce(sum(case coalesce(chosen_action,suggested_action) when 'create_imported_initial_balance' then imported_points when 'adjust_to_imported_snapshot' then imported_points-current_points when 'treat_imported_as_additional_entry' then imported_points else 0 end),0) from public.import_balance_reconciliations where batch_id=p_batch_id),
      'patrimony',(select coalesce(round(sum(case when coalesce(chosen_action,suggested_action) in ('create_imported_initial_balance','adjust_to_imported_snapshot','treat_imported_as_additional_entry') then estimated_value else 0 end),2),0) from public.import_balance_reconciliations where batch_id=p_batch_id)
    )
  );
  update public.import_batches set dry_run_summary=dry_run_summary||result where id=p_batch_id;
  return result;
end; $$;

create or replace function public.get_admin_import_batch(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.import_batches where id=p_batch_id) then raise exception 'BATCH_NOT_FOUND' using errcode='P0002'; end if;
  return (select jsonb_build_object(
    'batch',jsonb_build_object('batchId',b.id,'status',b.status,'sourceSystem',b.source_system,'adapterVersion',b.adapter_version,'originalFilename',b.original_filename,'summary',b.dry_run_summary,'createdAt',b.created_at,'finishedAt',b.finished_at,'rollbackStatus',b.rollback_status,'requestId',b.request_id),
    'files',coalesce((select jsonb_agg(jsonb_build_object('fileId',f.id,'logicalType',f.logical_type,'path',f.path,'rowCount',f.row_count,'encoding',f.detected_encoding,'delimiter',f.delimiter,'isCanonical',f.is_canonical,'ignoredReason',f.ignored_reason) order by f.path) from public.import_files f where f.batch_id=b.id),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('rowId',r.id,'rowNumber',r.row_number,'entityType',r.entity_type,'sourceExternalId',r.source_external_id,'preview',jsonb_strip_nulls(jsonb_build_object('title',r.normalized_payload->>'title','fullName',r.normalized_payload->>'fullName','clientLabel',r.normalized_payload->>'clientLabel','status',r.normalized_payload->>'status','programName',r.normalized_payload->>'programName')),'validationStatus',r.validation_status,'resolutionStatus',r.resolution_status,'blocksCommit',r.blocks_commit,'suggestedAction',r.suggested_action,'chosenAction',r.chosen_action,'targetId',r.target_id,'issues',coalesce((select jsonb_agg(jsonb_build_object('severity',i.severity,'code',i.stable_code,'fieldName',i.field_name,'message',i.safe_message,'resolution',i.resolution) order by i.id) from public.import_row_issues i where i.staging_row_id=r.id),'[]'::jsonb)) order by r.entity_type,r.row_number) from public.import_staging_rows r where r.batch_id=b.id),'[]'::jsonb),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('reconciliationId',br.id,'rowId',br.staging_row_id,'clientId',br.client_id,'clientSourceSuffix',right(br.client_source_page_id,6),'programId',br.program_id,'currentPoints',br.current_points,'importedPoints',br.imported_points,'differencePoints',br.difference_points,'costPerThousand',br.cost_per_thousand,'estimatedValue',br.estimated_value,'expiringPoints',br.expiring_points,'expiresOn',br.expires_on,'suggestedAction',br.suggested_action,'chosenAction',br.chosen_action,'decisionReason',br.decision_reason,'status',br.status) order by sr.row_number) from public.import_balance_reconciliations br join public.import_staging_rows sr on sr.id=br.staging_row_id where br.batch_id=b.id),'[]'::jsonb),
    'canManage',public.can_manage_imports()
  ) from public.import_batches b where b.id=p_batch_id);
end; $$;

drop function if exists public.admin_resolve_import_row(uuid,text,uuid,jsonb);
create or replace function public.admin_resolve_import_row(p_row_id uuid, p_resolution text, p_target_id uuid default null, p_normalized_patch jsonb default '{}'::jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare actor uuid:=auth.uid(); row_record public.import_staging_rows%rowtype; final_status text; chosen text;
begin
  if actor is null or not public.can_manage_imports() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into row_record from public.import_staging_rows where id=p_row_id for update;
  if not found then raise exception 'INVALID_ROW' using errcode='P0002'; end if;
  if not exists(select 1 from public.import_batches where id=row_record.batch_id and status='review') then raise exception 'BATCH_NOT_REVIEWABLE' using errcode='55000'; end if;
  if p_resolution not in ('ready_create','ready_update','ready_link_existing','ready_unchanged','ready_import_internal','ignored_by_admin','create_imported_initial_balance','link_as_unchanged','keep_current','adjust_to_imported_snapshot','treat_imported_as_additional_entry','create_zero_wallet','ignore') then raise exception 'INVALID_RESOLUTION' using errcode='22023'; end if;
  if p_resolution='ready_link_existing' and p_target_id is null then raise exception 'TARGET_REQUIRED' using errcode='22023'; end if;
  if p_resolution in ('adjust_to_imported_snapshot','treat_imported_as_additional_entry') and length(trim(coalesce(p_reason,'')))<5 then raise exception 'DECISION_REASON_REQUIRED' using errcode='22023'; end if;
  chosen:=p_resolution;
  final_status:=case when p_resolution='ignore' then 'ignored_by_admin' when p_resolution in ('create_imported_initial_balance','adjust_to_imported_snapshot','treat_imported_as_additional_entry','create_zero_wallet') then 'ready_create' when p_resolution in ('link_as_unchanged','keep_current') then 'ready_unchanged' else p_resolution end;
  update public.import_staging_rows set resolution_status=final_status,target_id=coalesce(p_target_id,target_id),normalized_payload=normalized_payload||coalesce(p_normalized_patch,'{}'::jsonb),chosen_action=chosen,resolution_reason=nullif(trim(coalesce(p_reason,'')),''),blocks_commit=false where id=p_row_id;
  update public.import_balance_reconciliations set chosen_action=chosen,decision_reason=nullif(trim(coalesce(p_reason,'')),''),status=case when chosen='ignore' then 'ignored' else 'ready' end,updated_at=clock_timestamp() where staging_row_id=p_row_id;
  perform public.refresh_import_batch_summary(row_record.batch_id);
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data) values(actor,'resolve_import_row','import_staging_rows',p_row_id::text,jsonb_build_object('batchId',row_record.batch_id,'entityType',row_record.entity_type,'resolution',chosen,'reasonProvided',p_reason is not null));
  return jsonb_build_object('rowId',p_row_id,'resolutionStatus',final_status,'chosenAction',chosen);
end; $$;

create or replace function public.admin_bulk_resolve_import_rows(p_batch_id uuid, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare actor uuid:=auth.uid(); affected integer:=0;
begin
  if actor is null or not public.can_manage_imports() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.import_batches where id=p_batch_id and status='review') then raise exception 'BATCH_NOT_REVIEWABLE' using errcode='55000'; end if;
  if p_action not in ('import_zero_system_balances','keep_equal_balances','create_zero_wallets','skip_balances','import_internal_tasks') then raise exception 'INVALID_RESOLUTION' using errcode='22023'; end if;
  if p_action='import_internal_tasks' then
    update public.import_staging_rows set resolution_status='ready_import_internal',chosen_action='ready_import_internal',blocks_commit=false,resolution_reason=p_reason where batch_id=p_batch_id and entity_type='task' and resolution_status='pending_decision';
  else
    update public.import_balance_reconciliations br set chosen_action=case p_action when 'import_zero_system_balances' then 'create_imported_initial_balance' when 'keep_equal_balances' then 'link_as_unchanged' when 'create_zero_wallets' then 'create_zero_wallet' else 'ignore' end,status=case when p_action='skip_balances' then 'ignored' else 'ready' end,decision_reason=p_reason,updated_at=clock_timestamp()
    where br.batch_id=p_batch_id and (p_action='skip_balances' or (br.program_id is not null and (br.client_id is not null or br.client_source_page_id is not null) and not exists(select 1 from public.import_row_issues i where i.staging_row_id=br.staging_row_id and i.stable_code in ('AMBIGUOUS_POINTS','UNRESOLVED_PROGRAM','UNRESOLVED_RELATION','EXPIRED_EXPIRATION','EXPIRATION_EXCEEDS_BALANCE')) and ((p_action='import_zero_system_balances' and br.current_points=0 and br.imported_points>0) or (p_action='keep_equal_balances' and br.current_points=br.imported_points) or (p_action='create_zero_wallets' and br.imported_points=0))));
    update public.import_staging_rows sr set chosen_action=br.chosen_action,resolution_status=case when br.chosen_action='ignore' then 'ignored_by_admin' when br.chosen_action in ('link_as_unchanged','keep_current') then 'ready_unchanged' else 'ready_create' end,blocks_commit=false,resolution_reason=p_reason from public.import_balance_reconciliations br where br.staging_row_id=sr.id and br.batch_id=p_batch_id and br.chosen_action is not null;
  end if;
  get diagnostics affected=row_count;
  perform public.refresh_import_batch_summary(p_batch_id);
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data) values(actor,'bulk_resolve_import_rows','import_batches',p_batch_id::text,jsonb_build_object('action',p_action,'affected',affected));
  return jsonb_build_object('batchId',p_batch_id,'affected',affected);
end; $$;

create or replace function public.admin_commit_import_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare actor uuid:=auth.uid(); b public.import_batches%rowtype; r record; br record; v_client_id uuid; v_account_id uuid; v_program_id uuid; v_current_balance bigint; v_new_balance bigint; v_delta bigint; v_current_average numeric:=0; v_new_average numeric:=0; v_program_value numeric:=0; v_tx_id uuid; v_exp_id uuid; created_clients integer:=0; created_tasks integer:=0; created_passages integer:=0; ledger_entries integer:=0; wallets integer:=0; imported_points bigint:=0; imported_value numeric:=0;
begin
  if actor is null or not public.can_manage_imports() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into b from public.import_batches where id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND' using errcode='P0002'; end if;
  if b.status='committed' then return jsonb_build_object('batchId',p_batch_id,'idempotentReplay',true,'committed',b.dry_run_summary->'committed'); end if;
  if b.status<>'review' or exists(select 1 from public.import_staging_rows where batch_id=p_batch_id and blocks_commit) then raise exception 'BATCH_NOT_REVIEWED' using errcode='55000'; end if;
  update public.import_batches set status='committing',confirmed_at=clock_timestamp(),confirmed_by=actor where id=p_batch_id;

  for r in select * from public.import_staging_rows where batch_id=p_batch_id and entity_type='client' order by row_number for update loop
    v_client_id:=r.target_id;
    if r.resolution_status='ready_create' then
      insert into public.clients(full_name,first_name_normalized,email,phone_e164,status,notes,created_by) values(r.normalized_payload->>'fullName',public.normalize_first_name(r.normalized_payload->>'fullName'),nullif(r.normalized_payload->>'email','')::extensions.citext,nullif(r.normalized_payload->>'phoneE164',''),'lead','Cadastro legado importado; revisão e ativação obrigatórias.',actor) returning id into v_client_id; created_clients:=created_clients+1;
    elsif r.resolution_status='ready_update' and v_client_id is not null then
      update public.clients set full_name=coalesce(nullif(full_name,''),r.normalized_payload->>'fullName'),email=coalesce(email,nullif(r.normalized_payload->>'email','')::extensions.citext),phone_e164=coalesce(phone_e164,nullif(r.normalized_payload->>'phoneE164','')),updated_at=clock_timestamp() where id=v_client_id;
    end if;
    if r.resolution_status in ('ready_create','ready_update','ready_link_existing','ready_unchanged') and v_client_id is not null then
      update public.import_staging_rows set target_id=v_client_id,resolution_status='committed',committed_at=clock_timestamp() where id=r.id;
      if r.source_external_id is not null then insert into public.external_source_map(source_system,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id,source_updated_at) values('notion',r.source_external_id,'client',v_client_id,p_batch_id,p_batch_id,nullif(r.normalized_payload->>'sourceUpdatedAt','')::timestamptz) on conflict(source_system,source_database_id,source_page_id,entity_type) do update set local_entity_id=excluded.local_entity_id,last_import_batch_id=excluded.last_import_batch_id,source_updated_at=excluded.source_updated_at,updated_at=clock_timestamp(); end if;
    end if;
  end loop;

  for r in select * from public.import_staging_rows where batch_id=p_batch_id and entity_type='task' and resolution_status in ('ready_create','ready_import_internal') order by row_number for update loop
    v_client_id:=r.target_id;
    if v_client_id is null and nullif(r.normalized_payload->>'clientExternalId','') is not null then select local_entity_id into v_client_id from public.external_source_map where source_system='notion' and source_database_id='mrl_notion_export' and source_page_id=r.normalized_payload->>'clientExternalId' and entity_type='client'; end if;
    if r.resolution_status='ready_create' and v_client_id is null then raise exception 'UNRESOLVED_RELATION' using errcode='23503'; end if;
    insert into public.tasks(client_id,scope,title,description,status,priority,category,assigned_to,starts_at,due_at,completed_at,time_spent_minutes,source,source_external_id,import_batch_id,created_by,updated_by,source_created_at,source_updated_at)
    values(v_client_id,case when v_client_id is null then 'internal' else 'client' end,r.normalized_payload->>'title',nullif(r.normalized_payload->>'description',''),(r.normalized_payload->>'status')::public.task_status,coalesce((r.normalized_payload->>'priority')::integer,2),coalesce(r.normalized_payload->>'category','other'),nullif(r.normalized_payload->>'assignedStaffId','')::uuid,nullif(r.normalized_payload->>'startsAt','')::timestamptz,nullif(r.normalized_payload->>'dueAt','')::timestamptz,nullif(r.normalized_payload->>'completedAt','')::timestamptz,nullif(r.normalized_payload->>'timeSpentMinutes','')::integer,'notion_import',r.source_external_id,p_batch_id,actor,actor,nullif(r.normalized_payload->>'sourceCreatedAt','')::timestamptz,nullif(r.normalized_payload->>'sourceUpdatedAt','')::timestamptz) returning id into v_tx_id;
    update public.import_staging_rows set target_id=v_tx_id,resolution_status='committed',committed_at=clock_timestamp() where id=r.id;
    if r.source_external_id is not null then insert into public.external_source_map(source_system,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id) values('notion',r.source_external_id,'task',v_tx_id,p_batch_id,p_batch_id) on conflict(source_system,source_database_id,source_page_id,entity_type) do update set local_entity_id=excluded.local_entity_id,last_import_batch_id=excluded.last_import_batch_id,updated_at=clock_timestamp(); end if;
    insert into public.task_activity(task_id,actor_user_id,action,after_data,import_batch_id) values(v_tx_id,actor,'imported',jsonb_build_object('source','notion_import'),p_batch_id); created_tasks:=created_tasks+1;
  end loop;

  for br in select x.*,sr.source_external_id,sr.row_number from public.import_balance_reconciliations x join public.import_staging_rows sr on sr.id=x.staging_row_id where x.batch_id=p_batch_id and x.status in ('ready','review') and coalesce(x.chosen_action,x.suggested_action)<>'ignore' order by sr.row_number for update of x loop
    v_client_id:=br.client_id;
    if v_client_id is null and br.client_source_page_id is not null then select local_entity_id into v_client_id from public.external_source_map where source_system='notion' and source_database_id='mrl_notion_export' and source_page_id=br.client_source_page_id and entity_type='client'; end if;
    if v_client_id is null or br.program_id is null then raise exception 'UNRESOLVED_RELATION' using errcode='23503'; end if;
    v_program_id:=br.program_id;
    insert into public.program_accounts(client_id,program_id,active,created_by) values(v_client_id,v_program_id,true,actor) on conflict(client_id,program_id) do update set active=true,updated_at=clock_timestamp() returning id into v_account_id; wallets:=wallets+1;
    perform 1 from public.program_accounts pa where pa.id=v_account_id for update;
    select coalesce(bs.balance,0),coalesce(bs.average_cost_per_thousand,0) into v_current_balance,v_current_average from public.balance_snapshots bs where bs.account_id=v_account_id order by bs.captured_at desc,bs.id desc limit 1; if not found then v_current_balance:=0; v_current_average:=0; end if;
    select lp.default_value_per_thousand into v_program_value from public.loyalty_programs lp where lp.id=v_program_id;
    v_delta:=case coalesce(br.chosen_action,br.suggested_action) when 'create_imported_initial_balance' then br.imported_points when 'adjust_to_imported_snapshot' then br.imported_points-v_current_balance when 'treat_imported_as_additional_entry' then br.imported_points else 0 end;
    if coalesce(br.chosen_action,br.suggested_action)='create_imported_initial_balance' and v_current_balance<>0 then raise exception 'BALANCE_CHANGED_SINCE_REVIEW' using errcode='40001'; end if;
    v_tx_id:=null; v_exp_id:=null;
    if v_delta<>0 then
      v_new_balance:=v_current_balance+v_delta; if v_new_balance<0 then raise exception 'NEGATIVE_BALANCE' using errcode='22003'; end if;
      v_new_average:=case when v_new_balance=0 then 0 when v_delta<0 then v_current_average else round((((v_current_balance::numeric/1000)*v_current_average)+((v_delta::numeric/1000)*br.cost_per_thousand))/(v_new_balance::numeric/1000),4) end;
      insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,expires_on,source,metadata,created_by,entry_category,entry_date,valuation_mode,cash_total,cost_per_thousand,operation_id)
      values(v_account_id,coalesce(br.reference_date,current_date)::timestamp at time zone 'America/Sao_Paulo',case when v_delta>0 then 'credit' else 'adjustment' end,v_delta,'Saldo inicial importado do Notion — lote '||left(p_batch_id::text,8),br.expires_on,'notion_import',jsonb_build_object('batchId',p_batch_id,'stagingRowId',br.staging_row_id,'action',coalesce(br.chosen_action,br.suggested_action)),actor,'initial_balance_import',coalesce(br.reference_date,current_date),'per_thousand',round((abs(v_delta)::numeric/1000)*br.cost_per_thousand,2),br.cost_per_thousand,public.import_idempotency_uuid(br.source_external_id,coalesce(br.client_source_page_id,br.client_id::text)||':'||br.program_id::text||':'||br.imported_points::text,'initial_balance:'||coalesce(br.reference_date::text,'undated')||':'||br.imported_points::text)) on conflict(operation_id) where operation_id is not null do nothing returning id into v_tx_id;
      if v_tx_id is null then raise exception 'DUPLICATE_IMPORTED_BALANCE' using errcode='23505'; end if;
      insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,notes,created_by) values(v_account_id,clock_timestamp()+br.row_number*interval '1 microsecond',v_new_balance,v_new_average,coalesce(nullif(br.cost_per_thousand,0),v_program_value),'notion_import','Reconciliação confirmada do lote '||p_batch_id::text,actor);
      if v_delta>0 and br.expiring_points>0 and br.expires_on is not null then insert into public.expiration_lots(account_id,expires_on,points_amount,status,notes,created_by,source_transaction_id) values(v_account_id,br.expires_on,least(br.expiring_points,v_delta),case when br.expires_on<current_date then 'expired' else 'active' end,'Validade importada do Notion.',actor,v_tx_id) on conflict(source_transaction_id) where source_transaction_id is not null do update set expires_on=excluded.expires_on,status=excluded.status returning id into v_exp_id; end if;
      ledger_entries:=ledger_entries+1; imported_points:=imported_points+v_delta; imported_value:=imported_value+round((v_delta::numeric/1000)*br.cost_per_thousand,2);
    end if;
    update public.import_balance_reconciliations set client_id=v_client_id,account_id=v_account_id,current_points=v_current_balance,difference_points=br.imported_points-v_current_balance,operation_id=case when v_tx_id is null then null else public.import_idempotency_uuid(br.source_external_id,coalesce(br.client_source_page_id,br.client_id::text)||':'||br.program_id::text||':'||br.imported_points::text,'initial_balance:'||coalesce(br.reference_date::text,'undated')||':'||br.imported_points::text) end,transaction_id=v_tx_id,expiration_lot_id=v_exp_id,status='committed',committed_at=clock_timestamp(),updated_at=clock_timestamp() where id=br.id;
    update public.import_staging_rows set target_id=v_account_id,resolution_status='committed',committed_at=clock_timestamp() where id=br.staging_row_id;
    if br.source_external_id is not null then insert into public.external_source_map(source_system,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id) values('notion',br.source_external_id,'program',v_account_id,p_batch_id,p_batch_id) on conflict(source_system,source_database_id,source_page_id,entity_type) do update set local_entity_id=excluded.local_entity_id,last_import_batch_id=excluded.last_import_batch_id,updated_at=clock_timestamp(); end if;
  end loop;
  for r in select * from public.import_staging_rows where batch_id=p_batch_id and entity_type='passage' and resolution_status='ready_create' order by row_number for update loop
    v_client_id:=nullif(r.normalized_payload->>'clientId','')::uuid;
    if v_client_id is null and nullif(r.normalized_payload->>'clientSourcePageId','') is not null then select local_entity_id into v_client_id from public.external_source_map where source_system='notion' and source_database_id='mrl_notion_export' and source_page_id=r.normalized_payload->>'clientSourcePageId' and entity_type='client'; end if;
    v_account_id:=nullif(r.normalized_payload->>'accountId','')::uuid;
    if v_account_id is null and nullif(r.normalized_payload->>'programSourcePageId','') is not null then select local_entity_id into v_account_id from public.external_source_map where source_system='notion' and source_database_id='mrl_notion_export' and source_page_id=r.normalized_payload->>'programSourcePageId' and entity_type='program'; end if;
    if v_client_id is null or v_account_id is null then raise exception 'UNRESOLVED_RELATION' using errcode='23503'; end if;
    insert into public.redemptions(client_id,redemption_type,description,issued_at,cash_reference_total,taxes_paid,additional_cash_paid,attributed_points_cost,formula_version,reference_captured_at,status,notes,created_by,payment_mode,launched_on,operation_id,travel_account_id,travel_points_used)
    values(v_client_id,'flight',r.normalized_payload->>'title',coalesce(nullif(r.normalized_payload->>'issuedAt','')::timestamptz,clock_timestamp()),coalesce((r.normalized_payload->>'cashReferenceTotal')::numeric,0),coalesce((r.normalized_payload->>'taxesPaid')::numeric,0),coalesce((r.normalized_payload->>'additionalCashPaid')::numeric,0),round((coalesce((r.normalized_payload->>'pointsUsed')::numeric,0)/1000)*coalesce((r.normalized_payload->>'costPerThousand')::numeric,0),2),'notion-import-v1',clock_timestamp(),'confirmed','Passagem histórica importada do Notion.',actor,'miles',coalesce(nullif(r.normalized_payload->>'issuedAt','')::timestamptz::date,current_date),public.import_idempotency_uuid(r.source_external_id,r.row_hash,'passage'),v_account_id,(r.normalized_payload->>'pointsUsed')::bigint)
    on conflict(operation_id) where operation_id is not null do update set operation_id=excluded.operation_id returning id into v_tx_id;
    update public.import_staging_rows set target_id=v_tx_id,resolution_status='committed',committed_at=clock_timestamp() where id=r.id;
    if r.source_external_id is not null then insert into public.external_source_map(source_system,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id) values('notion',r.source_external_id,'passage',v_tx_id,p_batch_id,p_batch_id) on conflict(source_system,source_database_id,source_page_id,entity_type) do update set local_entity_id=excluded.local_entity_id,last_import_batch_id=excluded.last_import_batch_id,updated_at=clock_timestamp(); end if;
    created_passages:=created_passages+1;
  end loop;
  update public.import_staging_rows set resolution_status='committed',committed_at=clock_timestamp() where batch_id=p_batch_id and resolution_status in ('ready_unchanged','ready_update','ready_link_existing');
  update public.import_batches set status='committed',finished_at=clock_timestamp(),dry_run_summary=dry_run_summary||jsonb_build_object('committed',jsonb_build_object('createdClients',created_clients,'createdTasks',created_tasks,'createdPassages',created_passages,'walletsReconciled',wallets,'ledgerEntries',ledger_entries,'importedPoints',imported_points,'importedPatrimony',round(imported_value,2))) where id=p_batch_id;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data) values(actor,'commit_import_batch','import_batches',p_batch_id::text,jsonb_build_object('createdClients',created_clients,'createdTasks',created_tasks,'ledgerEntries',ledger_entries,'importedPoints',imported_points));
  return jsonb_build_object('batchId',p_batch_id,'createdClients',created_clients,'createdTasks',created_tasks,'createdPassages',created_passages,'walletsReconciled',wallets,'ledgerEntries',ledger_entries,'importedPoints',imported_points,'importedPatrimony',round(imported_value,2));
exception when others then
  update public.import_batches set status='review',error_code=sqlstate where id=p_batch_id and status='committing';
  raise;
end; $$;

create or replace function public.admin_resume_import_batch(p_batch_id uuid)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$ select public.admin_commit_import_batch(p_batch_id); $$;

create or replace function public.admin_rollback_import_batch(p_batch_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare actor uuid:=auth.uid(); b public.import_batches%rowtype; br record; current_balance bigint; reversed integer:=0; conflicts integer:=0; operation uuid;
begin
  if actor is null or not public.can_manage_imports() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'ROLLBACK_REASON_REQUIRED' using errcode='22023'; end if;
  select * into b from public.import_batches where id=p_batch_id for update;
  if not found or b.status<>'committed' then raise exception 'ROLLBACK_CONFLICT' using errcode='55000'; end if;
  update public.import_batches set rollback_status='processing',rolled_back_by=actor where id=p_batch_id;
  for br in select * from public.import_balance_reconciliations where batch_id=p_batch_id and transaction_id is not null and status='committed' for update loop
    select balance into current_balance from public.balance_snapshots where account_id=br.account_id order by captured_at desc,id desc limit 1;
    if current_balance + (select -points_delta from public.point_transactions where id=br.transaction_id) < 0 then conflicts:=conflicts+1; continue; end if;
    operation:=public.import_operation_uuid(p_batch_id,br.staging_row_id,'rollback');
    insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,source,metadata,created_by,entry_category,entry_date,operation_id)
    select account_id,clock_timestamp(),case when points_delta>0 then 'adjustment' else 'credit' end,-points_delta,'Reversão lógica de importação: '||left(trim(p_reason),300),'notion_import_rollback',jsonb_build_object('batchId',p_batch_id,'originalTransactionId',id),actor,'initial_balance_import',current_date,operation from public.point_transactions where id=br.transaction_id on conflict(operation_id) where operation_id is not null do nothing;
    insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,notes,created_by) select br.account_id,clock_timestamp(),current_balance-pt.points_delta,0,lp.default_value_per_thousand,'notion_import_rollback','Reversão lógica do lote '||p_batch_id::text,actor from public.point_transactions pt join public.program_accounts pa on pa.id=pt.account_id join public.loyalty_programs lp on lp.id=pa.program_id where pt.id=br.transaction_id;
    update public.expiration_lots set status='cancelled',updated_at=clock_timestamp() where source_transaction_id=br.transaction_id and status='active';
    update public.import_balance_reconciliations set status='reversed',updated_at=clock_timestamp() where id=br.id; reversed:=reversed+1;
  end loop;
  update public.tasks set archived_at=clock_timestamp(),updated_by=actor where import_batch_id=p_batch_id and archived_at is null and updated_at<=coalesce(b.finished_at,b.confirmed_at);
  update public.import_batches set status=case when conflicts=0 then 'rolled_back' else 'rollback_conflict' end,rollback_status=case when conflicts=0 then 'completed' else 'conflict' end,rolled_back_at=clock_timestamp() where id=p_batch_id;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data) values(actor,'rollback_import_batch','import_batches',p_batch_id::text,jsonb_build_object('reversedLedgerEntries',reversed,'conflicts',conflicts,'reason',left(trim(p_reason),500)));
  return jsonb_build_object('batchId',p_batch_id,'reversedLedgerEntries',reversed,'conflicts',conflicts,'status',case when conflicts=0 then 'rolled_back' else 'rollback_conflict' end);
end; $$;

revoke all on function public.import_operation_uuid(uuid,uuid,text), public.import_idempotency_uuid(text,text,text), public.refresh_import_batch_summary(uuid), public.get_admin_import_batch(uuid), public.admin_resolve_import_row(uuid,text,uuid,jsonb,text), public.admin_bulk_resolve_import_rows(uuid,text,text), public.admin_commit_import_batch(uuid), public.admin_resume_import_batch(uuid), public.admin_rollback_import_batch(uuid,text) from public, anon;
grant execute on function public.get_admin_import_batch(uuid), public.admin_resolve_import_row(uuid,text,uuid,jsonb,text), public.admin_bulk_resolve_import_rows(uuid,text,text), public.admin_commit_import_batch(uuid), public.admin_resume_import_batch(uuid), public.admin_rollback_import_batch(uuid,text) to authenticated;
grant execute on function public.refresh_import_batch_summary(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
