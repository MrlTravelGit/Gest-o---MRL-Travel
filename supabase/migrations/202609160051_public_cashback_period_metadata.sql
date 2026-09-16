begin;

create or replace function public.build_public_client_cashback(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with client_row as (
    select c.id,c.cashback_enabled from public.clients c where c.id=p_client_id and c.status='active'
  ), public_entries as (
    select r.id,'earning'::text type,r.cashback_amount amount,
      'Cashback da reserva: '||r.description description,r.id redemption_id,null::text redemption_mode,r.created_at
    from public.redemptions r join client_row c on c.id=r.client_id
    where r.status='confirmed' and r.deleted_at is null and r.cashback_amount>0
      and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
        r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),
        r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount))
    union all
    select t.id,t.transaction_type,t.amount,t.description,null::uuid,t.redemption_mode,t.created_at
    from public.cashback_transactions t join client_row c on c.id=t.client_id
    where t.status='confirmed' and t.redemption_id is null and t.visibility_scope='public'
  ) select jsonb_build_object(
    'enabled',coalesce((select cashback_enabled from client_row),false),
    'summary',public.cashback_snapshot(p_client_id),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'type',e.type,'amount',e.amount,'description',e.description,
      'redemptionId',e.redemption_id,'redemptionMode',e.redemption_mode,'createdAt',e.created_at
    ) order by e.created_at desc,e.id desc) from public_entries e),'[]'::jsonb)
  );
$$;

revoke all on function public.build_public_client_cashback(uuid) from public,anon,authenticated;
grant execute on function public.build_public_client_cashback(uuid) to service_role;

notify pgrst,'reload schema';
commit;
