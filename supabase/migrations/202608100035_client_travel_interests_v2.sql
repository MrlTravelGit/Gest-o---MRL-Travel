-- PATCH MRL 029 (parte 2/2)
begin;

alter table public.travel_interests
  add column if not exists priority text not null default 'normal',
  add column if not exists public_visible boolean not null default false,
  add column if not exists public_note text,
  add column if not exists internal_note text,
  add column if not exists next_action_on date,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- Registros anteriores permanecem privados. Somente novos registros nascem visiveis.
alter table public.travel_interests alter column public_visible set default true;
alter table public.travel_interests alter column status set default 'waiting';

update public.travel_interests
set status = case status::text
  when 'open' then 'waiting'::public.travel_interest_status
  when 'quoting' then 'in_progress'::public.travel_interest_status
  when 'converted' then 'completed'::public.travel_interest_status
  else status
end,
completed_at = case when status::text = 'converted' then coalesce(completed_at, updated_at, created_at) else completed_at end
where status::text in ('open', 'quoting', 'converted');

alter table public.travel_interests
  drop constraint if exists travel_interests_priority_valid,
  add constraint travel_interests_priority_valid check (priority in ('low','normal','high','urgent')),
  drop constraint if exists travel_interests_canonical_status,
  add constraint travel_interests_canonical_status check (status::text in ('waiting','in_progress','completed','cancelled')),
  drop constraint if exists travel_interests_public_note_length,
  add constraint travel_interests_public_note_length check (public_note is null or char_length(public_note) <= 1000),
  drop constraint if exists travel_interests_internal_note_length,
  add constraint travel_interests_internal_note_length check (internal_note is null or char_length(internal_note) <= 3000);

create table if not exists public.travel_interest_status_history (
  id uuid primary key default gen_random_uuid(),
  interest_id uuid not null references public.travel_interests(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  previous_status text,
  new_status text not null,
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  constraint travel_interest_history_previous_status check (previous_status is null or previous_status in ('waiting','in_progress','completed','cancelled')),
  constraint travel_interest_history_new_status check (new_status in ('waiting','in_progress','completed','cancelled')),
  constraint travel_interest_history_note_length check (note is null or char_length(note) <= 1000)
);

create index if not exists travel_interests_client_status_updated_idx on public.travel_interests(client_id,status,updated_at desc);
create index if not exists travel_interests_client_public_updated_idx on public.travel_interests(client_id,public_visible,updated_at desc);
create index if not exists travel_interests_assignee_action_idx on public.travel_interests(assigned_to,status,next_action_on);
create index if not exists travel_interest_status_history_interest_changed_idx on public.travel_interest_status_history(interest_id,changed_at desc);

alter table public.travel_interest_status_history enable row level security;
alter table public.travel_interest_status_history force row level security;
revoke all on public.travel_interest_status_history from public, anon, authenticated;
grant select on public.travel_interest_status_history to authenticated;
grant all on public.travel_interest_status_history to service_role;
drop policy if exists travel_interest_status_history_select_staff on public.travel_interest_status_history;
create policy travel_interest_status_history_select_staff on public.travel_interest_status_history for select to authenticated using (public.is_staff());

create or replace function public.prepare_travel_interest_v2()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  new.status := case new.status::text when 'open' then 'waiting'::public.travel_interest_status when 'quoting' then 'in_progress'::public.travel_interest_status when 'converted' then 'completed'::public.travel_interest_status else new.status end;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.status::text = 'completed' and (tg_op='INSERT' or old.status::text <> 'completed') then new.completed_at := clock_timestamp(); end if;
  if new.status::text in ('waiting','in_progress') then new.completed_at := null; end if;
  return new;
end;
$$;

drop trigger if exists travel_interests_prepare_v2 on public.travel_interests;
create trigger travel_interests_prepare_v2 before insert or update on public.travel_interests for each row execute function public.prepare_travel_interest_v2();

create or replace function public.record_travel_interest_status_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if old.status is distinct from new.status then
    insert into public.travel_interest_status_history(interest_id,client_id,previous_status,new_status,note,changed_by)
    values(new.id,new.client_id,old.status::text,new.status::text,nullif(current_setting('app.travel_interest_status_note',true),''),auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists travel_interests_status_history on public.travel_interests;
create trigger travel_interests_status_history after update of status on public.travel_interests for each row execute function public.record_travel_interest_status_change();

create or replace function public.get_client_travel_interests_admin(p_client_id uuid,p_status text default null,p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0); normalized_status text:=nullif(trim(coalesce(p_status,'')),'');
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  if p_client_id is null or not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Cliente nao encontrado' using errcode='P0002'; end if;
  normalized_status:=case normalized_status when 'open' then 'waiting' when 'quoting' then 'in_progress' when 'converted' then 'completed' else normalized_status end;
  if normalized_status is not null and normalized_status not in ('waiting','in_progress','completed','cancelled') then raise exception 'Status invalido' using errcode='22023'; end if;
  return (with filtered as materialized(select ti.*,p.full_name assigned_to_name from public.travel_interests ti left join public.profiles p on p.id=ti.assigned_to where ti.client_id=p_client_id and (normalized_status is null or ti.status::text=normalized_status)), paged as (select * from filtered order by case priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,next_action_on asc nulls last,updated_at desc,id limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'clientId',i.client_id,'destination',i.destination,'startDate',i.desired_start_date,'endDate',i.desired_end_date,'details',i.details,'status',i.status,'priority',i.priority,'publicVisible',i.public_visible,'publicNote',i.public_note,'internalNote',i.internal_note,'nextActionOn',i.next_action_on,'assignedTo',i.assigned_to,'assignedToName',i.assigned_to_name,'completedAt',i.completed_at,'createdAt',i.created_at,'updatedAt',i.updated_at,'statusHistory',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'previousStatus',h.previous_status,'newStatus',h.new_status,'note',h.note,'changedBy',h.changed_by,'changedAt',h.changed_at) order by h.changed_at desc,h.id) from public.travel_interest_status_history h where h.interest_id=i.id),'[]'::jsonb)) order by case i.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,i.next_action_on asc nulls last,i.updated_at desc) from paged i),'[]'::jsonb),'counts',jsonb_build_object('all',(select count(*) from public.travel_interests where client_id=p_client_id),'waiting',(select count(*) from public.travel_interests where client_id=p_client_id and status::text='waiting'),'inProgress',(select count(*) from public.travel_interests where client_id=p_client_id and status::text='in_progress'),'completed',(select count(*) from public.travel_interests where client_id=p_client_id and status::text='completed'),'cancelled',(select count(*) from public.travel_interests where client_id=p_client_id and status::text='cancelled')),'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset));
