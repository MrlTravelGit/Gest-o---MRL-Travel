begin;

create or replace function public.has_staff_role(allowed_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_members sm
    where sm.user_id = auth.uid()
      and sm.active
      and sm.role = any(allowed_roles)
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_members sm
    where sm.user_id = auth.uid()
      and sm.active
  );
$$;

create or replace function public.can_write_client_data()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_staff_role(
    array['super_admin', 'manager', 'operator']::public.app_role[]
  );
$$;

create or replace function public.can_manage_security()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_staff_role(
    array['super_admin', 'manager']::public.app_role[]
  );
$$;

create or replace function public.has_client_access(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff() or exists (
    select 1
    from public.client_users cu
    where cu.client_id = target_client_id
      and cu.user_id = auth.uid()
      and cu.active
  );
$$;

create or replace function public.can_access_program_account(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.program_accounts pa
    where pa.id = target_account_id
      and public.has_client_access(pa.client_id)
  );
$$;

create or replace function public.can_access_card(target_card_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.credit_cards cc
    where cc.id = target_card_id
      and public.has_client_access(cc.client_id)
  );
$$;

create or replace function public.can_access_redemption(target_redemption_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.redemptions r
    where r.id = target_redemption_id
      and public.has_client_access(r.client_id)
  );
$$;

revoke all on function public.has_staff_role(public.app_role[]) from public, anon;
revoke all on function public.is_staff() from public, anon;
revoke all on function public.can_write_client_data() from public, anon;
revoke all on function public.can_manage_security() from public, anon;
revoke all on function public.has_client_access(uuid) from public, anon;
revoke all on function public.can_access_program_account(uuid) from public, anon;
revoke all on function public.can_access_card(uuid) from public, anon;
revoke all on function public.can_access_redemption(uuid) from public, anon;

grant execute on function public.has_staff_role(public.app_role[]) to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.can_write_client_data() to authenticated;
grant execute on function public.can_manage_security() to authenticated;
grant execute on function public.has_client_access(uuid) to authenticated;
grant execute on function public.can_access_program_account(uuid) to authenticated;
grant execute on function public.can_access_card(uuid) to authenticated;
grant execute on function public.can_access_redemption(uuid) to authenticated;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'profiles',
    'staff_members',
    'clients',
    'client_users',
    'management_contracts',
    'loyalty_programs',
    'program_accounts',
    'balance_snapshots',
    'point_transactions',
    'expiration_lots',
    'transfers',
    'credit_cards',
    'card_earning_rules',
    'card_statements',
    'redemptions',
    'redemption_point_usages',
    'tasks',
    'notifications',
    'attachments',
    'audit_logs',
    'client_access_challenges',
    'client_access_attempts',
    'login_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('alter table public.%I force row level security', relation_name);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select on public.staff_members to authenticated;
grant select on public.clients to authenticated;
grant select on public.client_users to authenticated;
grant select on public.management_contracts to authenticated;
grant select on public.loyalty_programs to authenticated;
grant select on public.program_accounts to authenticated;
grant select on public.balance_snapshots to authenticated;
grant select on public.point_transactions to authenticated;
grant select on public.expiration_lots to authenticated;
grant select on public.transfers to authenticated;
grant select on public.credit_cards to authenticated;
grant select on public.card_earning_rules to authenticated;
grant select on public.card_statements to authenticated;
grant select on public.redemptions to authenticated;
grant select on public.redemption_point_usages to authenticated;
grant select on public.tasks to authenticated;
grant select on public.notifications to authenticated;
grant select on public.attachments to authenticated;
grant select on public.audit_logs to authenticated;

grant update on public.profiles to authenticated;
grant insert, update, delete on public.staff_members to authenticated;
grant insert, update, delete on public.clients to authenticated;
grant insert, update, delete on public.client_users to authenticated;
grant insert, update, delete on public.management_contracts to authenticated;
grant insert, update, delete on public.loyalty_programs to authenticated;
grant insert, update, delete on public.program_accounts to authenticated;
grant insert, update, delete on public.balance_snapshots to authenticated;
grant insert, update, delete on public.point_transactions to authenticated;
grant insert, update, delete on public.expiration_lots to authenticated;
grant insert, update, delete on public.transfers to authenticated;
grant insert, update, delete on public.credit_cards to authenticated;
grant insert, update, delete on public.card_earning_rules to authenticated;
grant insert, update, delete on public.card_statements to authenticated;
grant insert, update, delete on public.redemptions to authenticated;
grant insert, update, delete on public.redemption_point_usages to authenticated;
grant insert, update, delete on public.tasks to authenticated;
grant insert, update, delete on public.notifications to authenticated;
grant insert, update, delete on public.attachments to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy profiles_select_self_or_staff
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_staff());

