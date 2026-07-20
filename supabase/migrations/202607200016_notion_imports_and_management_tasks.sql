begin;

-- PATCH MRL 20260720-016
-- Reutiliza public.tasks como fonte oficial de demandas e cria staging auditável
-- para importações. Nenhuma tabela deste patch é acessível ao papel anon.

alter type public.task_status add value if not exists 'waiting_client';
alter type public.task_status add value if not exists 'waiting_third_party';
alter type public.task_status add value if not exists 'on_hold';

-- PostgreSQL só permite usar novos valores de enum depois do commit que os criou.
commit;
begin;

create or replace function public.can_manage_tasks()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.has_staff_role(array[
    'super_admin'::public.app_role,
    'manager'::public.app_role,
    'operator'::public.app_role
  ]);
$$;

create or replace function public.can_manage_imports()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.has_staff_role(array[
    'super_admin'::public.app_role,
    'manager'::public.app_role
  ]);
$$;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'uploaded',
  source_system text not null default 'notion',
  adapter_version text not null default 'notion_mrl_v1',
  original_filename text not null,
  upload_size_bytes bigint not null check (upload_size_bytes > 0 and upload_size_bytes <= 15728640),
  mime_type text not null,
  storage_path text not null unique,
  checksum_sha256 text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  uploaded_at timestamptz,
  finished_at timestamptz,
  dry_run_summary jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  rollback_status text not null default 'not_requested',
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users(id) on delete set null,
  error_code text,
  request_id uuid not null default gen_random_uuid(),
  constraint import_batch_status_valid check (status in ('uploaded','parsing','review','committing','committed','failed','rolled_back','rollback_conflict')),
  constraint import_batch_rollback_status_valid check (rollback_status in ('not_requested','processing','completed','conflict')),
  constraint import_batch_checksum_valid check (checksum_sha256 ~ '^[a-f0-9]{64}$')
);

create index import_batches_created_idx on public.import_batches(created_at desc);
create index import_batches_checksum_idx on public.import_batches(checksum_sha256, adapter_version);

create table public.import_files (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  logical_type text not null,
  path text not null,
  checksum_sha256 text not null,
  row_count integer not null default 0 check (row_count >= 0),
  detected_encoding text not null default 'utf-8',
  delimiter text,
  is_canonical boolean not null default false,
  ignored_reason text,
  created_at timestamptz not null default now(),
  unique(batch_id, path)
);

create table public.import_staging_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  file_id uuid not null references public.import_files(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  entity_type text not null,
  source_external_id text,
  raw_payload jsonb not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  validation_status text not null default 'valid',
  resolution_status text not null default 'pending',
  target_id uuid,
  row_hash text not null,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staging_entity_valid check (entity_type in ('client','task','onboarding','program','passage')),
  constraint staging_validation_valid check (validation_status in ('valid','warning','invalid')),
  constraint staging_resolution_valid check (resolution_status in ('pending','create_new_lead','create_new','link_existing','propose_update','import_internal','declared_pending','skip','unchanged','committed','rolled_back')),
  unique(batch_id, file_id, row_number)
);

create index import_staging_batch_idx on public.import_staging_rows(batch_id, entity_type, validation_status, resolution_status);
create index import_staging_source_idx on public.import_staging_rows(entity_type, source_external_id) where source_external_id is not null;

create table public.import_row_issues (
  id bigint generated always as identity primary key,
  staging_row_id uuid not null references public.import_staging_rows(id) on delete cascade,
  severity text not null,
  stable_code text not null,
  field_name text,
  safe_message text not null,
  resolution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint import_issue_severity_valid check (severity in ('info','warning','error'))
);

create index import_row_issues_row_idx on public.import_row_issues(staging_row_id, severity);

create table public.external_source_map (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_database_id text not null default 'mrl_notion_export',
  source_page_id text not null,
  entity_type text not null,
  local_entity_id uuid not null,
  first_import_batch_id uuid not null references public.import_batches(id) on delete restrict,
  last_import_batch_id uuid not null references public.import_batches(id) on delete restrict,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_page_id_valid check (source_page_id ~ '^[a-f0-9]{32}$'),
  unique(source_system, source_database_id, source_page_id, entity_type)
);

