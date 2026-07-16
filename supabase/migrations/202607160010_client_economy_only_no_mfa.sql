-- PATCH MRL 0.4.0 follow-up
-- Acesso do cliente restrito à página de economia e remoção do fluxo visual legado.

create or replace function public.build_client_economy_payload(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return jsonb_build_object(
    'client', (
      select jsonb_build_object(
        'id', c.id,
        'fullName', c.full_name,
        'lastUpdatedAt', (
          select max(r.created_at)
          from public.redemptions r
          where r.client_id = c.id
            and r.status = 'confirmed'
        )
      )
      from public.clients c
      where c.id = p_client_id
    ),
    'summary', jsonb_build_object(
      'generatedSavings', coalesce((
        select sum(r.savings_amount)
        from public.redemptions r
        where r.client_id = p_client_id
          and r.status = 'confirmed'
      ), 0),
      'redemptionsCount', (
        select count(*)
        from public.redemptions r
        where r.client_id = p_client_id
          and r.status = 'confirmed'
      ),
      'positiveSavingsCount', (
        select count(*)
        from public.redemptions r
        where r.client_id = p_client_id
          and r.status = 'confirmed'
          and r.savings_amount > 0
      )
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'issuedAt', r.issued_at,
        'launchedOn', r.launched_on,
        'travelType', r.redemption_type,
        'paymentMode', r.payment_mode,
        'details', r.description,
        'originalValue', r.cash_reference_total,
        'paidValue', r.effective_cost,
        'savingsAmount', r.savings_amount,
        'programName', lp.name,
        'pointsUsed', r.travel_points_used
      ) order by coalesce(r.launched_on, r.issued_at::date) desc, r.created_at desc)
      from public.redemptions r
      left join public.program_accounts pa on pa.id = r.travel_account_id
      left join public.loyalty_programs lp on lp.id = pa.program_id
      where r.client_id = p_client_id
        and r.status = 'confirmed'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_my_client_economy()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  target_client_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  select c.id into target_client_id
  from public.client_users cu
  join public.clients c on c.id = cu.client_id
  where cu.user_id = auth.uid()
    and cu.active
    and c.status = 'active'
    and exists (
      select 1
      from public.management_contracts mc
      where mc.client_id = c.id
        and mc.status = 'active'
        and mc.starts_on <= current_date
        and mc.ends_on >= current_date
    )
  order by cu.created_at desc
  limit 1;

  if target_client_id is null then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  return public.build_client_economy_payload(target_client_id);
end;
$$;

create or replace function public.get_admin_client_economy_preview(p_client_id uuid)
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

  if not exists(select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'Cliente não encontrado' using errcode = '22023';
  end if;

  return public.build_client_economy_payload(p_client_id);
end;
$$;

revoke all on function public.build_client_economy_payload(uuid) from public, anon, authenticated;
revoke all on function public.get_my_client_economy() from public, anon;
revoke all on function public.get_admin_client_economy_preview(uuid) from public, anon;

grant execute on function public.get_my_client_economy() to authenticated;
grant execute on function public.get_admin_client_economy_preview(uuid) to authenticated;

-- O frontend novo não usa mais o dashboard por public_id. A página antiga de nome/código
-- foi removida; esta revogação impede reuso acidental do contrato legado por clientes.
revoke all on function public.get_client_dashboard(uuid) from public, anon, authenticated;
revoke all on function public.get_my_client_dashboard() from public, anon, authenticated;

notify pgrst, 'reload schema';