create policy profiles_update_staff
on public.profiles for update to authenticated
using (public.can_manage_security())
with check (public.can_manage_security());

create policy staff_select_self_or_staff
on public.staff_members for select to authenticated
using (user_id = auth.uid() or public.is_staff());

create policy staff_manage_super_admin
on public.staff_members for all to authenticated
using (public.has_staff_role(array['super_admin']::public.app_role[]))
with check (public.has_staff_role(array['super_admin']::public.app_role[]));

create policy clients_select_authorized
on public.clients for select to authenticated
using (public.has_client_access(id));

create policy clients_manage_staff
on public.clients for all to authenticated
using (public.can_manage_security())
with check (public.can_manage_security());

create policy client_users_select_authorized
on public.client_users for select to authenticated
using (user_id = auth.uid() or public.is_staff());

create policy client_users_manage_staff
on public.client_users for all to authenticated
using (public.can_manage_security())
with check (public.can_manage_security());

create policy contracts_select_authorized
on public.management_contracts for select to authenticated
using (public.has_client_access(client_id));

create policy contracts_write_staff
on public.management_contracts for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy loyalty_programs_select_authenticated
on public.loyalty_programs for select to authenticated
using (true);

create policy loyalty_programs_manage_staff
on public.loyalty_programs for all to authenticated
using (public.can_manage_security())
with check (public.can_manage_security());

create policy program_accounts_select_authorized
on public.program_accounts for select to authenticated
using (public.has_client_access(client_id));

create policy program_accounts_write_staff
on public.program_accounts for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy snapshots_select_authorized
on public.balance_snapshots for select to authenticated
using (public.can_access_program_account(account_id));

create policy snapshots_write_staff
on public.balance_snapshots for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy transactions_select_authorized
on public.point_transactions for select to authenticated
using (public.can_access_program_account(account_id));

create policy transactions_write_staff
on public.point_transactions for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy expirations_select_authorized
on public.expiration_lots for select to authenticated
using (public.can_access_program_account(account_id));

create policy expirations_write_staff
on public.expiration_lots for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy transfers_select_authorized
on public.transfers for select to authenticated
using (public.has_client_access(client_id));

create policy transfers_write_staff
on public.transfers for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy cards_select_authorized
on public.credit_cards for select to authenticated
using (public.has_client_access(client_id));

create policy cards_write_staff
on public.credit_cards for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy earning_rules_select_authorized
on public.card_earning_rules for select to authenticated
using (public.can_access_card(card_id));

create policy earning_rules_write_staff
on public.card_earning_rules for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy statements_select_authorized
on public.card_statements for select to authenticated
using (public.can_access_card(card_id));

create policy statements_write_staff
on public.card_statements for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy redemptions_select_authorized
on public.redemptions for select to authenticated
using (public.has_client_access(client_id));

create policy redemptions_write_staff
on public.redemptions for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy redemption_usage_select_authorized
on public.redemption_point_usages for select to authenticated
using (public.can_access_redemption(redemption_id));

create policy redemption_usage_write_staff
on public.redemption_point_usages for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy tasks_select_authorized
on public.tasks for select to authenticated
using (public.is_staff() or (client_id is not null and public.has_client_access(client_id)));

create policy tasks_write_staff
on public.tasks for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy notifications_staff_only
on public.notifications for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy attachments_select_authorized
on public.attachments for select to authenticated
using (public.has_client_access(client_id));

create policy attachments_write_staff
on public.attachments for all to authenticated
using (public.can_write_client_data())
with check (public.can_write_client_data());

create policy audit_select_staff
on public.audit_logs for select to authenticated
using (public.is_staff());

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb;
  new_row jsonb;
  resolved_client_id uuid;
  resolved_record_id text;
begin
  old_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  resolved_client_id := coalesce(
    nullif(new_row ->> 'client_id', '')::uuid,
    nullif(old_row ->> 'client_id', '')::uuid,
    case when tg_table_name = 'clients' then coalesce(
      nullif(new_row ->> 'id', '')::uuid,
      nullif(old_row ->> 'id', '')::uuid
    ) else null end
  );

  resolved_record_id := coalesce(new_row ->> 'id', old_row ->> 'id');

  insert into public.audit_logs (
    actor_user_id,
    client_id,
    action,
    table_name,
    record_id,
    old_data,
    new_data
  )
  values (
    auth.uid(),
    resolved_client_id,
    lower(tg_op),
    tg_table_name,
    resolved_record_id,
    old_row,
    new_row
  );

  return coalesce(new, old);
end;
$$;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'clients',
    'client_users',
    'management_contracts',
    'program_accounts',
    'balance_snapshots',
    'point_transactions',
    'expiration_lots',
    'transfers',
    'credit_cards',
    'card_earning_rules',
    'card_statements',
    'redemptions',
    'redemption_point_usages',
    'tasks',
    'attachments'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      relation_name || '_audit',
      relation_name
    );
  end loop;
