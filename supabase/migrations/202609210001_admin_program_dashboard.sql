begin;

-- PATCH 059: consolidated, read-only view of the same program wallet used by
-- the individual admin client panel. No balance is stored or recalculated here.
create or replace function public.admin_program_dashboard()
returns table (
  program_key text,
  program_name text,
  program_logo_url text,
  clients_count integer,
  total_points numeric,
  total_estimated_value numeric,
  clients jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.require_client_admin();

  return query
  with visible_accounts as (
    select
      lp.slug as program_key,
      lp.name as program_name,
      coalesce(lp.logo_path, lp.logo_url) as program_logo_url,
      pa.client_id,
      c.full_name as client_name,
      coalesce(latest.balance, movements.current_balance, 0)::numeric as current_points,
      coalesce(latest.average_cost_per_thousand, 0)::numeric as cost_per_thousand,
      coalesce(latest.estimated_value, 0)::numeric as estimated_value,
      expiration.next_expiration_date,
      coalesce(expiration.points_expiring_90_days, 0)::numeric as points_expiring_90_days,
      latest.captured_at as last_updated_at,
      (
        coalesce(pa.club_active, false)
        or coalesce(club.subscription_active, false)
        or club.future_date >= current_date
      ) as club_active,
      nullif(btrim(pa.membership_number_masked), '') is not null as account_linked
    from public.program_accounts pa
    join public.loyalty_programs lp on lp.id = pa.program_id
    join public.clients c on c.id = pa.client_id
    left join lateral (
      select bs.balance, bs.average_cost_per_thousand, bs.estimated_value, bs.captured_at
      from public.balance_snapshots bs
      where bs.account_id = pa.id
      order by bs.captured_at desc, bs.id desc
      limit 1
    ) latest on true
    left join lateral (
      select
        coalesce(sum(pt.points_delta) filter (
          where coalesce(pt.status, 'confirmed') <> 'voided'
        ), 0) as current_balance
      from public.point_transactions pt
      where pt.account_id = pa.id
    ) movements on true
    left join lateral (
      select
        bool_or(s.status = 'active') as subscription_active,
        greatest(
          max(s.ends_on) filter (where s.ends_on >= current_date),
          max((s.next_competence + (s.expected_credit_day - 1)::integer)::date)
            filter (
              where s.status in ('active', 'paused')
                and (s.next_competence + (s.expected_credit_day - 1)::integer)::date >= current_date
            )
        ) as future_date
      from public.client_club_subscriptions s
      where s.account_id = pa.id
    ) club on true
    left join lateral (
      select
        min(el.expires_on) filter (
          where el.expires_on >= current_date
        ) as next_expiration_date,
        coalesce(sum(el.remaining_points) filter (
          where el.expires_on between current_date and current_date + 90
        ), 0) as points_expiring_90_days
      from public.expiration_lots el
      where el.account_id = pa.id
        and el.status = 'active'
        and el.remaining_points > 0
    ) expiration on true
    where pa.active
      and lp.active
      and c.status <> 'ended'::public.client_status
      and (
        coalesce(latest.balance, movements.current_balance, 0) > 0
        or coalesce(pa.club_active, false)
        or coalesce(club.subscription_active, false)
        or club.future_date >= current_date
        or nullif(btrim(pa.membership_number_masked), '') is not null
      )
  )
  select
    va.program_key,
    max(va.program_name)::text as program_name,
    max(va.program_logo_url)::text as program_logo_url,
    count(distinct va.client_id)::integer as clients_count,
    coalesce(sum(va.current_points), 0)::numeric as total_points,
    coalesce(sum(va.estimated_value), 0)::numeric as total_estimated_value,
    jsonb_agg(
      jsonb_build_object(
        'clientId', va.client_id,
        'clientName', va.client_name,
        'points', va.current_points,
        'costPerThousand', va.cost_per_thousand,
        'estimatedValue', va.estimated_value,
        'nextExpirationDate', va.next_expiration_date,
        'pointsExpiring90Days', va.points_expiring_90_days,
        'lastUpdatedAt', va.last_updated_at,
        'clubActive', va.club_active,
        'accountLinked', va.account_linked
      )
      order by va.current_points desc, va.client_name asc
    ) as clients
  from visible_accounts va
  group by va.program_key
  order by 5 desc, 2 asc;
end;
$$;

revoke all on function public.admin_program_dashboard() from public, anon;
grant execute on function public.admin_program_dashboard() to authenticated;

notify pgrst, 'reload schema';
commit;
