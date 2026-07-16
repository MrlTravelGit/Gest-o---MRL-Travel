-- PATCH MRL 0.3.2
-- Remove overloads ambiguos de get_admin_clients e fixa o contrato canonico.

drop function if exists public.get_admin_clients(text, text, integer, integer);
drop function if exists public.get_admin_clients(integer, integer, text, text);
drop function if exists public.get_admin_clients(integer, integer, text);
drop function if exists public.get_admin_clients(text, integer, integer);

create or replace function public.get_admin_clients(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default '',
  p_status text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  normalized_search text := nullif(trim(coalesce(p_search, '')), '');
  normalized_status text := lower(nullif(trim(coalesce(p_status, 'all')), ''));
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  if normalized_status in ('', 'all') then
    normalized_status := null;
  end if;

  if normalized_status is not null and normalized_status not in ('lead', 'active', 'paused', 'ended') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;

  return (
    with filtered as materialized (
      select
        c.id,
        c.public_id,
        c.full_name,
        c.email::text as email,
        c.phone_e164,
        c.status,
        c.created_at,
        contract_data.contract_json,
        coalesce((
          select sum(coalesce(latest.balance, 0))
          from public.program_accounts pa
          left join lateral (
            select bs.balance
            from public.balance_snapshots bs
            where bs.account_id = pa.id
            order by bs.captured_at desc, bs.id desc
            limit 1
          ) latest on true
          where pa.client_id = c.id and pa.active
        ), 0) as total_points,
        coalesce((
          select sum(r.savings_amount)
          from public.redemptions r
          where r.client_id = c.id and r.status = 'confirmed'
        ), 0) as generated_savings,
        (select count(*) from public.program_accounts pa where pa.client_id = c.id and pa.active) as programs_count,
        (select count(*) from public.program_accounts pa where pa.client_id = c.id and pa.active and pa.club_active) as active_clubs_count,
        (
          select min(el.expires_on)
          from public.expiration_lots el
          join public.program_accounts pa on pa.id = el.account_id
          where pa.client_id = c.id
            and el.status = 'active'
            and el.remaining_points > 0
            and el.expires_on >= current_date
        ) as next_expiration_date,
        coalesce((
          select sum(el.remaining_points)
          from public.expiration_lots el
          join public.program_accounts pa on pa.id = el.account_id
          where pa.client_id = c.id
            and el.status = 'active'
            and el.remaining_points > 0
            and el.expires_on between current_date and current_date + 90
        ), 0) as expiring_points,
        (
          select max(pt.occurred_at)
          from public.point_transactions pt
          join public.program_accounts pa on pa.id = pt.account_id
          where pa.client_id = c.id
        ) as last_movement_at
      from public.clients c
      left join lateral (
        select jsonb_build_object(
          'startsOn', mc.starts_on,
          'endsOn', mc.ends_on,
          'status', mc.status,
          'planName', mc.plan_name
        ) as contract_json
        from public.management_contracts mc
        where mc.client_id = c.id
        order by case when mc.status = 'active' then 0 else 1 end, mc.created_at desc, mc.id desc
        limit 1
      ) contract_data on true
      where
        (
          normalized_search is null
          or c.full_name ilike '%' || normalized_search || '%'
          or c.email::text ilike '%' || normalized_search || '%'
          or c.phone_e164 ilike '%' || normalized_search || '%'
        )
        and (normalized_status is null or c.status::text = normalized_status)
    ), paged as (
      select *
      from filtered
      order by full_name, id
      limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'clientId', p.id,
          'publicId', p.public_id,
          'fullName', p.full_name,
          'email', p.email,
          'phone', p.phone_e164,
          'status', p.status,
          'createdAt', p.created_at,
          'contract', coalesce(p.contract_json, 'null'::jsonb),
          'pointsBalance', p.total_points,
          'totalPoints', p.total_points,
          'generatedSavings', p.generated_savings,
          'programsCount', p.programs_count,
          'activeClubsCount', p.active_clubs_count,
          'nextExpirationDate', p.next_expiration_date,
          'expiringPoints', p.expiring_points,
          'lastMovementAt', p.last_movement_at
        ) order by p.full_name, p.id)
        from paged p
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'limit', safe_limit,
      'offset', safe_offset
    )
  );
end;
$$;

revoke all on function public.get_admin_clients(integer, integer, text, text) from public, anon;
grant execute on function public.get_admin_clients(integer, integer, text, text) to authenticated;

comment on function public.get_admin_clients(integer, integer, text, text)
is 'Contrato canonico do painel admin: p_limit, p_offset, p_search, p_status.';

notify pgrst, 'reload schema';
