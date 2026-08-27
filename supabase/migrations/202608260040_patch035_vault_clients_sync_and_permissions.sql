begin;

-- PATCH MRL 035. Corrige a concessao ampla introduzida pela 039 sem
-- apagar historico, eventos ou permissoes explicitamente concedidas a super admins.
update public.staff_vault_permissions vp
set vault_access=false,updated_at=clock_timestamp()
where vp.vault_access
  and not exists(
    select 1 from public.staff_members sm
    where sm.user_id=vp.user_id and sm.active and sm.role='super_admin'
  );

insert into public.staff_vault_permissions(user_id,vault_access,granted_by,granted_at,updated_at)
select sm.user_id,true,sm.user_id,clock_timestamp(),clock_timestamp()
from public.staff_members sm
where sm.active and sm.role='super_admin'
on conflict(user_id) do update set vault_access=true,granted_at=coalesce(public.staff_vault_permissions.granted_at,excluded.granted_at),updated_at=excluded.updated_at;

-- Nenhum membro da equipe e promovido automaticamente a agente. Agentes existentes
-- continuam sujeitos ao cadastro explicito em vault_sync_agents.

create or replace function public.claim_vault_provisioning_events_v1(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100); actor uuid:=auth.uid(); jwt_role text:=coalesce(auth.jwt()->>'role','');
begin
  if jwt_role<>'service_role' and (actor is null or not exists(select 1 from public.vault_sync_agents a where a.user_id=actor and a.active)) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if actor is not null then update public.vault_sync_agents set last_seen_at=clock_timestamp() where user_id=actor; end if;
  return (with claimed as (
    select event_id from public.vault_provisioning_outbox where processing_status in ('pending','failed') order by occurred_at,event_id for update skip locked limit safe_limit
  ), updated as (
    update public.vault_provisioning_outbox o set processing_status='processing' from claimed c where o.event_id=c.event_id returning o.*
  ) select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('eventId',event_id,'clientId',client_id,'displayName',display_name,'contractStartDate',contract_start_date,'contractEndDate',contract_end_date,'eventType',event_type,'occurredAt',occurred_at) order by occurred_at,event_id),'[]'::jsonb)) from updated);
end $$;

create or replace function public.acknowledge_vault_provisioning_event_v1(p_event_id uuid,p_succeeded boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare updated public.vault_provisioning_outbox%rowtype; actor uuid:=auth.uid(); jwt_role text:=coalesce(auth.jwt()->>'role','');
begin
  if jwt_role<>'service_role' and (actor is null or not exists(select 1 from public.vault_sync_agents a where a.user_id=actor and a.active)) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  update public.vault_provisioning_outbox set processing_status=case when p_succeeded then 'processed' else 'failed' end
  where event_id=p_event_id and processing_status in ('processing','processed') returning * into updated;
  if updated.event_id is null then raise exception 'EVENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('eventId',updated.event_id,'processingStatus',updated.processing_status);
end $$;

create or replace function public.retry_vault_provisioning_client_v1(p_client_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); jwt_role text:=coalesce(auth.jwt()->>'role',''); c public.clients%rowtype; term public.management_contracts%rowtype; created_event uuid;
begin
  if jwt_role<>'service_role' and (actor is null or not exists(select 1 from public.vault_sync_agents a where a.user_id=actor and a.active)) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  select * into c from public.clients where id=p_client_id;
  if c.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  select * into term from public.management_contracts mc where mc.client_id=c.id
  order by case when mc.status in ('active','paused') then 0 else 1 end,mc.updated_at desc,mc.id desc limit 1;
  insert into public.vault_provisioning_outbox(client_id,display_name,contract_start_date,contract_end_date,event_type)
  values(c.id,c.full_name,term.starts_on,term.ends_on,case when c.status='ended' then 'client_vault_archive' else 'client_vault_update' end)
  returning event_id into created_event;
  return jsonb_build_object('eventId',created_event,'clientId',c.id,'processingStatus','pending');
end $$;

create or replace function public.enqueue_vault_provisioning_event()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.clients%rowtype; term public.management_contracts%rowtype; event_name text;
begin
  if tg_table_name='management_contracts' then
    select * into c from public.clients where id=new.client_id;
    if c.id is null then return new; end if;
    if new.status in ('active','paused') and new.starts_on is not null then
      event_name:=case when tg_op='INSERT' then 'client_vault_create' else 'client_vault_update' end;
    elsif tg_op='UPDATE' and old.status in ('active','paused') and new.status not in ('active','paused') then
      event_name:='client_vault_archive';
    else return new;
    end if;
    insert into public.vault_provisioning_outbox(client_id,display_name,contract_start_date,contract_end_date,event_type)
    values(c.id,c.full_name,new.starts_on,new.ends_on,event_name);
    return new;
  end if;

  select * into term from public.management_contracts mc where mc.client_id=new.id
  order by case when mc.status in ('active','paused') then 0 else 1 end,mc.updated_at desc,mc.id desc limit 1;
  if term.id is null then return new; end if;
  event_name:=case when new.status='ended' then 'client_vault_archive' when old.status='ended' and new.status<>'ended' then 'client_vault_reactivate' else 'client_vault_update' end;
  insert into public.vault_provisioning_outbox(client_id,display_name,contract_start_date,contract_end_date,event_type)
  values(new.id,new.full_name,term.starts_on,term.ends_on,event_name);
  return new;
end $$;

drop trigger if exists clients_vault_outbox_trg on public.clients;
create trigger clients_vault_outbox_trg after update on public.clients for each row execute function public.enqueue_vault_provisioning_event();

insert into public.vault_provisioning_outbox(client_id,display_name,contract_start_date,contract_end_date,event_type)
select c.id,c.full_name,term.starts_on,term.ends_on,'client_vault_create'
from public.clients c
join lateral(
  select mc.starts_on,mc.ends_on from public.management_contracts mc where mc.client_id=c.id and mc.status in ('active','paused') and mc.starts_on is not null
  order by mc.updated_at desc,mc.id desc limit 1
) term on true
where c.status<>'ended'
  and not exists(select 1 from public.vault_provisioning_outbox o where o.client_id=c.id and o.processing_status in ('pending','processing'));

revoke all on function public.retry_vault_provisioning_client_v1(uuid) from public,anon,authenticated;
grant execute on function public.retry_vault_provisioning_client_v1(uuid) to service_role;
grant execute on function public.retry_vault_provisioning_client_v1(uuid) to authenticated;

comment on function public.retry_vault_provisioning_client_v1 is 'Solicita nova materializacao local por client_id; restrita a agente explicitamente cadastrado ou service_role.';

commit;
