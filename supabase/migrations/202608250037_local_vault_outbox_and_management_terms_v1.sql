begin;

-- PATCH MRL 032. O Supabase recebe somente permissao, identificadores opacos,
-- vigencias e eventos minimos. Nenhum segredo ou documento local e armazenado aqui.

create table if not exists public.staff_vault_permissions (
  user_id uuid primary key references public.staff_members(user_id) on delete cascade,
  vault_access boolean not null default false,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.vault_sync_agents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  agent_name text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.vault_provisioning_outbox (
  event_id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  display_name text not null,
  contract_start_date date,
  contract_end_date date,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  processing_status text not null default 'pending',
  constraint vault_outbox_event_type_valid check(event_type in ('client_vault_create','client_vault_update','client_vault_archive','client_vault_reactivate')),
  constraint vault_outbox_status_valid check(processing_status in ('pending','processing','processed','failed'))
);

create index if not exists vault_outbox_pending_idx on public.vault_provisioning_outbox(processing_status,occurred_at,event_id);
create index if not exists vault_outbox_client_idx on public.vault_provisioning_outbox(client_id,occurred_at desc);
create index if not exists management_contracts_terms_idx on public.management_contracts(client_id,starts_on,ends_on,status);
create index if not exists redemptions_client_launched_status_idx on public.redemptions(client_id,launched_on,status);

alter table public.staff_vault_permissions enable row level security;
alter table public.staff_vault_permissions force row level security;
alter table public.vault_sync_agents enable row level security;
alter table public.vault_sync_agents force row level security;
alter table public.vault_provisioning_outbox enable row level security;
alter table public.vault_provisioning_outbox force row level security;

drop policy if exists staff_vault_permission_self_read on public.staff_vault_permissions;
create policy staff_vault_permission_self_read on public.staff_vault_permissions for select to authenticated using(user_id=auth.uid() or public.can_manage_security());
drop policy if exists staff_vault_permission_admin_write on public.staff_vault_permissions;
create policy staff_vault_permission_admin_write on public.staff_vault_permissions for all to authenticated using(public.can_manage_security()) with check(public.can_manage_security());

revoke all on public.staff_vault_permissions,public.vault_sync_agents,public.vault_provisioning_outbox from public,anon;
grant select on public.staff_vault_permissions to authenticated;
grant insert,update,delete on public.staff_vault_permissions to authenticated;
grant all on public.staff_vault_permissions,public.vault_sync_agents,public.vault_provisioning_outbox to service_role;

create or replace function public.has_vault_access(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select p_user_id is not null and exists(
    select 1 from public.staff_members sm join public.staff_vault_permissions vp on vp.user_id=sm.user_id
    where sm.user_id=p_user_id and sm.active and vp.vault_access
  );
$$;

create or replace function public.get_my_vault_access_v1()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  return jsonb_build_object('vaultAccess',public.has_vault_access(auth.uid()));
end $$;

create or replace function public.enqueue_vault_provisioning_event()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.clients%rowtype; term public.management_contracts%rowtype; event_name text;
begin
  if tg_table_name='management_contracts' then
    if new.starts_on is null or new.status not in ('active','paused') then return new; end if;
    select * into c from public.clients where id=new.client_id;
    event_name:=case when tg_op='INSERT' then 'client_vault_create' else 'client_vault_update' end;
    insert into public.vault_provisioning_outbox(client_id,display_name,contract_start_date,contract_end_date,event_type)
    values(c.id,c.full_name,new.starts_on,new.ends_on,event_name);
    return new;
  end if;

  if tg_op='UPDATE' and old.status is distinct from new.status then
    select * into term from public.management_contracts mc where mc.client_id=new.id
      order by case when mc.status in ('active','paused') then 0 else 1 end,mc.updated_at desc,mc.id desc limit 1;
    event_name:=case when new.status='ended' then 'client_vault_archive' when old.status='ended' and new.status<>'ended' then 'client_vault_reactivate' else 'client_vault_update' end;
    insert into public.vault_provisioning_outbox(client_id,display_name,contract_start_date,contract_end_date,event_type)
    values(new.id,new.full_name,term.starts_on,term.ends_on,event_name);
  elsif tg_op='UPDATE' and old.full_name is distinct from new.full_name and exists(select 1 from public.management_contracts where client_id=new.id) then
    select * into term from public.management_contracts mc where mc.client_id=new.id order by mc.updated_at desc,mc.id desc limit 1;
    insert into public.vault_provisioning_outbox(client_id,display_name,contract_start_date,contract_end_date,event_type)
    values(new.id,new.full_name,term.starts_on,term.ends_on,'client_vault_update');
  end if;
  return new;
end $$;

drop trigger if exists management_contracts_vault_outbox_trg on public.management_contracts;
create trigger management_contracts_vault_outbox_trg after insert or update of starts_on,ends_on,status on public.management_contracts for each row execute function public.enqueue_vault_provisioning_event();
drop trigger if exists clients_vault_outbox_trg on public.clients;
create trigger clients_vault_outbox_trg after update of full_name,status on public.clients for each row execute function public.enqueue_vault_provisioning_event();

create or replace function public.claim_vault_provisioning_events_v1(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  if auth.uid() is null or not exists(select 1 from public.vault_sync_agents a where a.user_id=auth.uid() and a.active) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  update public.vault_sync_agents set last_seen_at=clock_timestamp() where user_id=auth.uid();
  return (with claimed as (
    select event_id from public.vault_provisioning_outbox where processing_status in ('pending','failed') order by occurred_at,event_id for update skip locked limit safe_limit
  ), updated as (
    update public.vault_provisioning_outbox o set processing_status='processing' from claimed c where o.event_id=c.event_id returning o.*
  ) select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('eventId',event_id,'clientId',client_id,'displayName',display_name,'contractStartDate',contract_start_date,'contractEndDate',contract_end_date,'eventType',event_type,'occurredAt',occurred_at) order by occurred_at,event_id),'[]'::jsonb)) from updated);
