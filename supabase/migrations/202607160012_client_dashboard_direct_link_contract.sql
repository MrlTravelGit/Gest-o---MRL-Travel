-- PATCH MRL 0.4.2 / 006
-- Restaura o dashboard completo do cliente no link direto, sem login/sessao de cliente.

create or replace function public.build_public_client_dashboard_payload(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved_client public.clients%rowtype;
begin
  select *
    into resolved_client
    from public.clients
   where id = p_client_id
     and status = 'active';

  if resolved_client.id is null then
    raise exception 'Cliente ativo não encontrado.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'client', jsonb_build_object(
      'displayName', resolved_client.full_name,
      'lastUpdatedAt', (
        select max(updated_at)
          from (
            select max(bs.captured_at) as updated_at
              from public.balance_snapshots bs
              join public.program_accounts pa on pa.id = bs.account_id
             where pa.client_id = resolved_client.id
            union all
            select max(pt.created_at)
              from public.point_transactions pt
              join public.program_accounts pa on pa.id = pt.account_id
             where pa.client_id = resolved_client.id
            union all
            select max(r.created_at)
              from public.redemptions r
             where r.client_id = resolved_client.id
            union all
            select max(cs.created_at)
              from public.card_statements cs
              join public.credit_cards cc on cc.id = cs.card_id
             where cc.client_id = resolved_client.id
          ) updates
      )
    ),
    'summary', jsonb_build_object(
      'totalPoints', coalesce((
        select sum(coalesce(latest.balance, 0))
          from public.program_accounts pa
          left join lateral (
            select bs.balance
              from public.balance_snapshots bs
             where bs.account_id = pa.id
             order by bs.captured_at desc, bs.id desc
             limit 1
          ) latest on true
         where pa.client_id = resolved_client.id
           and pa.active
      ), 0),
      'estimatedPatrimony', coalesce((
        select sum(coalesce(latest.estimated_value, 0))
          from public.program_accounts pa
          left join lateral (
            select bs.estimated_value
              from public.balance_snapshots bs
             where bs.account_id = pa.id
             order by bs.captured_at desc, bs.id desc
             limit 1
          ) latest on true
         where pa.client_id = resolved_client.id
           and pa.active
      ), 0),
      'generatedSavings', coalesce((
        select sum(r.savings_amount)
          from public.redemptions r
         where r.client_id = resolved_client.id
           and r.status = 'confirmed'
      ), 0),
      'redemptionsCount', (
        select count(*)
          from public.redemptions r
         where r.client_id = resolved_client.id
           and r.status = 'confirmed'
      ),
      'expiringIn90Days', coalesce((
        select sum(el.remaining_points)
          from public.expiration_lots el
          join public.program_accounts pa on pa.id = el.account_id
         where pa.client_id = resolved_client.id
           and el.status = 'active'
           and el.remaining_points > 0
           and el.expires_on between current_date and current_date + 90
      ), 0)
    ),
    'programs', coalesce((
      select jsonb_agg(program_row order by program_row ->> 'name')
        from (
          select jsonb_build_object(
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
                 and el.remaining_points > 0
                 and el.expires_on between current_date and current_date + 90
            ), 0)
          ) as program_row
            from public.program_accounts pa
            join public.loyalty_programs lp on lp.id = pa.program_id
            left join lateral (
              select bs.balance, bs.average_cost_per_thousand, bs.estimated_value, bs.captured_at
                from public.balance_snapshots bs
               where bs.account_id = pa.id
               order by bs.captured_at desc, bs.id desc
               limit 1
            ) latest on true
           where pa.client_id = resolved_client.id
             and pa.active
        ) rows
    ), '[]'::jsonb),
    'balanceHistory', coalesce((
      select jsonb_agg(history_row order by history_row ->> 'month')
        from (
          select jsonb_build_object(
            'month', ranked.month,
            'balance', sum(ranked.balance),
            'averageCostPerThousand', round(
              coalesce(sum(ranked.balance * ranked.average_cost_per_thousand) / nullif(sum(ranked.balance), 0), 0),
              4
            )
          ) as history_row
            from (
              select
                date_trunc('month', bs.captured_at)::date as month,
                bs.account_id,
                bs.balance,
                bs.average_cost_per_thousand,
                row_number() over (
                  partition by bs.account_id, date_trunc('month', bs.captured_at)
                  order by bs.captured_at desc, bs.id desc
                ) as position
              from public.balance_snapshots bs
              join public.program_accounts pa on pa.id = bs.account_id
             where pa.client_id = resolved_client.id
            ) ranked
           where ranked.position = 1
           group by ranked.month
        ) rows
    ), '[]'::jsonb),
    'monthlyMovements', coalesce((
      select jsonb_agg(movement_row order by movement_row ->> 'month')
        from (
          select jsonb_build_object(
            'month', date_trunc('month', coalesce(pt.entry_date, pt.occurred_at::date))::date,
            'points', sum(pt.points_delta)
          ) as movement_row
            from public.point_transactions pt
            join public.program_accounts pa on pa.id = pt.account_id
           where pa.client_id = resolved_client.id
             and coalesce(pt.status, 'confirmed') <> 'voided'
           group by date_trunc('month', coalesce(pt.entry_date, pt.occurred_at::date))::date
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
           where cc.client_id = resolved_client.id
             and cs.status::text <> 'cancelled'
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
       order by case when mc.status = 'active' then 0 else 1 end, mc.ends_on desc, mc.created_at desc
       limit 1
    )
  );
end;
$$;

create or replace function public.get_admin_client_dashboard_preview(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  return public.build_public_client_dashboard_payload(p_client_id);
end;
$$;

create or replace function public.create_client_direct_access_link(
  p_client_id uuid,
  p_expires_at timestamptz default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash text := encode(extensions.digest(token, 'sha256'), 'hex');
  link_row public.client_direct_access_links%rowtype;
begin
  if actor_id is null or not public.can_manage_security() then
    raise exception 'Somente gestores podem gerar links.' using errcode='42501';
  end if;

  if not exists(select 1 from public.clients c where c.id=p_client_id and c.status='active') then
    raise exception 'Cliente ativo não encontrado.' using errcode='P0002';
  end if;

  update public.client_direct_access_links
     set status='revoked',
         revoked_at=clock_timestamp(),
         revoked_by=actor_id
   where client_id=p_client_id
     and status='active';

  insert into public.client_direct_access_links(client_id, token_hash, expires_at, notes, created_by)
  values(p_client_id, token_hash, p_expires_at, nullif(trim(coalesce(p_notes,'')),''), actor_id)
  returning * into link_row;

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, p_client_id, 'create_direct_access_link', 'client_direct_access_links', link_row.id::text, jsonb_build_object('expiresAt', p_expires_at, 'pathVersion', 'dashboard_direct'));

  return jsonb_build_object('linkId', link_row.id, 'token', token, 'path', '/economia/' || token, 'expiresAt', p_expires_at);
end;
$$;

revoke all on function public.build_public_client_dashboard_payload(uuid) from public, anon, authenticated;
grant execute on function public.build_public_client_dashboard_payload(uuid) to service_role;

revoke all on function public.get_admin_client_dashboard_preview(uuid) from public, anon;
grant execute on function public.get_admin_client_dashboard_preview(uuid) to authenticated;

revoke all on function public.create_client_direct_access_link(uuid, timestamptz, text) from public, anon;
grant execute on function public.create_client_direct_access_link(uuid, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