end;
$$;

create or replace function public.get_client_dashboard(p_public_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved_client public.clients%rowtype;
  result jsonb;
begin
  select c.*
  into resolved_client
  from public.clients c
  where c.public_id = p_public_id
    and c.status = 'active'
    and public.has_client_access(c.id);

  if resolved_client.id is null then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'client', jsonb_build_object(
      'id', resolved_client.id,
      'publicId', resolved_client.public_id,
      'fullName', resolved_client.full_name,
      'lastUpdatedAt', (
        select max(bs.captured_at)
        from public.balance_snapshots bs
        join public.program_accounts pa on pa.id = bs.account_id
        where pa.client_id = resolved_client.id
      )
    ),
    'summary', jsonb_build_object(
      'totalPoints', coalesce((
        select sum(latest.balance)
        from public.program_accounts pa
        left join lateral (
          select bs.balance
          from public.balance_snapshots bs
          where bs.account_id = pa.id
          order by bs.captured_at desc
          limit 1
        ) latest on true
        where pa.client_id = resolved_client.id and pa.active
      ), 0),
      'estimatedPatrimony', coalesce((
        select sum(latest.estimated_value)
        from public.program_accounts pa
        left join lateral (
          select bs.estimated_value
          from public.balance_snapshots bs
          where bs.account_id = pa.id
          order by bs.captured_at desc
          limit 1
        ) latest on true
        where pa.client_id = resolved_client.id and pa.active
      ), 0),
      'generatedSavings', coalesce((
        select sum(r.savings_amount)
        from public.redemptions r
        where r.client_id = resolved_client.id and r.status = 'confirmed'
      ), 0),
      'redemptionsCount', (
        select count(*)
        from public.redemptions r
        where r.client_id = resolved_client.id and r.status = 'confirmed'
      ),
      'expiringIn90Days', coalesce((
        select sum(el.remaining_points)
        from public.expiration_lots el
        join public.program_accounts pa on pa.id = el.account_id
        where pa.client_id = resolved_client.id
          and el.status = 'active'
          and el.expires_on between current_date and current_date + 90
      ), 0)
    ),
    'programs', coalesce((
      select jsonb_agg(program_row order by program_row ->> 'name')
      from (
        select jsonb_build_object(
          'accountId', pa.id,
          'slug', lp.slug,
          'name', lp.name,
          'logoUrl', lp.logo_url,
          'balance', coalesce(latest.balance, 0),
          'averageCostPerThousand', coalesce(latest.average_cost_per_thousand, 0),
          'estimatedValue', coalesce(latest.estimated_value, 0),
          'capturedAt', latest.captured_at,
          'expiringPoints', coalesce((
            select sum(el.remaining_points)
            from public.expiration_lots el
            where el.account_id = pa.id
              and el.status = 'active'
              and el.expires_on between current_date and current_date + 90
          ), 0)
        ) as program_row
        from public.program_accounts pa
        join public.loyalty_programs lp on lp.id = pa.program_id
        left join lateral (
          select bs.balance, bs.average_cost_per_thousand, bs.estimated_value, bs.captured_at
          from public.balance_snapshots bs
          where bs.account_id = pa.id
          order by bs.captured_at desc
          limit 1
        ) latest on true
        where pa.client_id = resolved_client.id and pa.active
      ) rows
    ), '[]'::jsonb),
    'balanceHistory', coalesce((
      select jsonb_agg(history_row order by history_row ->> 'month')
      from (
        select jsonb_build_object(
          'month', ranked.month,
          'balance', sum(ranked.balance)
        ) as history_row
        from (
          select
            date_trunc('month', bs.captured_at)::date as month,
            bs.account_id,
            bs.balance,
            row_number() over (
              partition by bs.account_id, date_trunc('month', bs.captured_at)
              order by bs.captured_at desc
            ) as position
          from public.balance_snapshots bs
          join public.program_accounts pa on pa.id = bs.account_id
          where pa.client_id = resolved_client.id
        ) ranked
        where ranked.position = 1
        group by ranked.month
      ) rows
    ), '[]'::jsonb),
    'cardStatements', coalesce((
      select jsonb_agg(statement_row order by statement_row ->> 'month')
      from (
        select jsonb_build_object(
          'month', cs.statement_month,
          'totalSpend', sum(cs.total_spend),
          'eligibleSpend', sum(cs.eligible_spend),
          'expectedPoints', sum(cs.expected_points),
          'receivedPoints', sum(cs.received_points),
          'divergence', sum(cs.divergence)
        ) as statement_row
        from public.card_statements cs
        join public.credit_cards cc on cc.id = cs.card_id
        where cc.client_id = resolved_client.id and cs.status = 'confirmed'
        group by cs.statement_month
      ) rows
    ), '[]'::jsonb),
    'contract', (
      select jsonb_build_object(
        'startsOn', mc.starts_on,
        'endsOn', mc.ends_on,
        'status', mc.status,
        'planName', mc.plan_name,
        'daysRemaining', greatest(mc.ends_on - current_date, 0)
      )
      from public.management_contracts mc
      where mc.client_id = resolved_client.id
        and mc.status in ('active', 'paused')
      order by mc.ends_on desc
      limit 1
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_client_dashboard(uuid) from public, anon;
grant execute on function public.get_client_dashboard(uuid) to authenticated;

create or replace function public.get_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'activeClients', (select count(*) from public.clients where status = 'active'),
    'managedPoints', coalesce((
      select sum(latest.balance)
      from public.program_accounts pa
      left join lateral (
        select bs.balance
        from public.balance_snapshots bs
        where bs.account_id = pa.id
        order by bs.captured_at desc
        limit 1
      ) latest on true
      where pa.active
    ), 0),
    'generatedSavings', coalesce((
      select sum(savings_amount)
      from public.redemptions
      where status = 'confirmed'
    ), 0),
    'expiringIn30Days', coalesce((
      select sum(remaining_points)
      from public.expiration_lots
      where status = 'active'
        and expires_on between current_date and current_date + 30
    ), 0),
    'contractsEndingIn30Days', (
      select count(*)
      from public.management_contracts
      where status = 'active'
        and ends_on between current_date and current_date + 30
    ),
    'openTasks', (
      select count(*)
      from public.tasks
      where status in ('open', 'in_progress')
    )
  );
end;
$$;

revoke all on function public.get_admin_overview() from public, anon;
grant execute on function public.get_admin_overview() to authenticated;

create or replace function public.create_client_bundle(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_full_name text,
  p_email text,
  p_phone_e164 text,
  p_access_channel public.access_channel,
  p_starts_on date,
  p_ends_on date,
  p_plan_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  created_client public.clients%rowtype;
  created_contract public.management_contracts%rowtype;
begin
  if not exists (
    select 1
    from public.staff_members sm
    where sm.user_id = p_actor_user_id
      and sm.active
      and sm.role in ('super_admin', 'manager')
  ) then
    raise exception 'Operador sem permissão' using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'Usuário de autenticação inexistente' using errcode = '23503';
  end if;

  insert into public.profiles (
    id,
    full_name,
    first_name_normalized,
    email,
    phone_e164,
    preferred_access_channel,
    active
  )
  values (
    p_auth_user_id,
    trim(p_full_name),
    public.normalize_first_name(p_full_name),
    nullif(trim(p_email), '')::extensions.citext,
    nullif(trim(p_phone_e164), ''),
    p_access_channel,
    true
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    phone_e164 = excluded.phone_e164,
    preferred_access_channel = excluded.preferred_access_channel,
    active = true,
    updated_at = now();

  insert into public.clients (
    full_name,
    first_name_normalized,
    email,
    phone_e164,
    status,
    created_by
  )
  values (
    trim(p_full_name),
    public.normalize_first_name(p_full_name),
    nullif(trim(p_email), '')::extensions.citext,
    nullif(trim(p_phone_e164), ''),
    'active',
    p_actor_user_id
  )
  returning * into created_client;

  insert into public.client_users (client_id, user_id, role, active, created_by)
  values (created_client.id, p_auth_user_id, 'client', true, p_actor_user_id);

  insert into public.management_contracts (
    client_id,
    starts_on,
    ends_on,
    status,
    plan_name,
    created_by
  )
  values (
    created_client.id,
    p_starts_on,
    p_ends_on,
    'active',
    p_plan_name,
    p_actor_user_id
  )
  returning * into created_contract;

  insert into public.audit_logs (
    actor_user_id,
    client_id,
    action,
    table_name,
    record_id,
    new_data
  )
  values (
    p_actor_user_id,
    created_client.id,
    'create_client_bundle',
    'clients',
    created_client.id::text,
    jsonb_build_object(
      'clientId', created_client.id,
      'publicId', created_client.public_id,
      'contractId', created_contract.id
    )
  );

  return jsonb_build_object(
    'clientId', created_client.id,
    'publicId', created_client.public_id,
    'contractId', created_contract.id
  );
end;
$$;

revoke all on function public.create_client_bundle(
  uuid, uuid, text, text, text, public.access_channel, date, date, text
) from public, anon, authenticated;
grant execute on function public.create_client_bundle(
  uuid, uuid, text, text, text, public.access_channel, date, date, text
) to service_role;

grant all on public.client_access_challenges to service_role;
grant all on public.client_access_attempts to service_role;
grant all on public.login_events to service_role;
grant all on public.audit_logs to service_role;
grant usage, select on all sequences in schema public to service_role;

commit;