create index external_source_local_idx on public.external_source_map(entity_type, local_entity_id);

alter table public.tasks
  add column if not exists scope text not null default 'internal',
  add column if not exists category text not null default 'other',
  add column if not exists starts_at timestamptz,
  add column if not exists time_spent_minutes integer,
  add column if not exists source text not null default 'manual',
  add column if not exists source_external_id text,
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_at timestamptz,
  add column if not exists source_created_at timestamptz,
  add column if not exists source_updated_at timestamptz;

update public.tasks set scope = case when client_id is null then 'internal' else 'client' end where scope is distinct from case when client_id is null then 'internal' else 'client' end;

alter table public.tasks drop constraint if exists tasks_scope_client_valid;
alter table public.tasks add constraint tasks_scope_client_valid check (scope in ('client','internal') and (scope <> 'client' or client_id is not null));
alter table public.tasks drop constraint if exists tasks_title_not_blank;
alter table public.tasks add constraint tasks_title_not_blank check (length(trim(title)) between 1 and 240);
alter table public.tasks drop constraint if exists tasks_category_valid;
alter table public.tasks add constraint tasks_category_valid check (category in ('onboarding','flight_quote','hotel_quote','reschedule_or_cancel','check_in','points_expiration','transfer','complaint','client_registration','other'));
alter table public.tasks drop constraint if exists tasks_time_spent_valid;
alter table public.tasks add constraint tasks_time_spent_valid check (time_spent_minutes is null or time_spent_minutes >= 0);

create unique index if not exists tasks_external_source_unique on public.tasks(source, source_external_id) where source_external_id is not null;
create index if not exists tasks_open_client_due_idx on public.tasks(client_id, due_at) where archived_at is null and status not in ('completed','cancelled');
create index if not exists tasks_assignee_status_due_idx on public.tasks(assigned_to, status, due_at) where archived_at is null;
create index if not exists tasks_source_batch_idx on public.tasks(source, import_batch_id) where import_batch_id is not null;
create index if not exists tasks_search_idx on public.tasks using gin(to_tsvector('portuguese', coalesce(title,'') || ' ' || coalesce(description,'')));

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  content text not null,
  position integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_checklist_content_valid check (length(trim(content)) between 1 and 500)
);

create table public.task_activity (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);

create index task_activity_task_idx on public.task_activity(task_id, created_at desc);

create or replace function public.enforce_task_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.title := trim(new.title);
  if new.scope = 'internal' then new.client_id := null; end if;
  if new.status = 'completed' and new.completed_at is null then new.completed_at := clock_timestamp(); end if;
  if new.status <> 'completed' and old.status = 'completed' then new.completed_at := null; end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists tasks_enforce_state on public.tasks;
create trigger tasks_enforce_state before insert or update on public.tasks for each row execute function public.enforce_task_state();

alter table public.import_batches enable row level security;
alter table public.import_files enable row level security;
alter table public.import_staging_rows enable row level security;
alter table public.import_row_issues enable row level security;
alter table public.external_source_map enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_activity enable row level security;

create policy import_batches_staff_read on public.import_batches for select to authenticated using (public.is_staff());
create policy import_files_staff_read on public.import_files for select to authenticated using (public.is_staff());
create policy import_staging_staff_read on public.import_staging_rows for select to authenticated using (public.is_staff());
create policy import_issues_staff_read on public.import_row_issues for select to authenticated using (public.is_staff());
create policy external_map_staff_read on public.external_source_map for select to authenticated using (public.is_staff());
create policy task_checklist_staff_read on public.task_checklist_items for select to authenticated using (public.is_staff());
create policy task_activity_staff_read on public.task_activity for select to authenticated using (public.is_staff());

