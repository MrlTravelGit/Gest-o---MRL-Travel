begin;

-- PATCH 037: keep the active catalog complete for forms, while exposing a
-- separate client wallet containing only programs with a real relationship.
create or replace function public.build_client_program_wallet(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug',lp.slug,
    'name',lp.name,
    'logoUrl',coalesce(lp.logo_path,lp.logo_url),
    'balance',coalesce(latest.balance,movements.current_balance,0),
    'averageCostPerThousand',coalesce(latest.average_cost_per_thousand,0),
    'estimatedValue',coalesce(latest.estimated_value,0),
    'capturedAt',latest.captured_at,
    'expiringPoints',coalesce((select sum(el.remaining_points) from public.expiration_lots el
      where el.account_id=pa.id and el.status='active' and el.remaining_points>0
        and el.expires_on between current_date and current_date+90),0),
    'catalogActive',lp.active,
    'hasMovements',coalesce(movements.movement_count,0)>0,
    'clubActive',coalesce(pa.club_active,false) or coalesce(club.subscription_active,false),
    'clubExpiresAt',club.future_date,
    'linkedAccount',nullif(btrim(pa.membership_number_masked),'') is not null,
    'accountStatus',case when nullif(btrim(pa.membership_number_masked),'') is not null then 'linked' end
  ) order by lp.name),'[]'::jsonb)
  from public.loyalty_programs lp
  join public.program_accounts pa
    on pa.program_id=lp.id and pa.client_id=p_client_id and pa.active
  left join lateral(
    select bs.balance,bs.average_cost_per_thousand,bs.estimated_value,bs.captured_at
    from public.balance_snapshots bs where bs.account_id=pa.id
    order by bs.captured_at desc,bs.id desc limit 1
  ) latest on true
  left join lateral(
    select
      coalesce(sum(pt.points_delta) filter(where coalesce(pt.status,'confirmed')<>'voided'),0) as current_balance,
      count(*) filter(where coalesce(pt.status,'confirmed')<>'voided') as movement_count
    from public.point_transactions pt where pt.account_id=pa.id
  ) movements on true
  left join lateral(
    select
      bool_or(s.status='active') as subscription_active,
      greatest(
        max(s.ends_on) filter(where s.ends_on>=current_date),
        max((s.next_competence+(s.expected_credit_day-1)::integer)::date)
          filter(where s.status in ('active','paused')
            and (s.next_competence+(s.expected_credit_day-1)::integer)::date>=current_date)
      ) as future_date
    from public.client_club_subscriptions s where s.account_id=pa.id
  ) club on true
  where lp.active and (
    coalesce(latest.balance,movements.current_balance,0)>0
    or coalesce(pa.club_active,false)
    or coalesce(club.subscription_active,false)
    or club.future_date>=current_date
    or nullif(btrim(pa.membership_number_masked),'') is not null
  );
$$;

create or replace function public.build_admin_client_program_wallet(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'programId',lp.id,
    'slug',lp.slug,
    'name',lp.name,
    'logoUrl',coalesce(lp.logo_path,lp.logo_url),
    'accountId',pa.id,
    'balance',coalesce(latest.balance,movements.current_balance,0),
    'averageCostPerThousand',coalesce(latest.average_cost_per_thousand,0),
    'estimatedValue',coalesce(latest.estimated_value,0),
    'marketValuePerThousand',lp.default_value_per_thousand,
    'clubActive',coalesce(pa.club_active,false) or coalesce(club.subscription_active,false),
    'clubUpdatedAt',pa.club_updated_at,
    'clubExpiresAt',club.future_date,
    'linkedAccount',nullif(btrim(pa.membership_number_masked),'') is not null,
    'accountStatus',case when nullif(btrim(pa.membership_number_masked),'') is not null then 'linked' end,
    'hasMovements',coalesce(movements.movement_count,0)>0,
    'expiringPoints',coalesce((select sum(el.remaining_points) from public.expiration_lots el
      where el.account_id=pa.id and el.status='active' and el.remaining_points>0
        and el.expires_on between current_date and current_date+90),0),
    'nextExpirationDate',(select min(el.expires_on) from public.expiration_lots el
      where el.account_id=pa.id and el.status='active' and el.remaining_points>0 and el.expires_on>=current_date),
    'lastUpdatedAt',latest.captured_at
  ) order by lp.name),'[]'::jsonb)
  from public.loyalty_programs lp
  join public.program_accounts pa
    on pa.program_id=lp.id and pa.client_id=p_client_id and pa.active
  left join lateral(
    select bs.balance,bs.average_cost_per_thousand,bs.estimated_value,bs.captured_at
    from public.balance_snapshots bs where bs.account_id=pa.id
    order by bs.captured_at desc,bs.id desc limit 1
  ) latest on true
  left join lateral(
    select
      coalesce(sum(pt.points_delta) filter(where coalesce(pt.status,'confirmed')<>'voided'),0) as current_balance,
      count(*) filter(where coalesce(pt.status,'confirmed')<>'voided') as movement_count
    from public.point_transactions pt where pt.account_id=pa.id
  ) movements on true
  left join lateral(
    select
      bool_or(s.status='active') as subscription_active,
      greatest(
        max(s.ends_on) filter(where s.ends_on>=current_date),
        max((s.next_competence+(s.expected_credit_day-1)::integer)::date)
          filter(where s.status in ('active','paused')
            and (s.next_competence+(s.expected_credit_day-1)::integer)::date>=current_date)
      ) as future_date
    from public.client_club_subscriptions s where s.account_id=pa.id
  ) club on true
  where lp.active and (
    coalesce(latest.balance,movements.current_balance,0)>0
    or coalesce(pa.club_active,false)
    or coalesce(club.subscription_active,false)
    or club.future_date>=current_date
    or nullif(btrim(pa.membership_number_masked),'') is not null
  );
$$;

-- The original `programs` property remains the complete active catalog used by
-- launch/expiration forms. `walletPrograms` is the filtered display-only list.
do $$
begin
  if to_regprocedure('public.get_admin_client_points_detail_catalog_legacy(uuid)') is null then
    alter function public.get_admin_client_points_detail(uuid)
      rename to get_admin_client_points_detail_catalog_legacy;
  end if;
end $$;

create or replace function public.get_admin_client_points_detail(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select public.get_admin_client_points_detail_catalog_legacy(p_client_id)
    || jsonb_build_object('walletPrograms',public.build_admin_client_program_wallet(p_client_id));
$$;

-- Replace the temporary all-active public wallet introduced by migration 044.
create or replace function public.build_active_program_wallet(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select public.build_client_program_wallet(p_client_id);
$$;

revoke all on function public.build_client_program_wallet(uuid) from public,anon,authenticated;
revoke all on function public.build_admin_client_program_wallet(uuid) from public,anon,authenticated;
revoke all on function public.get_admin_client_points_detail_catalog_legacy(uuid) from public,anon,authenticated;
revoke all on function public.get_admin_client_points_detail(uuid) from public,anon;
grant execute on function public.get_admin_client_points_detail(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
