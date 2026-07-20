-- PATCH MRL 20260717-015
-- Ciclo operacional do lead criado pelo onboarding: revisão, contrato e ativação.

begin;

create or replace function public.prevent_active_contract_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' and exists (
    select 1
      from public.management_contracts mc
     where mc.client_id = new.client_id
       and mc.status = 'active'
       and mc.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
       and daterange(mc.starts_on, mc.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')
  ) then
    raise exception 'ACTIVE_CONTRACT_OVERLAP' using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists management_contracts_prevent_active_overlap on public.management_contracts;
create trigger management_contracts_prevent_active_overlap
before insert or update of client_id, starts_on, ends_on, status
on public.management_contracts
for each row execute function public.prevent_active_contract_overlap();

drop function if exists public.activate_onboarding_lead(uuid, date, date, text, text);

create or replace function public.activate_onboarding_lead(
  p_client_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_plan_name text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.app_role;
  client_row public.clients%rowtype;
  submission_row public.client_onboarding_submissions%rowtype;
  contract_row public.management_contracts%rowtype;
begin
  if actor_id is null then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select sm.role into actor_role
    from public.staff_members sm
   where sm.user_id = actor_id
     and sm.active
   limit 1;

  if actor_role is null or actor_role not in ('super_admin', 'manager') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'CLIENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'INVALID_CONTRACT_DATES' using errcode = '22007';
  end if;

  if nullif(trim(coalesce(p_plan_name, '')), '') is null then
    raise exception 'PLAN_REQUIRED' using errcode = '22023';
  end if;

  select * into client_row
    from public.clients
   where id = p_client_id
   for update;

  if client_row.id is null then
    raise exception 'CLIENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into submission_row
    from public.client_onboarding_submissions s
   where s.client_id = client_row.id
   order by s.submitted_at desc nulls last, s.created_at desc
   limit 1
   for update;

  if client_row.status = 'active' then
    select * into contract_row
      from public.management_contracts mc
     where mc.client_id = client_row.id
       and mc.status = 'active'
       and mc.starts_on <= current_date
       and mc.ends_on >= current_date
     order by mc.created_at desc, mc.id desc
     limit 1;

    if contract_row.id is null then
      raise exception 'ACTIVE_CONTRACT_REQUIRED' using errcode = 'P0002';
    end if;

    return jsonb_build_object(
      'ok', true,
      'alreadyActive', true,
      'client', jsonb_build_object('id', client_row.id, 'status', client_row.status, 'fullName', client_row.full_name),
      'contract', jsonb_build_object('id', contract_row.id, 'startsOn', contract_row.starts_on, 'endsOn', contract_row.ends_on, 'status', contract_row.status, 'planName', contract_row.plan_name)
    );
  end if;

  if client_row.status <> 'lead' then
    raise exception 'CLIENT_NOT_LEAD' using errcode = '22023';
  end if;

  if submission_row.id is null then
    raise exception 'ONBOARDING_SUBMISSION_REQUIRED' using errcode = 'P0002';
  end if;

  if submission_row.status = 'duplicate_review' or submission_row.duplicate_candidate_client_id is not null then
    raise exception 'DUPLICATE_REVIEW_REQUIRED' using errcode = '23505';
  end if;

  if nullif(trim(client_row.full_name), '') is null or (client_row.email is null and nullif(trim(coalesce(client_row.phone_e164, '')), '') is null) then
    raise exception 'CLIENT_MINIMUM_DATA_REQUIRED' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.management_contracts mc
     where mc.client_id = client_row.id
       and mc.status = 'active'
       and daterange(mc.starts_on, mc.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')
  ) then
    raise exception 'ACTIVE_CONTRACT_OVERLAP' using errcode = '23P01';
  end if;

  insert into public.management_contracts(client_id, starts_on, ends_on, status, plan_name, notes, created_by)
  values(client_row.id, p_starts_on, p_ends_on, 'active', trim(p_plan_name), nullif(trim(coalesce(p_notes, '')), ''), actor_id)
  returning * into contract_row;

  update public.clients
     set status = 'active',
         updated_at = clock_timestamp()
   where id = client_row.id
   returning * into client_row;

  update public.client_onboarding_submissions
     set status = 'activated',
         reviewed_by = actor_id,
         reviewed_at = clock_timestamp(),
         admin_notes = nullif(trim(coalesce(p_notes, '')), '')
   where id = submission_row.id
   returning * into submission_row;

  insert into public.client_onboarding_events(publication_id, submission_id, client_id, actor_user_id, event_type, metadata)
  values(
    submission_row.publication_id,
    submission_row.id,
    client_row.id,
    actor_id,
    'admin_submission_viewed',
    jsonb_build_object('activation', true, 'contractId', contract_row.id)
  );

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(
    actor_id,
    client_row.id,
    'activate_onboarding_lead',
    'management_contracts',
    contract_row.id::text,
    jsonb_build_object(
      'clientId', client_row.id,
      'contractId', contract_row.id,
      'startsOn', contract_row.starts_on,
      'endsOn', contract_row.ends_on,
      'planName', contract_row.plan_name,
      'submissionId', submission_row.id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'alreadyActive', false,
    'client', jsonb_build_object('id', client_row.id, 'status', client_row.status, 'fullName', client_row.full_name),
    'contract', jsonb_build_object('id', contract_row.id, 'startsOn', contract_row.starts_on, 'endsOn', contract_row.ends_on, 'status', contract_row.status, 'planName', contract_row.plan_name),
    'submission', jsonb_build_object('id', submission_row.id, 'status', submission_row.status)
  );
end;
$$;

revoke all on function public.activate_onboarding_lead(uuid, date, date, text, text) from public, anon;
grant execute on function public.activate_onboarding_lead(uuid, date, date, text, text) to authenticated;
comment on function public.activate_onboarding_lead(uuid, date, date, text, text)
is 'Ativa transacionalmente um lead criado por onboarding: cria contrato ativo, muda clients.status para active, marca submissão e audita. Ator derivado de auth.uid().';

create or replace function public.get_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'activeClients', (select count(*) from public.clients where status = 'active'),
    'pendingLeads', (select count(*) from public.clients where status = 'lead'),
    'managedPoints', coalesce((select sum(coalesce(latest.balance, 0)) from public.program_accounts pa left join lateral (
      select bs.balance from public.balance_snapshots bs where bs.account_id = pa.id order by bs.captured_at desc, bs.id desc limit 1
    ) latest on true where pa.active), 0),
    'generatedSavings', coalesce((select sum(savings_amount) from public.redemptions where status = 'confirmed'), 0),
    'expiringIn30Days', coalesce((select sum(remaining_points) from public.expiration_lots where status = 'active' and expires_on between current_date and current_date + 30), 0),
    'contractsEndingIn30Days', (select count(*) from public.management_contracts where status = 'active' and ends_on between current_date and current_date + 30),
    'openTasks', (select count(*) from public.tasks where status in ('open', 'in_progress')),
    'openInterests', (select count(*) from public.travel_interests where status in ('open', 'quoting')),
    'transfersCount', (select count(*) from public.transfers),
    'operatorName', coalesce((select split_part(trim(p.full_name), ' ', 1) from public.profiles p where p.id = actor_id), 'Equipe MRL'),
    'role', (select sm.role from public.staff_members sm where sm.user_id = actor_id and sm.active),
    'canWrite', public.can_write_client_data(),
    'canArchive', public.can_manage_security()
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