end $$;

create or replace function public.acknowledge_vault_provisioning_event_v1(p_event_id uuid,p_succeeded boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare updated public.vault_provisioning_outbox%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.vault_sync_agents a where a.user_id=auth.uid() and a.active) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  update public.vault_provisioning_outbox set processing_status=case when p_succeeded then 'processed' else 'failed' end
  where event_id=p_event_id and processing_status in ('processing','processed') returning * into updated;
  if updated.event_id is null then raise exception 'EVENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('eventId',updated.event_id,'processingStatus',updated.processing_status);
end $$;

create or replace function public.get_client_management_terms_v1(
  p_search text default null,p_term_status text default 'all',p_client_status text default 'all',
  p_start_from date default null,p_start_to date default null,p_end_from date default null,p_end_to date default null,
  p_has_savings boolean default null,p_has_cashback boolean default null,p_savings_min numeric default null,p_savings_max numeric default null,
  p_cashback_min numeric default null,p_cashback_max numeric default null,p_sort_by text default 'client_name',p_sort_direction text default 'asc',
  p_limit integer default 25,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,25),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0);
  search_value text:=nullif(trim(coalesce(p_search,'')),''); term_filter text:=lower(coalesce(nullif(trim(p_term_status),''),'all'));
  client_filter text:=lower(coalesce(nullif(trim(p_client_status),''),'all')); sort_value text:=lower(coalesce(nullif(trim(p_sort_by),''),'client_name'));
  direction_value text:=lower(coalesce(nullif(trim(p_sort_direction),''),'asc'));
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if term_filter not in ('all','active','expiring','ended','no_term','archived') then raise exception 'INVALID_TERM_STATUS' using errcode='22023'; end if;
  if client_filter not in ('all','active','archived') then raise exception 'INVALID_CLIENT_STATUS' using errcode='22023'; end if;
  if sort_value not in ('client_name','starts_on','ends_on','remaining_days','total_days','savings','cashback','last_activity') then raise exception 'INVALID_SORT_FIELD' using errcode='22023'; end if;
  if direction_value not in ('asc','desc') then raise exception 'INVALID_SORT_DIRECTION' using errcode='22023'; end if;
  if (p_start_from is not null and p_start_to is not null and p_start_to<p_start_from) or (p_end_from is not null and p_end_to is not null and p_end_to<p_end_from) then raise exception 'INVALID_PERIOD' using errcode='22007'; end if;
  return (with base as materialized(
    select c.id client_id,c.full_name,c.status::text client_status,mc.id contract_id,mc.starts_on,mc.ends_on,mc.status::text contract_status,
      case when c.status='ended' then 'archived' when mc.id is null or mc.starts_on>current_date then 'no_term'
        when mc.ends_on<current_date or mc.status in ('ended','cancelled') then 'ended'
        when mc.ends_on between current_date and current_date+30 then 'expiring' else 'active' end term_status,
      case when mc.id is null then null when mc.ends_on is null then greatest(current_date-mc.starts_on+1,0) else mc.ends_on-mc.starts_on+1 end total_days,
      case when mc.id is null then null else greatest(least(current_date,coalesce(mc.ends_on,current_date))-mc.starts_on+1,0) end elapsed_days,
      case when mc.ends_on is null then null else mc.ends_on-current_date end remaining_days,
      case when mc.id is null then 0 when mc.ends_on is null then 100 else least(greatest(round(100.0*greatest(least(current_date,mc.ends_on)-mc.starts_on+1,0)/nullif(mc.ends_on-mc.starts_on+1,0),1),0),100) end progress_percent,
      coalesce(fin.savings,0)::numeric savings,coalesce(fin.cashback,0)::numeric cashback,fin.last_activity,
      coalesce(hist.historical_savings,0)::numeric historical_savings,coalesce(hist.historical_cashback,0)::numeric historical_cashback
    from public.clients c
    left join lateral(select x.* from public.management_contracts x where x.client_id=c.id order by case when x.status in ('active','paused') and x.starts_on<=current_date and (x.ends_on is null or x.ends_on>=current_date) then 0 else 1 end,x.starts_on desc,x.updated_at desc,x.id desc limit 1) mc on true
    left join lateral(
      select coalesce((select sum(r.savings_amount) from public.redemptions r where r.client_id=c.id and r.status='confirmed' and mc.id is not null and r.launched_on>=mc.starts_on and r.launched_on<=coalesce(mc.ends_on,current_date)),0) savings,
        coalesce((select sum(case when t.transaction_type='earning' then t.amount when t.transaction_type='reversal' then -t.amount when t.transaction_type='adjustment' then t.amount else 0 end)
          from public.cashback_transactions t left join public.redemptions r on r.id=t.redemption_id where t.client_id=c.id and t.status='confirmed' and t.transaction_type in ('earning','reversal','adjustment') and mc.id is not null
          and coalesce(r.launched_on,t.created_at::date)>=mc.starts_on and coalesce(r.launched_on,t.created_at::date)<=coalesce(mc.ends_on,current_date)),0) cashback,
        (select max(r.launched_on) from public.redemptions r where r.client_id=c.id and r.status='confirmed' and mc.id is not null and r.launched_on between mc.starts_on and coalesce(mc.ends_on,current_date)) last_activity
    ) fin on true
    left join lateral(select coalesce(sum(r.savings_amount) filter(where r.status='confirmed'),0) historical_savings,coalesce(sum(r.cashback_amount) filter(where r.status='confirmed'),0) historical_cashback from public.redemptions r where r.client_id=c.id) hist on true
  ), filtered as materialized(
    select * from base where (search_value is null or full_name ilike '%'||search_value||'%')
      and (term_filter='all' or term_status=term_filter) and (client_filter='all' or (client_filter='archived' and client_status='ended') or (client_filter='active' and client_status<>'ended'))
      and (p_start_from is null or starts_on>=p_start_from) and (p_start_to is null or starts_on<=p_start_to)
      and (p_end_from is null or ends_on>=p_end_from) and (p_end_to is null or ends_on<=p_end_to)
      and (p_has_savings is null or (savings>0)=p_has_savings) and (p_has_cashback is null or (cashback<>0)=p_has_cashback)
      and (p_savings_min is null or savings>=p_savings_min) and (p_savings_max is null or savings<=p_savings_max)
      and (p_cashback_min is null or cashback>=p_cashback_min) and (p_cashback_max is null or cashback<=p_cashback_max)
  ), paged as(
    select * from filtered order by
      case when direction_value='asc' and sort_value='client_name' then full_name end asc,case when direction_value='desc' and sort_value='client_name' then full_name end desc,
      case when direction_value='asc' and sort_value='starts_on' then starts_on end asc nulls last,case when direction_value='desc' and sort_value='starts_on' then starts_on end desc nulls last,
      case when direction_value='asc' and sort_value='ends_on' then ends_on end asc nulls last,case when direction_value='desc' and sort_value='ends_on' then ends_on end desc nulls last,
      case when direction_value='asc' and sort_value='remaining_days' then remaining_days end asc nulls last,case when direction_value='desc' and sort_value='remaining_days' then remaining_days end desc nulls last,
      case when direction_value='asc' and sort_value='total_days' then total_days end asc nulls last,case when direction_value='desc' and sort_value='total_days' then total_days end desc nulls last,
      case when direction_value='asc' and sort_value='savings' then savings end asc,case when direction_value='desc' and sort_value='savings' then savings end desc,
      case when direction_value='asc' and sort_value='cashback' then cashback end asc,case when direction_value='desc' and sort_value='cashback' then cashback end desc,
      case when direction_value='asc' and sort_value='last_activity' then last_activity end asc nulls last,case when direction_value='desc' and sort_value='last_activity' then last_activity end desc nulls last,
      full_name,client_id limit safe_limit offset safe_offset
  ) select jsonb_build_object(
    'summary',jsonb_build_object('active',(select count(*) from filtered where term_status='active'),'expiring',(select count(*) from filtered where term_status='expiring'),'ended',(select count(*) from filtered where term_status='ended'),'noTerm',(select count(*) from filtered where term_status='no_term'),'totalSavings',coalesce((select sum(savings) from filtered),0),'totalCashback',coalesce((select sum(cashback) from filtered),0)),
    'items',coalesce((select jsonb_agg(jsonb_build_object('clientId',client_id,'clientName',full_name,'clientStatus',client_status,'contractId',contract_id,'contractStatus',contract_status,'termStatus',term_status,'startsOn',starts_on,'endsOn',ends_on,'totalDays',total_days,'elapsedDays',elapsed_days,'remainingDays',remaining_days,'progressPercent',progress_percent,'savings',savings,'cashback',cashback,'historicalSavings',historical_savings,'historicalCashback',historical_cashback,'lastActivity',last_activity) order by array_position(array(select client_id from paged),client_id)) from paged),'[]'::jsonb),
    'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset,'canVaultAccess',public.has_vault_access(auth.uid())
  ));
end $$;

revoke all on function public.has_vault_access(uuid),public.get_my_vault_access_v1(),public.claim_vault_provisioning_events_v1(integer),public.acknowledge_vault_provisioning_event_v1(uuid,boolean),public.get_client_management_terms_v1(text,text,text,date,date,date,date,boolean,boolean,numeric,numeric,numeric,numeric,text,text,integer,integer) from public,anon;
grant execute on function public.has_vault_access(uuid),public.get_my_vault_access_v1(),public.get_client_management_terms_v1(text,text,text,date,date,date,date,boolean,boolean,numeric,numeric,numeric,numeric,text,text,integer,integer) to authenticated;
grant execute on function public.claim_vault_provisioning_events_v1(integer),public.acknowledge_vault_provisioning_event_v1(uuid,boolean) to authenticated;

comment on table public.vault_provisioning_outbox is 'Outbox minima para provisionamento local. Proibido armazenar segredos, contatos ou documentos.';
comment on function public.get_client_management_terms_v1 is 'Vigencias administrativas v1; economia confirmada e cashback liquido do ledger limitados ao contrato selecionado.';

commit;