revoke all on public.import_batches, public.import_files, public.import_staging_rows, public.import_row_issues, public.external_source_map, public.task_checklist_items, public.task_activity from public, anon;
grant select on public.import_batches, public.import_files, public.import_staging_rows, public.import_row_issues, public.external_source_map, public.task_checklist_items, public.task_activity to authenticated;
revoke insert, update, delete on public.tasks from authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('admin-imports', 'admin-imports', false, 15728640, array['application/zip','application/x-zip-compressed','text/csv','application/csv','text/plain'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.admin_create_management_task(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  created public.tasks%rowtype;
  status_value text := coalesce(nullif(p_payload->>'status',''),'open');
  priority_value integer := coalesce(nullif(p_payload->>'priority','')::integer,2);
  scope_value text := coalesce(nullif(p_payload->>'scope',''),'internal');
  category_value text := coalesce(nullif(p_payload->>'category',''),'other');
  item jsonb;
begin
  if actor is null or not public.can_manage_tasks() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if status_value not in ('open','in_progress','waiting_client','waiting_third_party','on_hold','completed','cancelled') then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
  if scope_value not in ('client','internal') then raise exception 'INVALID_SCOPE' using errcode='22023'; end if;
  if category_value not in ('onboarding','flight_quote','hotel_quote','reschedule_or_cancel','check_in','points_expiration','transfer','complaint','client_registration','other') then raise exception 'INVALID_CATEGORY' using errcode='22023'; end if;
  if priority_value not between 1 and 4 then raise exception 'INVALID_PRIORITY' using errcode='22023'; end if;

  insert into public.tasks(client_id,scope,title,description,status,priority,category,assigned_to,starts_at,due_at,time_spent_minutes,source,created_by,updated_by)
  values(
    case when scope_value='client' then nullif(p_payload->>'clientId','')::uuid else null end,
    scope_value, p_payload->>'title', nullif(trim(p_payload->>'description'),''), status_value::public.task_status,
    priority_value, category_value, nullif(p_payload->>'assignedStaffId','')::uuid,
    nullif(p_payload->>'startsAt','')::timestamptz, nullif(p_payload->>'dueAt','')::timestamptz,
    nullif(p_payload->>'timeSpentMinutes','')::integer, 'manual', actor, actor
  ) returning * into created;

  for item in select value from jsonb_array_elements(coalesce(p_payload->'checklist','[]'::jsonb)) loop
    if length(trim(item#>>'{}')) > 0 then
      insert into public.task_checklist_items(task_id,content,position,created_by)
      values(created.id,trim(item#>>'{}'),coalesce((select max(position)+1 from public.task_checklist_items where task_id=created.id),0),actor);
    end if;
  end loop;
  insert into public.task_activity(task_id,actor_user_id,action,after_data) values(created.id,actor,'created',jsonb_build_object('status',created.status,'scope',created.scope,'clientId',created.client_id));
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(actor,created.client_id,'create_management_task','tasks',created.id::text,jsonb_build_object('status',created.status,'scope',created.scope,'priority',created.priority,'category',created.category));
  return jsonb_build_object('taskId',created.id,'status',created.status,'completedAt',created.completed_at);
end;
$$;

create or replace function public.admin_update_management_task(p_task_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor uuid:=auth.uid(); previous public.tasks%rowtype; changed public.tasks%rowtype; status_value text;
begin
  if actor is null or not public.can_manage_tasks() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into previous from public.tasks where id=p_task_id and archived_at is null for update;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode='P0002'; end if;
  status_value:=coalesce(nullif(p_payload->>'status',''),previous.status::text);
  if status_value not in ('open','in_progress','waiting_client','waiting_third_party','on_hold','completed','cancelled') then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
  update public.tasks set
    client_id=case when coalesce(p_payload->>'scope',scope)='client' then coalesce(nullif(p_payload->>'clientId','')::uuid,client_id) else null end,
    scope=coalesce(nullif(p_payload->>'scope',''),scope), title=coalesce(nullif(trim(p_payload->>'title'),''),title),
    description=case when p_payload?'description' then nullif(trim(p_payload->>'description'),'') else description end,
    status=status_value::public.task_status, priority=coalesce(nullif(p_payload->>'priority','')::integer,priority),
    category=coalesce(nullif(p_payload->>'category',''),category),
    assigned_to=case when p_payload?'assignedStaffId' then nullif(p_payload->>'assignedStaffId','')::uuid else assigned_to end,
    starts_at=case when p_payload?'startsAt' then nullif(p_payload->>'startsAt','')::timestamptz else starts_at end,
    due_at=case when p_payload?'dueAt' then nullif(p_payload->>'dueAt','')::timestamptz else due_at end,
    time_spent_minutes=case when p_payload?'timeSpentMinutes' then nullif(p_payload->>'timeSpentMinutes','')::integer else time_spent_minutes end,
    updated_by=actor
  where id=p_task_id returning * into changed;
  insert into public.task_activity(task_id,actor_user_id,action,before_data,after_data)
  values(changed.id,actor,case when previous.status='completed' and changed.status<>'completed' then 'reopened' when previous.status<>'completed' and changed.status='completed' then 'completed' else 'updated' end,
    jsonb_build_object('status',previous.status,'priority',previous.priority,'dueAt',previous.due_at),jsonb_build_object('status',changed.status,'priority',changed.priority,'dueAt',changed.due_at));
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,changed.client_id,'update_management_task','tasks',changed.id::text,jsonb_build_object('status',previous.status),jsonb_build_object('status',changed.status));
  return jsonb_build_object('taskId',changed.id,'status',changed.status,'completedAt',changed.completed_at);
end;
$$;

create or replace function public.admin_archive_management_task(p_task_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor uuid:=auth.uid(); archived public.tasks%rowtype;
begin
  if actor is null or not public.can_manage_tasks() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'ARCHIVE_REASON_REQUIRED' using errcode='22023'; end if;
  update public.tasks set archived_at=clock_timestamp(),updated_by=actor where id=p_task_id and archived_at is null returning * into archived;
  if not found then raise exception 'TASK_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.task_activity(task_id,actor_user_id,action,after_data) values(archived.id,actor,'archived',jsonb_build_object('reason',left(trim(p_reason),500)));
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(actor,archived.client_id,'archive_management_task','tasks',archived.id::text,jsonb_build_object('reason',left(trim(p_reason),500)));
  return jsonb_build_object('taskId',archived.id,'archived',true);
end;
$$;

create or replace function public.get_admin_management_tasks(
  p_client_id uuid default null, p_search text default null, p_status text default null,
  p_priority integer default null, p_category text default null, p_assigned_staff_id uuid default null,
  p_source text default null, p_due_from date default null, p_due_to date default null,
  p_sort text default 'due_at', p_direction text default 'asc', p_limit integer default 20, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0); actor uuid:=auth.uid();
begin
  if actor is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if coalesce(p_sort,'') not in ('priority','due_at','updated_at','created_at') then raise exception 'INVALID_SORT' using errcode='22023'; end if;
  if coalesce(p_direction,'') not in ('asc','desc') then raise exception 'INVALID_DIRECTION' using errcode='22023'; end if;
  return (with filtered as materialized (
    select t.*,c.full_name client_name,p.full_name assigned_name,
      (t.due_at<clock_timestamp() and t.status not in ('completed','cancelled')) overdue,
      coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'content',i.content,'completedAt',i.completed_at,'position',i.position) order by i.position,i.created_at) from public.task_checklist_items i where i.task_id=t.id and i.archived_at is null),'[]'::jsonb) checklist
    from public.tasks t left join public.clients c on c.id=t.client_id left join public.profiles p on p.id=t.assigned_to
    where t.archived_at is null and (p_client_id is null or t.client_id=p_client_id)
      and (nullif(trim(coalesce(p_search,'')),'') is null or t.title ilike '%'||trim(p_search)||'%' or t.description ilike '%'||trim(p_search)||'%' or c.full_name ilike '%'||trim(p_search)||'%')
      and (nullif(p_status,'') is null or t.status::text=p_status) and (p_priority is null or t.priority=p_priority)
      and (nullif(p_category,'') is null or t.category=p_category) and (p_assigned_staff_id is null or t.assigned_to=p_assigned_staff_id)
      and (nullif(p_source,'') is null or t.source=p_source) and (p_due_from is null or t.due_at>=p_due_from::timestamptz)
      and (p_due_to is null or t.due_at<(p_due_to+1)::timestamptz)
  ), paged as (
    select * from filtered order by
      case when p_sort='priority' and p_direction='asc' then priority end asc,
      case when p_sort='priority' and p_direction='desc' then priority end desc,
      case when p_sort='due_at' and p_direction='asc' then due_at end asc nulls last,
      case when p_sort='due_at' and p_direction='desc' then due_at end desc nulls last,
      case when p_sort='updated_at' and p_direction='asc' then updated_at end asc,
      case when p_sort='updated_at' and p_direction='desc' then updated_at end desc,
      case when p_sort='created_at' and p_direction='asc' then created_at end asc,
      case when p_sort='created_at' and p_direction='desc' then created_at end desc,
      id limit safe_limit offset safe_offset
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('taskId',id,'clientId',client_id,'clientName',client_name,'scope',scope,'title',title,'description',description,'status',status,'priority',priority,'category',category,'assignedStaffId',assigned_to,'assignedName',assigned_name,'startsAt',starts_at,'dueAt',due_at,'completedAt',completed_at,'timeSpentMinutes',time_spent_minutes,'source',source,'overdue',overdue,'checklist',checklist,'createdAt',created_at,'updatedAt',updated_at)) from paged),'[]'::jsonb),
    'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset,'canWrite',public.can_manage_tasks(),
    'indicators',jsonb_build_object(
      'open',(select count(*) from filtered where status not in ('completed','cancelled')),
      'overdue',(select count(*) from filtered where due_at<clock_timestamp() and status not in ('completed','cancelled')),
      'dueToday',(select count(*) from filtered where due_at>=current_date and due_at<current_date+1 and status not in ('completed','cancelled')),
      'next7Days',(select count(*) from filtered where due_at>=clock_timestamp() and due_at<current_date+8 and status not in ('completed','cancelled')),
      'waitingClient',(select count(*) from filtered where status='waiting_client'),
      'completedPeriod',(select count(*) from filtered where status='completed' and completed_at>=date_trunc('month',clock_timestamp()))
    ),
    'staff',coalesce((select jsonb_agg(jsonb_build_object('userId',sm.user_id,'fullName',pr.full_name) order by pr.full_name) from public.staff_members sm join public.profiles pr on pr.id=sm.user_id where sm.active),'[]'::jsonb)
  ));
end;
$$;

create or replace function public.get_admin_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.import_batches where id=p_batch_id) then raise exception 'BATCH_NOT_FOUND' using errcode='P0002'; end if;
  return (select jsonb_build_object(
    'batch',jsonb_build_object('batchId',b.id,'status',b.status,'sourceSystem',b.source_system,'adapterVersion',b.adapter_version,'originalFilename',b.original_filename,'summary',b.dry_run_summary,'createdAt',b.created_at,'finishedAt',b.finished_at,'rollbackStatus',b.rollback_status,'requestId',b.request_id),
    'files',coalesce((select jsonb_agg(jsonb_build_object('fileId',f.id,'logicalType',f.logical_type,'path',f.path,'rowCount',f.row_count,'encoding',f.detected_encoding,'delimiter',f.delimiter,'isCanonical',f.is_canonical,'ignoredReason',f.ignored_reason) order by f.path) from public.import_files f where f.batch_id=b.id),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('rowId',r.id,'rowNumber',r.row_number,'entityType',r.entity_type,'sourceExternalId',r.source_external_id,'preview',jsonb_strip_nulls(jsonb_build_object('title',r.normalized_payload->>'title','fullName',r.normalized_payload->>'fullName','clientLabel',r.normalized_payload->>'clientLabel','status',r.normalized_payload->>'status','priority',r.normalized_payload->>'priority','category',r.normalized_payload->>'category','programName',r.normalized_payload->>'programName')),'validationStatus',r.validation_status,'resolutionStatus',r.resolution_status,'targetId',r.target_id,'issues',coalesce((select jsonb_agg(jsonb_build_object('severity',i.severity,'code',i.stable_code,'fieldName',i.field_name,'message',i.safe_message,'resolution',i.resolution) order by i.id) from public.import_row_issues i where i.staging_row_id=r.id),'[]'::jsonb)) order by r.entity_type,r.row_number) from public.import_staging_rows r where r.batch_id=b.id),'[]'::jsonb),
    'canManage',public.can_manage_imports()
  ) from public.import_batches b where b.id=p_batch_id);
