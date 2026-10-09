begin;

-- PATCH 069: preserve the business meaning of negative point movements.
-- Redemptions are successful usage; only actual expirations are an alert/loss.
create or replace function public.build_public_client_points_movement_payload(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with monthly as (
    select
      date_trunc('month', coalesce(pt.entry_date, pt.occurred_at::date))::date as month,
      coalesce(sum(abs(pt.points_delta)) filter (
        where pt.transaction_type in ('credit', 'bonus', 'transfer_in')
      ), 0) as points_in,
      coalesce(sum(abs(pt.points_delta)) filter (
        where pt.transaction_type = 'redemption'
      ), 0) as points_redeemed,
      coalesce(sum(abs(pt.points_delta)) filter (
        where pt.transaction_type = 'expiration'
      ), 0) as points_expired,
      coalesce(sum(pt.points_delta) filter (
        where pt.transaction_type in ('adjustment', 'transfer_out')
      ), 0) as points_adjustment,
      coalesce(sum(pt.points_delta), 0) as net_points
    from public.point_transactions pt
    join public.program_accounts pa on pa.id = pt.account_id
    where pa.client_id = p_client_id
      and coalesce(pt.status, 'confirmed') <> 'voided'
    group by date_trunc('month', coalesce(pt.entry_date, pt.occurred_at::date))::date
  )
  select jsonb_build_object(
    'monthlyMovements',
    coalesce(jsonb_agg(jsonb_build_object(
      'month', month,
      'pointsIn', points_in,
      'pointsRedeemed', points_redeemed,
      'pointsExpired', points_expired,
      'pointsAdjustment', points_adjustment,
      'netPoints', net_points
    ) order by month), '[]'::jsonb)
  )
  from monthly;
$$;

do $$
begin
  if to_regprocedure('public.build_public_client_dashboard_payload_pre_points_categories(uuid)') is null then
    alter function public.build_public_client_dashboard_payload(uuid)
      rename to build_public_client_dashboard_payload_pre_points_categories;
  end if;
end
$$;

create or replace function public.build_public_client_dashboard_payload(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.build_public_client_dashboard_payload_pre_points_categories(p_client_id)
    || public.build_public_client_points_movement_payload(p_client_id);
$$;

revoke all on function public.build_public_client_points_movement_payload(uuid) from public, anon, authenticated;
revoke all on function public.build_public_client_dashboard_payload_pre_points_categories(uuid) from public, anon, authenticated;
revoke all on function public.build_public_client_dashboard_payload(uuid) from public, anon, authenticated;
grant execute on function public.build_public_client_points_movement_payload(uuid) to service_role;
grant execute on function public.build_public_client_dashboard_payload_pre_points_categories(uuid) to service_role;
grant execute on function public.build_public_client_dashboard_payload(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
