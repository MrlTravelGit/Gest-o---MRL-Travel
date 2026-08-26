-- Concede acesso ao Cofre e permissão de Agente de Sincronização para todos os usuários atuais da equipe
insert into public.staff_vault_permissions (user_id, vault_access)
select user_id, true from public.staff_members
on conflict (user_id) do update set vault_access = true;

insert into public.vault_sync_agents (user_id, active, description)
select user_id, true, 'Agente Local' from public.staff_members
on conflict (user_id) do update set active = true;

-- Permite que o Service Role Key da Supabase consiga realizar a sincronização (auth.uid() is null)
create or replace function public.claim_vault_provisioning_events_v1(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null then
    if (current_setting('request.jwt.claims', true)::jsonb->>'role') != 'service_role' then
      if auth.uid() is null or not exists(select 1 from public.vault_sync_agents a where a.user_id=auth.uid() and a.active) then 
        raise exception 'FORBIDDEN' using errcode='42501'; 
      end if;
      update public.vault_sync_agents set last_seen_at=clock_timestamp() where user_id=auth.uid();
    end if;
  end if;
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
  if nullif(current_setting('request.jwt.claims', true), '') is not null then
    if (current_setting('request.jwt.claims', true)::jsonb->>'role') != 'service_role' then
      if auth.uid() is null or not exists(select 1 from public.vault_sync_agents a where a.user_id=auth.uid() and a.active) then 
        raise exception 'FORBIDDEN' using errcode='42501'; 
      end if;
    end if;
  end if;
  update public.vault_provisioning_outbox set processing_status=case when p_succeeded then 'processed' else 'failed' end
  where event_id=p_event_id and processing_status in ('processing','processed') returning * into updated;
  if updated.event_id is null then raise exception 'EVENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('eventId',updated.event_id,'processingStatus',updated.processing_status);
end $$;