end;
$$;

create or replace function public.admin_resolve_import_row(p_row_id uuid, p_resolution text, p_target_id uuid default null, p_normalized_patch jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor uuid:=auth.uid(); row_record public.import_staging_rows%rowtype;
begin
  if actor is null or not public.can_manage_imports() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_resolution not in ('create_new_lead','create_new','link_existing','import_internal','declared_pending','skip') then raise exception 'INVALID_RESOLUTION' using errcode='22023'; end if;
  select * into row_record from public.import_staging_rows where id=p_row_id for update;
  if not found then raise exception 'INVALID_ROW' using errcode='P0002'; end if;
  if exists(select 1 from public.import_batches where id=row_record.batch_id and status<>'review') then raise exception 'BATCH_NOT_REVIEWABLE' using errcode='55000'; end if;
  if p_resolution='link_existing' and p_target_id is null then raise exception 'TARGET_REQUIRED' using errcode='22023'; end if;
  update public.import_staging_rows set resolution_status=p_resolution,target_id=p_target_id,normalized_payload=normalized_payload||coalesce(p_normalized_patch,'{}'::jsonb) where id=p_row_id;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data) values(actor,'resolve_import_row','import_staging_rows',p_row_id::text,jsonb_build_object('batchId',row_record.batch_id,'entityType',row_record.entity_type,'resolution',p_resolution));
  return jsonb_build_object('rowId',p_row_id,'resolutionStatus',p_resolution);
