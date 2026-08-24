begin;

grant select on public.cashback_transactions,public.cashback_transaction_allocations to authenticated;

create or replace function public.admin_validate_patch026()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not public.has_staff_role(array['super_admin','manager']::public.app_role[]) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  return jsonb_build_object(
    'formulaVersion','paid_amount_v1',
    'incorrectActiveCashback',(select count(*) from public.redemptions r where r.status='confirmed' and r.cashback_percentage is not null and r.cashback_amount<>public.cashback_amount_for(r.effective_cost,r.cashback_percentage)),
    'voidedPublicLedgerLeaks',(select count(*) from public.cashback_transactions t join public.redemptions r on r.id=t.redemption_id where r.status in ('cancelled','voided') and t.visibility_scope='public'),
    'linkedTransactionsWithoutGroup',(select count(*) from public.cashback_transactions where redemption_id is not null and operation_group_id is null),
    'duplicateConfirmedReversals',(select count(*) from (select reversed_transaction_id from public.cashback_transactions where transaction_type='reversal' and status='confirmed' group by reversed_transaction_id having count(*)>1) d),
    'cancelledRepairPreview',public.admin_preview_voided_savings_repair(),
    'preserved',jsonb_build_object(
      'clients',(select count(*) from public.clients),
      'contracts',(select count(*) from public.contracts),
      'publicLinks',(select count(*) from public.client_direct_access_links),
      'legacySavingsRows',(select count(*) from public.iddas_savings_source_rows),
      'legacySavingsTotal',(select coalesce(sum(verified_savings_value_brl),0) from public.iddas_savings_source_rows),
      'legacyPoints',(select coalesce(sum(points),0) from public.iddas_balance_source_rows)
    )
  );
end; $$;

revoke all on function public.admin_validate_patch026() from public,anon;
grant execute on function public.admin_validate_patch026() to authenticated;

notify pgrst,'reload schema';
commit;