end;
$$;

create or replace function public.upsert_travel_interest_v2(p_client_id uuid,p_destination text,p_start_date date,p_end_date date,p_details text,p_status text default 'waiting',p_priority text default 'normal',p_public_visible boolean default true,p_public_note text default null,p_internal_note text default null,p_next_action_on date default null,p_assigned_to uuid default null,p_status_note text default null,p_interest_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid(); normalized_status text; normalized_priority text:=lower(trim(coalesce(p_priority,'normal'))); interest_row public.travel_interests%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Sem permissao para alterar interesses' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Cliente nao encontrado' using errcode='P0002'; end if;
  if char_length(trim(coalesce(p_destination,''))) not between 2 and 160 or char_length(trim(coalesce(p_details,''))) not between 3 and 2000 then raise exception 'Destino ou detalhes invalidos' using errcode='22023'; end if;
  if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'Periodo invalido' using errcode='22007'; end if;
  normalized_status:=case lower(trim(coalesce(p_status,'waiting'))) when 'open' then 'waiting' when 'quoting' then 'in_progress' when 'converted' then 'completed' else lower(trim(coalesce(p_status,'waiting'))) end;
  if normalized_status not in ('waiting','in_progress','completed','cancelled') then raise exception 'Status invalido' using errcode='22023'; end if;
  if normalized_priority not in ('low','normal','high','urgent') then raise exception 'Prioridade invalida' using errcode='22023'; end if;
  perform set_config('app.travel_interest_status_note',left(trim(coalesce(p_status_note,'')),1000),true);
  if p_interest_id is null then
    insert into public.travel_interests(client_id,destination,desired_start_date,desired_end_date,details,status,priority,public_visible,public_note,internal_note,next_action_on,assigned_to,created_by,updated_by)
    values(p_client_id,trim(p_destination),p_start_date,p_end_date,trim(p_details),normalized_status::public.travel_interest_status,normalized_priority,coalesce(p_public_visible,true),nullif(trim(coalesce(p_public_note,'')),''),nullif(trim(coalesce(p_internal_note,'')),''),p_next_action_on,p_assigned_to,actor_id,actor_id) returning * into interest_row;
  else
    if not exists(select 1 from public.travel_interests where id=p_interest_id and client_id=p_client_id) then raise exception 'Interesse nao pertence ao cliente informado' using errcode='P0002'; end if;
    update public.travel_interests set destination=trim(p_destination),desired_start_date=p_start_date,desired_end_date=p_end_date,details=trim(p_details),status=normalized_status::public.travel_interest_status,priority=normalized_priority,public_visible=coalesce(p_public_visible,true),public_note=nullif(trim(coalesce(p_public_note,'')),''),internal_note=nullif(trim(coalesce(p_internal_note,'')),''),next_action_on=p_next_action_on,assigned_to=p_assigned_to,updated_by=actor_id where id=p_interest_id and client_id=p_client_id returning * into interest_row;
  end if;
  return jsonb_build_object('id',interest_row.id,'clientId',interest_row.client_id,'status',interest_row.status,'priority',interest_row.priority,'updatedAt',interest_row.updated_at);
end;
$$;

create or replace function public.get_travel_interest_assignees_admin()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',sm.user_id,'name',coalesce(p.full_name,'Equipe MRL')) order by coalesce(p.full_name,'Equipe MRL')) from public.staff_members sm left join public.profiles p on p.id=sm.user_id where sm.active),'[]'::jsonb);
end;
$$;

-- Compatibilidade temporaria com o frontend anterior.
create or replace function public.upsert_travel_interest(p_client_id uuid,p_destination text,p_start_date date,p_end_date date,p_details text,p_status public.travel_interest_status default 'waiting',p_interest_id uuid default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$ select public.upsert_travel_interest_v2(p_client_id,p_destination,p_start_date,p_end_date,p_details,p_status::text,'normal',true,null,null,null,null,null,p_interest_id); $$;

create or replace function public.build_public_client_travel_interests(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'destination',x.destination,'startDate',x.desired_start_date,'endDate',x.desired_end_date,'status',x.status,'statusLabel',case x.status::text when 'in_progress' then 'Em andamento' when 'waiting' then 'Em espera' when 'completed' then 'Concluido' end,'publicNote',x.public_note,'updatedAt',x.updated_at) order by case x.status::text when 'in_progress' then 0 when 'waiting' then 1 else 2 end,x.updated_at desc),'[]'::jsonb) from (select * from public.travel_interests where client_id=p_client_id and public_visible and status::text in ('waiting','in_progress','completed') order by case status::text when 'in_progress' then 0 when 'waiting' then 1 else 2 end,updated_at desc limit 20) x;
$$;