end;
$$;

create or replace function public.admin_commit_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor uuid:=auth.uid(); batch_record public.import_batches%rowtype; row_record record; new_client public.clients%rowtype; new_task public.tasks%rowtype; resolved_client uuid; created_clients integer:=0; created_tasks integer:=0; linked integer:=0; skipped integer:=0;
begin
  if actor is null or not public.can_manage_imports() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into batch_record from public.import_batches where id=p_batch_id for update;
  if not found then raise exception 'BATCH_NOT_FOUND' using errcode='P0002'; end if;
  if batch_record.status='committed' then raise exception 'BATCH_ALREADY_COMMITTED' using errcode='55000'; end if;
  if batch_record.status<>'review' then raise exception 'BATCH_NOT_REVIEWED' using errcode='55000'; end if;
  if exists(select 1 from public.import_staging_rows where batch_id=p_batch_id and (resolution_status='pending' or (entity_type in ('client','task') and validation_status='invalid' and resolution_status<>'skip'))) then raise exception 'BATCH_NOT_REVIEWED' using errcode='55000'; end if;
  update public.import_batches set status='committing',confirmed_at=clock_timestamp(),confirmed_by=actor where id=p_batch_id;

  for row_record in select * from public.import_staging_rows where batch_id=p_batch_id and entity_type='client' order by row_number for update loop
    if row_record.resolution_status='create_new_lead' then
      insert into public.clients(full_name,first_name_normalized,email,phone_e164,status,notes,created_by)
      values(row_record.normalized_payload->>'fullName',public.normalize_first_name(row_record.normalized_payload->>'fullName'),nullif(row_record.normalized_payload->>'email','')::extensions.citext,nullif(row_record.normalized_payload->>'phoneE164',''),'lead','Cadastro legado importado; revisão e ativação obrigatórias.',actor)
      returning * into new_client;
      update public.import_staging_rows set target_id=new_client.id,resolution_status='committed',committed_at=clock_timestamp() where id=row_record.id;
      if row_record.source_external_id is not null then insert into public.external_source_map(source_system,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id,source_updated_at) values('notion',row_record.source_external_id,'client',new_client.id,p_batch_id,p_batch_id,nullif(row_record.normalized_payload->>'sourceUpdatedAt','')::timestamptz); end if;
      created_clients:=created_clients+1;
    elsif row_record.resolution_status='link_existing' then
      update public.import_staging_rows set resolution_status='committed',committed_at=clock_timestamp() where id=row_record.id;
      if row_record.source_external_id is not null then insert into public.external_source_map(source_system,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id,source_updated_at) values('notion',row_record.source_external_id,'client',row_record.target_id,p_batch_id,p_batch_id,nullif(row_record.normalized_payload->>'sourceUpdatedAt','')::timestamptz) on conflict(source_system,source_database_id,source_page_id,entity_type) do update set local_entity_id=excluded.local_entity_id,last_import_batch_id=excluded.last_import_batch_id,source_updated_at=excluded.source_updated_at,updated_at=clock_timestamp(); end if;
      linked:=linked+1;
    else skipped:=skipped+1; end if;
  end loop;

  for row_record in select * from public.import_staging_rows where batch_id=p_batch_id and entity_type='task' order by row_number for update loop
    if row_record.resolution_status in ('create_new','import_internal') then
      resolved_client:=row_record.target_id;
      if resolved_client is null and row_record.normalized_payload->>'clientExternalId' is not null then select local_entity_id into resolved_client from public.external_source_map where source_system='notion' and source_database_id='mrl_notion_export' and source_page_id=row_record.normalized_payload->>'clientExternalId' and entity_type='client'; end if;
      if row_record.resolution_status='create_new' and resolved_client is null then raise exception 'UNRESOLVED_RELATION' using errcode='23503'; end if;
      insert into public.tasks(client_id,scope,title,description,status,priority,category,assigned_to,starts_at,due_at,completed_at,time_spent_minutes,source,source_external_id,import_batch_id,created_by,updated_by,source_created_at,source_updated_at)
      values(resolved_client,case when resolved_client is null then 'internal' else 'client' end,row_record.normalized_payload->>'title',nullif(row_record.normalized_payload->>'description',''),(row_record.normalized_payload->>'status')::public.task_status,coalesce((row_record.normalized_payload->>'priority')::integer,2),coalesce(row_record.normalized_payload->>'category','other'),nullif(row_record.normalized_payload->>'assignedStaffId','')::uuid,nullif(row_record.normalized_payload->>'startsAt','')::timestamptz,nullif(row_record.normalized_payload->>'dueAt','')::timestamptz,nullif(row_record.normalized_payload->>'completedAt','')::timestamptz,nullif(row_record.normalized_payload->>'timeSpentMinutes','')::integer,'notion_import',row_record.source_external_id,p_batch_id,actor,actor,nullif(row_record.normalized_payload->>'sourceCreatedAt','')::timestamptz,nullif(row_record.normalized_payload->>'sourceUpdatedAt','')::timestamptz)
      returning * into new_task;
      update public.import_staging_rows set target_id=new_task.id,resolution_status='committed',committed_at=clock_timestamp() where id=row_record.id;
      if row_record.source_external_id is not null then insert into public.external_source_map(source_system,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id,source_updated_at) values('notion',row_record.source_external_id,'task',new_task.id,p_batch_id,p_batch_id,new_task.source_updated_at); end if;
      insert into public.task_activity(task_id,actor_user_id,action,after_data,import_batch_id) values(new_task.id,actor,'imported',jsonb_build_object('source','notion_import'),p_batch_id);
      created_tasks:=created_tasks+1;
    else skipped:=skipped+1; end if;
  end loop;

  update public.import_staging_rows set resolution_status=case when resolution_status='skip' then 'committed' else resolution_status end,committed_at=case when resolution_status='skip' then clock_timestamp() else committed_at end where batch_id=p_batch_id and resolution_status='skip';
  update public.import_batches set status='committed',finished_at=clock_timestamp(),dry_run_summary=dry_run_summary||jsonb_build_object('committed',jsonb_build_object('createdClients',created_clients,'createdTasks',created_tasks,'linkedExisting',linked,'skipped',skipped)) where id=p_batch_id;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data) values(actor,'commit_import_batch','import_batches',p_batch_id::text,jsonb_build_object('createdClients',created_clients,'createdTasks',created_tasks,'linkedExisting',linked,'skipped',skipped));
  return jsonb_build_object('batchId',p_batch_id,'createdClients',created_clients,'createdTasks',created_tasks,'linkedExisting',linked,'skipped',skipped);
end;
$$;

create or replace function public.admin_rollback_import_batch(p_batch_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare actor uuid:=auth.uid(); batch_record public.import_batches%rowtype; conflicts integer:=0; archived_tasks integer:=0; archived_clients integer:=0;
begin
  if actor is null or not public.can_manage_imports() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'ROLLBACK_REASON_REQUIRED' using errcode='22023'; end if;
  select * into batch_record from public.import_batches where id=p_batch_id for update;
  if not found or batch_record.status<>'committed' then raise exception 'ROLLBACK_CONFLICT' using errcode='55000'; end if;
  update public.import_batches set rollback_status='processing',rolled_back_by=actor where id=p_batch_id;
  select count(*) into conflicts from public.tasks where import_batch_id=p_batch_id and updated_at>coalesce(batch_record.finished_at,batch_record.confirmed_at);
  update public.tasks set archived_at=clock_timestamp(),updated_by=actor where import_batch_id=p_batch_id and archived_at is null and updated_at<=coalesce(batch_record.finished_at,batch_record.confirmed_at); get diagnostics archived_tasks=row_count;
  update public.clients c set status='ended',notes=concat_ws(E'\n',c.notes,'Lead importado arquivado por rollback do lote.'),updated_at=clock_timestamp()
  where c.id in (select r.target_id from public.import_staging_rows r where r.batch_id=p_batch_id and r.entity_type='client' and r.target_id is not null)
    and c.status='lead' and not exists(select 1 from public.management_contracts mc where mc.client_id=c.id) and not exists(select 1 from public.program_accounts pa where pa.client_id=c.id); get diagnostics archived_clients=row_count;
  update public.import_staging_rows set resolution_status='rolled_back' where batch_id=p_batch_id and target_id is not null and (entity_type<>'task' or target_id in(select id from public.tasks where import_batch_id=p_batch_id and archived_at is not null));
  update public.import_batches set status=case when conflicts=0 then 'rolled_back' else 'rollback_conflict' end,rollback_status=case when conflicts=0 then 'completed' else 'conflict' end,rolled_back_at=clock_timestamp() where id=p_batch_id;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data) values(actor,'rollback_import_batch','import_batches',p_batch_id::text,jsonb_build_object('archivedTasks',archived_tasks,'archivedClients',archived_clients,'conflicts',conflicts,'reason',left(trim(p_reason),500)));
  return jsonb_build_object('batchId',p_batch_id,'archivedTasks',archived_tasks,'archivedClients',archived_clients,'conflicts',conflicts,'status',case when conflicts=0 then 'rolled_back' else 'rollback_conflict' end);
end;
$$;

revoke all on function public.can_manage_tasks(), public.can_manage_imports() from public, anon;
revoke all on function public.admin_create_management_task(jsonb), public.admin_update_management_task(uuid,jsonb), public.admin_archive_management_task(uuid,text), public.get_admin_management_tasks(uuid,text,text,integer,text,uuid,text,date,date,text,text,integer,integer), public.get_admin_import_batch(uuid), public.admin_resolve_import_row(uuid,text,uuid,jsonb), public.admin_commit_import_batch(uuid), public.admin_rollback_import_batch(uuid,text) from public, anon;
grant execute on function public.can_manage_tasks(), public.can_manage_imports(), public.admin_create_management_task(jsonb), public.admin_update_management_task(uuid,jsonb), public.admin_archive_management_task(uuid,text), public.get_admin_management_tasks(uuid,text,text,integer,text,uuid,text,date,date,text,text,integer,integer), public.get_admin_import_batch(uuid), public.admin_resolve_import_row(uuid,text,uuid,jsonb), public.admin_commit_import_batch(uuid), public.admin_rollback_import_batch(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