alter function public.build_public_client_dashboard_payload(uuid) rename to build_public_client_dashboard_payload_base;
create function public.build_public_client_dashboard_payload(p_client_id uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select public.build_public_client_dashboard_payload_base(p_client_id)||jsonb_build_object('travelInterests',public.build_public_client_travel_interests(p_client_id)); $$;

create or replace function public.get_admin_overview()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid();
begin
  if actor_id is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return jsonb_build_object('activeClients',(select count(*) from public.clients where status='active'),'pendingLeads',(select count(*) from public.clients where status='lead'),'managedPoints',coalesce((select sum(coalesce(latest.balance,0)) from public.program_accounts pa left join lateral(select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1) latest on true where pa.active),0),'generatedSavings',coalesce((select sum(savings_amount) from public.redemptions where status='confirmed'),0),'expiringIn30Days',coalesce((select sum(remaining_points) from public.expiration_lots where status='active' and expires_on between current_date and current_date+30),0),'contractsEndingIn30Days',(select count(*) from public.management_contracts where status='active' and ends_on between current_date and current_date+30),'openTasks',(select count(*) from public.tasks where status in ('open','in_progress')),'openInterests',(select count(*) from public.travel_interests where status::text in ('waiting','in_progress')),'transfersCount',(select count(*) from public.transfers),'operatorName',coalesce((select split_part(trim(p.full_name),' ',1) from public.profiles p where p.id=actor_id),'Equipe MRL'),'role',(select sm.role from public.staff_members sm where sm.user_id=actor_id and sm.active),'canWrite',public.can_write_client_data(),'canArchive',public.can_manage_security());
end;
$$;

revoke all on function public.get_client_travel_interests_admin(uuid,text,integer,integer),public.get_travel_interest_assignees_admin(),public.upsert_travel_interest_v2(uuid,text,date,date,text,text,text,boolean,text,text,date,uuid,text,uuid),public.build_public_client_travel_interests(uuid),public.build_public_client_dashboard_payload_base(uuid),public.build_public_client_dashboard_payload(uuid) from public,anon;
revoke all on function public.build_public_client_travel_interests(uuid),public.build_public_client_dashboard_payload_base(uuid),public.build_public_client_dashboard_payload(uuid) from authenticated;
grant execute on function public.get_client_travel_interests_admin(uuid,text,integer,integer),public.get_travel_interest_assignees_admin(),public.upsert_travel_interest_v2(uuid,text,date,date,text,text,text,boolean,text,text,date,uuid,text,uuid) to authenticated;
grant execute on function public.build_public_client_travel_interests(uuid),public.build_public_client_dashboard_payload_base(uuid),public.build_public_client_dashboard_payload(uuid) to service_role;

commit;
