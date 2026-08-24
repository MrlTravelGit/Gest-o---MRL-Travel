begin;

-- PATCH MRL 20260723-024: cashback calculado exclusivamente sobre o valor pago.
alter table public.redemptions
  add column if not exists cashback_base_type text,
  add column if not exists cashback_base_amount numeric(14,2);

alter table public.redemptions drop constraint if exists redemptions_cashback_base_type_valid;
alter table public.redemptions drop constraint if exists redemptions_cashback_base_amount_valid;
alter table public.redemptions drop constraint if exists redemptions_cashback_paid_amount_version_valid;
alter table public.redemptions add constraint redemptions_cashback_base_type_valid
  check (cashback_base_type is null or cashback_base_type='paid_amount');
alter table public.redemptions add constraint redemptions_cashback_base_amount_valid
  check (cashback_base_amount is null or cashback_base_amount>=0);
alter table public.redemptions add constraint redemptions_cashback_paid_amount_version_valid
  check (
    cashback_calculation_version is distinct from 'paid_amount_v1'
    or (cashback_base_type='paid_amount' and cashback_base_amount is not null)
  );

create table public.cashback_formula_reconciliations (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references public.redemptions(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  external_key text not null unique,
  previous_calculation_version text not null,
  new_calculation_version text not null default 'paid_amount_v1',
  previous_base_amount numeric(14,2) not null,
  new_base_amount numeric(14,2) not null,
  cashback_percentage numeric(5,2) not null,
  previous_cashback_amount numeric(14,2) not null,
  correct_cashback_amount numeric(14,2) not null,
  difference_amount numeric(14,2) not null,
  allocated_amount numeric(14,2) not null default 0,
  available_before numeric(14,2) not null,
  action text not null,
  status text not null,
  review_reason text,
  old_earning_transaction_id uuid references public.cashback_transactions(id) on delete restrict,
  reversal_transaction_id uuid references public.cashback_transactions(id) on delete restrict,
  new_earning_transaction_id uuid references public.cashback_transactions(id) on delete restrict,
  adjustment_transaction_id uuid references public.cashback_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint cashback_formula_reconciliation_action_valid check (action in ('replace','adjustment','review')),
  constraint cashback_formula_reconciliation_status_valid check (status in ('applied','review')),
  constraint cashback_formula_reconciliation_amounts_valid check (
    previous_base_amount>=0 and new_base_amount>=0 and previous_cashback_amount>0
    and correct_cashback_amount>=0 and allocated_amount>=0 and cashback_percentage>0 and cashback_percentage<=100
  ),
  constraint cashback_formula_reconciliation_metadata_object check (jsonb_typeof(metadata)='object')
);
create unique index cashback_formula_reconciliations_redemption_version_idx
  on public.cashback_formula_reconciliations(redemption_id,new_calculation_version);
create index cashback_formula_reconciliations_status_idx
  on public.cashback_formula_reconciliations(status,created_at);

alter table public.cashback_formula_reconciliations enable row level security;
alter table public.cashback_formula_reconciliations force row level security;
create policy cashback_formula_reconciliations_staff_read
  on public.cashback_formula_reconciliations for select to authenticated using (public.is_staff());
revoke insert,update,delete on public.cashback_formula_reconciliations from authenticated;
grant all on public.cashback_formula_reconciliations to service_role;

drop function if exists public.cashback_amount_for(numeric,numeric);
create function public.cashback_amount_for(p_paid_amount numeric,p_percentage numeric)
returns numeric language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_paid_amount is null or p_paid_amount<0 then
    raise exception 'INVALID_PAID_AMOUNT' using errcode='22003';
  end if;
  if p_percentage is null or p_paid_amount=0 then return 0::numeric(14,2); end if;
  if p_percentage<=0 or p_percentage>100 then
    raise exception 'INVALID_CASHBACK_PERCENTAGE' using errcode='22023';
  end if;
  return round(p_paid_amount*p_percentage/100,2)::numeric(14,2);
end; $$;
comment on function public.cashback_amount_for(numeric,numeric) is
  'PATCH 024: decimal exato, base valor pago e arredondamento monetario apenas no resultado final.';

create or replace function public.record_travel_sale(
  p_client_id uuid,p_launched_on date,p_payment_mode text,p_travel_type public.redemption_type,p_details text,
  p_original_value numeric,p_paid_value numeric,p_account_id uuid default null,p_points_used bigint default null,
  p_operation_id uuid default gen_random_uuid(),p_cashback_percentage numeric default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); client_row public.clients%rowtype; account_row public.program_accounts%rowtype; current_balance bigint:=0; current_average numeric(14,4):=0; new_balance bigint; program_value numeric(14,4):=0; saving public.redemptions%rowtype; point_tx public.point_transactions%rowtype; existing public.redemptions%rowtype; effective_percentage numeric(5,2); canonical_paid numeric(14,2); calculated_cashback numeric(14,2); earning_id uuid;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_launched_on is null or p_launched_on>current_date then raise exception 'INVALID_DATE' using errcode='22007'; end if;
  if p_payment_mode not in ('cash','miles') then raise exception 'INVALID_PAYMENT_MODE' using errcode='22023'; end if;
  if char_length(trim(coalesce(p_details,'')))<3 then raise exception 'DETAILS_REQUIRED' using errcode='22023'; end if;
  if p_original_value is null or p_original_value<0 or p_paid_value is null or p_paid_value<0 then raise exception 'INVALID_VALUES' using errcode='22003'; end if;
  canonical_paid:=round(p_paid_value,2);
  select * into client_row from public.clients where id=p_client_id and status='active' for update;
  if client_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  effective_percentage:=case when client_row.cashback_enabled then p_cashback_percentage else null end;
  if effective_percentage is not null and (effective_percentage<=0 or effective_percentage>100) then raise exception 'INVALID_CASHBACK_PERCENTAGE' using errcode='22023'; end if;
  calculated_cashback:=public.cashback_amount_for(canonical_paid,effective_percentage);
  select * into existing from public.redemptions where operation_id=p_operation_id;
  if existing.id is not null then
    if existing.client_id<>p_client_id or existing.launched_on<>p_launched_on or existing.payment_mode<>p_payment_mode or existing.cash_reference_total<>round(p_original_value,2) or existing.effective_cost<>canonical_paid or existing.travel_account_id is distinct from p_account_id or existing.travel_points_used is distinct from p_points_used or existing.cashback_percentage is distinct from effective_percentage then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    select id into earning_id from public.cashback_transactions where redemption_id=existing.id and transaction_type='earning' order by created_at desc limit 1;
    return jsonb_build_object('saleId',existing.id,'savingsAmount',existing.savings_amount,'cashbackPercentage',existing.cashback_percentage,'cashbackBaseType',existing.cashback_base_type,'cashbackBaseAmount',existing.cashback_base_amount,'cashbackCalculationVersion',existing.cashback_calculation_version,'cashbackAmount',existing.cashback_amount,'cashbackTransactionId',earning_id,'idempotentReplay',true);
  end if;
  if p_payment_mode='cash' and (p_account_id is not null or p_points_used is not null) then raise exception 'CASH_WITH_POINTS' using errcode='22023'; end if;
  if p_payment_mode='miles' then
    if p_account_id is null or p_points_used is null or p_points_used<=0 then raise exception 'POINTS_REQUIRED' using errcode='22023'; end if;
    select * into account_row from public.program_accounts where id=p_account_id and client_id=p_client_id and active for update;
    if account_row.id is null then raise exception 'ACCOUNT_NOT_FOUND' using errcode='42501'; end if;
    select coalesce(bs.balance,0),coalesce(bs.average_cost_per_thousand,0) into current_balance,current_average from public.balance_snapshots bs where bs.account_id=account_row.id order by bs.captured_at desc,bs.id desc limit 1;
    if not found then current_balance:=0;current_average:=0;end if;
    if p_points_used>current_balance then raise exception 'INSUFFICIENT_POINTS' using errcode='23514'; end if;
    new_balance:=current_balance-p_points_used;select lp.default_value_per_thousand into program_value from public.loyalty_programs lp where lp.id=account_row.program_id;
  end if;
  insert into public.redemptions(client_id,redemption_type,description,issued_at,cash_reference_total,taxes_paid,additional_cash_paid,attributed_points_cost,formula_version,reference_captured_at,status,created_by,payment_mode,launched_on,operation_id,travel_account_id,travel_points_used,cashback_percentage,cashback_amount,cashback_calculation_version,cashback_calculated_at,cashback_base_type,cashback_base_amount)
  values(p_client_id,p_travel_type,trim(p_details),(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo',round(p_original_value,2),0,canonical_paid,0,'2.1.0',clock_timestamp(),'confirmed',actor,p_payment_mode,p_launched_on,p_operation_id,p_account_id,p_points_used,effective_percentage,calculated_cashback,case when effective_percentage is null then null else 'paid_amount_v1' end,case when effective_percentage is null then null else clock_timestamp() end,case when effective_percentage is null then null else 'paid_amount' end,case when effective_percentage is null then null else canonical_paid end) returning * into saving;
  if calculated_cashback>0 then
    insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,metadata)
    values(p_client_id,saving.id,'earning',calculated_cashback,'confirmed','Cashback sobre o valor pago: '||trim(p_details),'cashback:earning:'||saving.id||':paid_amount_v1',p_operation_id,actor,jsonb_build_object('percentage',effective_percentage,'baseType','paid_amount','baseAmount',canonical_paid,'calculationVersion','paid_amount_v1')) returning id into earning_id;
  end if;
  if p_payment_mode='miles' then
    insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,source,metadata,created_by,entry_date,operation_id) values(account_row.id,(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo','redemption',-p_points_used,'Uso de pontos em viagem: '||trim(p_details),'travel_sale',jsonb_build_object('redemptionId',saving.id),actor,p_launched_on,p_operation_id) returning * into point_tx;
    insert into public.redemption_point_usages(redemption_id,account_id,points_used,value_per_thousand) values(saving.id,account_row.id,p_points_used,current_average);
    perform public.consume_expiration_lots(account_row.id,p_points_used);
    insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,notes,created_by) values(account_row.id,clock_timestamp(),new_balance,current_average,program_value,'travel_sale','Baixa atomica vinculada a viagem',actor);
  end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(actor,p_client_id,'record_travel_sale','redemptions',saving.id::text,jsonb_build_object('savingsAmount',saving.savings_amount,'cashbackPercentage',effective_percentage,'cashbackBaseType','paid_amount','cashbackBaseAmount',canonical_paid,'cashbackCalculationVersion','paid_amount_v1','cashbackAmount',calculated_cashback,'cashbackTransactionId',earning_id));
  return jsonb_build_object('saleId',saving.id,'savingsAmount',saving.savings_amount,'cashbackPercentage',effective_percentage,'cashbackBaseType',case when effective_percentage is null then null else 'paid_amount' end,'cashbackBaseAmount',case when effective_percentage is null then null else canonical_paid end,'cashbackCalculationVersion',case when effective_percentage is null then null else 'paid_amount_v1' end,'cashbackAmount',calculated_cashback,'cashbackTransactionId',earning_id,'newBalance',case when p_payment_mode='miles' then new_balance else null end,'idempotentReplay',false);
end; $$;

create or replace function public.admin_update_travel_saving(
  p_redemption_id uuid,p_launched_on date,p_travel_type public.redemption_type,p_details text,
  p_original_value numeric,p_paid_value numeric,p_cashback_percentage numeric,p_reason text,p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); before_row public.redemptions%rowtype; after_row public.redemptions%rowtype; client_row public.clients%rowtype; old_earning public.cashback_transactions%rowtype; cashback_changed boolean; effective_percentage numeric(5,2); canonical_paid numeric(14,2); new_cashback numeric(14,2); sequence_no integer; reversal_id uuid; new_earning_id uuid; allocated numeric;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if p_launched_on is null or p_launched_on>current_date then raise exception 'INVALID_DATE' using errcode='22007';end if;
  if length(trim(coalesce(p_details,'')))<3 then raise exception 'DETAILS_REQUIRED' using errcode='22023';end if;
  if p_original_value is null or p_original_value<0 or p_paid_value is null or p_paid_value<0 then raise exception 'INVALID_VALUES' using errcode='22003';end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'CHANGE_REASON_REQUIRED' using errcode='22023';end if;
  canonical_paid:=round(p_paid_value,2);
  select * into before_row from public.redemptions where id=p_redemption_id for update;
  if before_row.id is null or before_row.payment_mode<>'cash' or before_row.travel_points_used is not null or before_row.status<>'confirmed' then raise exception 'SAVING_NOT_FOUND' using errcode='P0002';end if;
  if p_expected_updated_at is not null and before_row.updated_at<>p_expected_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001';end if;
  select * into client_row from public.clients where id=before_row.client_id for update;
  effective_percentage:=case when client_row.cashback_enabled then p_cashback_percentage else null end;
  if effective_percentage is not null and (effective_percentage<=0 or effective_percentage>100) then raise exception 'INVALID_CASHBACK_PERCENTAGE' using errcode='22023';end if;
  new_cashback:=public.cashback_amount_for(canonical_paid,effective_percentage);
  cashback_changed:=before_row.effective_cost<>canonical_paid or before_row.cashback_percentage is distinct from effective_percentage;
  if cashback_changed then
    select e.* into old_earning from public.cashback_transactions e where e.redemption_id=before_row.id and e.transaction_type='earning' and e.status='confirmed' and not exists(select 1 from public.cashback_transactions rv where rv.transaction_type='reversal' and rv.reversed_transaction_id=e.id and rv.status='confirmed') order by e.created_at desc,e.id desc limit 1 for update;
    if old_earning.id is not null then
      select coalesce(sum(a.amount),0) into allocated from public.cashback_transaction_allocations a where a.earning_transaction_id=old_earning.id;
      if allocated>0 then raise exception 'CASHBACK_ALREADY_USED' using errcode='55000';end if;
      insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,reversed_transaction_id,metadata)
      values(before_row.client_id,before_row.id,'reversal',old_earning.amount,'confirmed','Estorno para correcao da economia','cashback:reversal:'||old_earning.id,public.cashback_deterministic_uuid('reversal:'||old_earning.id),actor,old_earning.id,jsonb_build_object('reason',trim(p_reason),'newCalculationVersion','paid_amount_v1')) returning id into reversal_id;
    end if;
  end if;
  update public.redemptions set redemption_type=p_travel_type,description=trim(p_details),issued_at=(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo',launched_on=p_launched_on,
    cash_reference_total=round(p_original_value,2),taxes_paid=0,additional_cash_paid=canonical_paid,attributed_points_cost=0,reference_captured_at=(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo',
    cashback_percentage=case when cashback_changed then effective_percentage else cashback_percentage end,
    cashback_amount=case when cashback_changed then new_cashback else cashback_amount end,
    cashback_calculation_version=case when cashback_changed and effective_percentage is not null then 'paid_amount_v1' when cashback_changed then null else cashback_calculation_version end,
    cashback_calculated_at=case when cashback_changed and effective_percentage is not null then clock_timestamp() when cashback_changed then null else cashback_calculated_at end,
    cashback_base_type=case when cashback_changed and effective_percentage is not null then 'paid_amount' when cashback_changed then null else cashback_base_type end,
    cashback_base_amount=case when cashback_changed and effective_percentage is not null then canonical_paid when cashback_changed then null else cashback_base_amount end,
    updated_at=clock_timestamp()
  where id=p_redemption_id returning * into after_row;
  if cashback_changed and new_cashback>0 then
    select count(*)+1 into sequence_no from public.cashback_transactions where redemption_id=after_row.id and transaction_type='earning';
    insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,metadata)
    values(after_row.client_id,after_row.id,'earning',new_cashback,'confirmed','Cashback sobre o valor pago corrigido: '||after_row.description,'cashback:earning:'||after_row.id||':paid_amount_v1:'||sequence_no,public.cashback_deterministic_uuid('earning:'||after_row.id||':paid_amount_v1:'||sequence_no),actor,jsonb_build_object('percentage',effective_percentage,'baseType','paid_amount','baseAmount',canonical_paid,'calculationVersion','paid_amount_v1','reason',trim(p_reason),'correctionSequence',sequence_no)) returning id into new_earning_id;
  end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data) values(actor,after_row.client_id,'update_travel_saving','redemptions',after_row.id::text,
    jsonb_build_object('launchedOn',before_row.launched_on,'travelType',before_row.redemption_type,'details',before_row.description,'originalValue',before_row.cash_reference_total,'paidValue',before_row.effective_cost,'savingsValue',before_row.savings_amount,'cashbackPercentage',before_row.cashback_percentage,'cashbackBaseType',before_row.cashback_base_type,'cashbackBaseAmount',before_row.cashback_base_amount,'cashbackCalculationVersion',before_row.cashback_calculation_version,'cashbackAmount',before_row.cashback_amount),
    jsonb_build_object('launchedOn',after_row.launched_on,'travelType',after_row.redemption_type,'details',after_row.description,'originalValue',after_row.cash_reference_total,'paidValue',after_row.effective_cost,'savingsValue',after_row.savings_amount,'cashbackPercentage',after_row.cashback_percentage,'cashbackBaseType',after_row.cashback_base_type,'cashbackBaseAmount',after_row.cashback_base_amount,'cashbackCalculationVersion',after_row.cashback_calculation_version,'cashbackAmount',after_row.cashback_amount,'reason',trim(p_reason),'reversalTransactionId',reversal_id,'newEarningTransactionId',new_earning_id,'sourceMetadataPreserved',before_row.source_external_key is not null));
  return jsonb_build_object('redemptionId',after_row.id,'savingsAmount',after_row.savings_amount,'cashbackPercentage',after_row.cashback_percentage,'cashbackBaseType',after_row.cashback_base_type,'cashbackBaseAmount',after_row.cashback_base_amount,'cashbackCalculationVersion',after_row.cashback_calculation_version,'cashbackAmount',after_row.cashback_amount,'reversalTransactionId',reversal_id,'newEarningTransactionId',new_earning_id,'updatedAt',after_row.updated_at);
end; $$;

create or replace function public.cashback_paid_amount_reconciliation_candidates()
returns table(
  redemption_id uuid,client_id uuid,client_name text,description text,original_amount numeric,paid_amount numeric,
  savings_amount numeric,cashback_percentage numeric,old_earning_id uuid,old_cashback_amount numeric,
  correct_cashback_amount numeric,difference_amount numeric,allocated_amount numeric,available_amount numeric,
  active_earnings integer,recommended_action text,review_reason text,external_key text
)
language sql stable security definer set search_path=pg_catalog,public as $$
  with candidates as (
    select r.id redemption_id,r.client_id,c.full_name client_name,r.description,r.cash_reference_total original_amount,
      r.effective_cost paid_amount,r.savings_amount,r.cashback_percentage,
      old.id old_earning_id,old.amount old_cashback_amount,
      public.cashback_amount_for(r.effective_cost,r.cashback_percentage) correct_cashback_amount,
      coalesce(alloc.allocated_amount,0)::numeric allocated_amount,
      (public.cashback_snapshot(r.client_id)->>'available')::numeric available_amount,
      coalesce(old.active_earnings,0)::integer active_earnings,
      'cashback_formula_reconciliation_paid_amount_v1:'||r.id external_key
    from public.redemptions r
    join public.clients c on c.id=r.client_id
    left join lateral (
      select e.id,e.amount,count(*) over() active_earnings
      from public.cashback_transactions e
      where e.redemption_id=r.id and e.transaction_type='earning' and e.status='confirmed'
        and e.metadata->>'calculationVersion'='cashback-1.0.0'
        and not exists(select 1 from public.cashback_transactions rv where rv.transaction_type='reversal' and rv.reversed_transaction_id=e.id and rv.status='confirmed')
      order by e.created_at desc,e.id desc limit 1
    ) old on true
    left join lateral (
      select coalesce(sum(a.amount),0) allocated_amount
      from public.cashback_transaction_allocations a where a.earning_transaction_id=old.id
    ) alloc on true
    where r.status='confirmed' and r.cashback_percentage is not null and r.cashback_amount>0
      and r.cashback_calculation_version='cashback-1.0.0'
      and r.source_system is distinct from 'iddas'
  )
  select c.redemption_id,c.client_id,c.client_name,c.description,c.original_amount,c.paid_amount,c.savings_amount,
    c.cashback_percentage,c.old_earning_id,c.old_cashback_amount,c.correct_cashback_amount,
    c.correct_cashback_amount-c.old_cashback_amount difference_amount,c.allocated_amount,c.available_amount,
    c.active_earnings,
    case
      when c.active_earnings<>1 then 'review'
      when c.allocated_amount=0 then 'replace'
      when c.correct_cashback_amount-c.old_cashback_amount<0 and c.available_amount+(c.correct_cashback_amount-c.old_cashback_amount)<0 then 'review'
      else 'adjustment'
    end recommended_action,
    case
      when c.active_earnings<>1 then 'ACTIVE_OLD_EARNING_NOT_UNIQUE'
      when c.allocated_amount>0 and c.correct_cashback_amount-c.old_cashback_amount<0 and c.available_amount+(c.correct_cashback_amount-c.old_cashback_amount)<0 then 'NEGATIVE_BALANCE_REVIEW_REQUIRED'
      else null
    end review_reason,
    c.external_key
  from candidates c;
$$;

create or replace function public.admin_preview_cashback_paid_amount_reconciliation()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  return (
    with rows as materialized(select * from public.cashback_paid_amount_reconciliation_candidates())
    select jsonb_build_object(
      'formulaVersion','paid_amount_v1',
      'confirmationKey','cashback_formula_reconciliation_paid_amount_v1',
      'candidateCount',(select count(*) from rows),
      'replaceCount',(select count(*) from rows where recommended_action='replace'),
      'adjustmentCount',(select count(*) from rows where recommended_action='adjustment'),
      'reviewCount',(select count(*) from rows where recommended_action='review'),
      'totals',jsonb_build_object(
        'previousCashback',coalesce((select sum(old_cashback_amount) from rows),0),
        'correctCashback',coalesce((select sum(correct_cashback_amount) from rows),0),
        'difference',coalesce((select sum(difference_amount) from rows),0)
      ),
      'preserved',jsonb_build_object(
        'legacySavingsCount',(select count(*) from public.iddas_savings_source_rows),
        'legacySavingsTotal',(select coalesce(sum(verified_savings_value_brl),0) from public.iddas_savings_source_rows),
        'pointsTotal',(select coalesce(sum(points),0) from public.iddas_balance_source_rows)
      ),
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'reconciliationKey',external_key,'redemptionId',redemption_id,'clientId',client_id,'clientName',client_name,
        'description',description,'originalAmount',original_amount,'paidAmount',paid_amount,'savingsAmount',savings_amount,
        'cashbackPercentage',cashback_percentage,'previousCashbackAmount',old_cashback_amount,
        'correctCashbackAmount',correct_cashback_amount,'differenceAmount',difference_amount,
        'allocatedAmount',allocated_amount,'availableAmount',available_amount,'action',recommended_action,
        'reviewReason',review_reason
      ) order by client_name,redemption_id) from rows),'[]'::jsonb),
      'canApply',public.has_staff_role(array['super_admin','manager']::public.app_role[])
    )
  );
end; $$;

create or replace function public.admin_apply_cashback_paid_amount_reconciliation(p_confirmation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  actor uuid:=auth.uid(); item record; locked_redemption public.redemptions%rowtype; locked_earning public.cashback_transactions%rowtype;
  reversal_id uuid; new_earning_id uuid; adjustment_id uuid; applied_count integer:=0; replace_count integer:=0;
  adjustment_count integer:=0; review_count integer:=0; movement_count integer:=0; candidate_count integer:=0;
  reversed_total numeric(14,2):=0; credited_total numeric(14,2):=0; adjusted_total numeric(14,2):=0;
  available_now numeric(14,2); allocated_now numeric(14,2); correct_now numeric(14,2); difference_now numeric(14,2);
  action_now text; review_now text; failure_message text;
begin
  if actor is null or not public.has_staff_role(array['super_admin','manager']::public.app_role[]) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if p_confirmation is distinct from 'cashback_formula_reconciliation_paid_amount_v1' then raise exception 'CONFIRMATION_REQUIRED' using errcode='22023';end if;

  for item in select * from public.cashback_paid_amount_reconciliation_candidates() order by client_name,redemption_id loop
    candidate_count:=candidate_count+1;
    reversal_id:=null;new_earning_id:=null;adjustment_id:=null;review_now:=item.review_reason;action_now:=item.recommended_action;
    begin
      select * into locked_redemption from public.redemptions where id=item.redemption_id for update;
      select * into locked_earning from public.cashback_transactions where id=item.old_earning_id for update;
      select coalesce(sum(a.amount),0) into allocated_now from public.cashback_transaction_allocations a where a.earning_transaction_id=locked_earning.id;
      available_now:=(public.cashback_snapshot(item.client_id)->>'available')::numeric;
      correct_now:=public.cashback_amount_for(locked_redemption.effective_cost,locked_redemption.cashback_percentage);
      difference_now:=correct_now-locked_earning.amount;

      if locked_redemption.cashback_calculation_version<>'cashback-1.0.0' then
        continue;
      elsif locked_earning.id is null or locked_earning.transaction_type<>'earning' or locked_earning.status<>'confirmed' or locked_earning.metadata->>'calculationVersion'<>'cashback-1.0.0' then
        action_now:='review';review_now:='ACTIVE_OLD_EARNING_NOT_FOUND';
      elsif exists(select 1 from public.cashback_transactions rv where rv.transaction_type='reversal' and rv.reversed_transaction_id=locked_earning.id and rv.status='confirmed') then
        action_now:='review';review_now:='OLD_EARNING_ALREADY_REVERSED';
      elsif allocated_now=0 then
        action_now:='replace';review_now:=null;
      elsif difference_now<0 and available_now+difference_now<0 then
        action_now:='review';review_now:='NEGATIVE_BALANCE_REVIEW_REQUIRED';
      else
        action_now:='adjustment';review_now:=null;
      end if;

      if action_now='review' then
        insert into public.cashback_formula_reconciliations(
          redemption_id,client_id,external_key,previous_calculation_version,new_calculation_version,
          previous_base_amount,new_base_amount,cashback_percentage,previous_cashback_amount,
          correct_cashback_amount,difference_amount,allocated_amount,available_before,action,status,
          review_reason,old_earning_transaction_id,created_by,metadata
        ) values(
          item.redemption_id,item.client_id,item.external_key,'cashback-1.0.0','paid_amount_v1',
          item.savings_amount,item.paid_amount,item.cashback_percentage,item.old_cashback_amount,
          item.correct_cashback_amount,item.difference_amount,item.allocated_amount,item.available_amount,'review','review',
          review_now,item.old_earning_id,actor,jsonb_build_object('previewedAt',clock_timestamp())
        ) on conflict(external_key) do update set status='review',action='review',review_reason=excluded.review_reason,
          allocated_amount=excluded.allocated_amount,available_before=excluded.available_before,metadata=excluded.metadata;
        review_count:=review_count+1;
        continue;
      end if;

      if action_now='replace' then
        insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,reversed_transaction_id,metadata)
        values(item.client_id,item.redemption_id,'reversal',locked_earning.amount,'confirmed','Estorno da formula cashback sobre economia',item.external_key||':reversal',public.cashback_deterministic_uuid(item.external_key||':reversal'),actor,locked_earning.id,jsonb_build_object('reason','PATCH 024 - base alterada para valor pago','oldCalculationVersion','cashback-1.0.0','newCalculationVersion','paid_amount_v1')) returning id into reversal_id;
        reversed_total:=reversed_total+locked_earning.amount;movement_count:=movement_count+1;
        if correct_now>0 then
          insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,metadata)
          values(item.client_id,item.redemption_id,'earning',correct_now,'confirmed','Novo credito: cashback sobre o valor pago',item.external_key||':earning',public.cashback_deterministic_uuid(item.external_key||':earning'),actor,jsonb_build_object('percentage',locked_redemption.cashback_percentage,'baseType','paid_amount','baseAmount',locked_redemption.effective_cost,'calculationVersion','paid_amount_v1','replacesTransactionId',locked_earning.id)) returning id into new_earning_id;
          credited_total:=credited_total+correct_now;movement_count:=movement_count+1;
        end if;
        replace_count:=replace_count+1;
      else
        if difference_now<>0 then
          insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,metadata)
          values(item.client_id,item.redemption_id,'adjustment',difference_now,'confirmed','Ajuste da formula: cashback sobre o valor pago',item.external_key||':adjustment',public.cashback_deterministic_uuid(item.external_key||':adjustment'),actor,jsonb_build_object('percentage',locked_redemption.cashback_percentage,'baseType','paid_amount','baseAmount',locked_redemption.effective_cost,'oldCashbackAmount',locked_earning.amount,'correctCashbackAmount',correct_now,'oldCalculationVersion','cashback-1.0.0','newCalculationVersion','paid_amount_v1','relatedTransactionId',locked_earning.id,'allocatedAmount',allocated_now)) returning id into adjustment_id;
          adjusted_total:=adjusted_total+difference_now;movement_count:=movement_count+1;
        end if;
        adjustment_count:=adjustment_count+1;
      end if;

      update public.redemptions set cashback_amount=correct_now,cashback_calculation_version='paid_amount_v1',
        cashback_calculated_at=clock_timestamp(),cashback_base_type='paid_amount',
        cashback_base_amount=effective_cost,updated_at=clock_timestamp()
      where id=item.redemption_id;

      insert into public.cashback_formula_reconciliations(
        redemption_id,client_id,external_key,previous_calculation_version,new_calculation_version,
        previous_base_amount,new_base_amount,cashback_percentage,previous_cashback_amount,
        correct_cashback_amount,difference_amount,allocated_amount,available_before,action,status,
        old_earning_transaction_id,reversal_transaction_id,new_earning_transaction_id,
        adjustment_transaction_id,created_by,applied_at,metadata
      ) values(
        item.redemption_id,item.client_id,item.external_key,'cashback-1.0.0','paid_amount_v1',
        item.savings_amount,item.paid_amount,item.cashback_percentage,item.old_cashback_amount,
        correct_now,difference_now,allocated_now,available_now,action_now,'applied',
        locked_earning.id,reversal_id,new_earning_id,adjustment_id,actor,clock_timestamp(),
        jsonb_build_object('reason','PATCH 024 - cashback sobre o valor pago','appliedAt',clock_timestamp())
      ) on conflict(external_key) do update set status='applied',action=excluded.action,review_reason=null,
        correct_cashback_amount=excluded.correct_cashback_amount,difference_amount=excluded.difference_amount,
        allocated_amount=excluded.allocated_amount,available_before=excluded.available_before,
        reversal_transaction_id=excluded.reversal_transaction_id,new_earning_transaction_id=excluded.new_earning_transaction_id,
        adjustment_transaction_id=excluded.adjustment_transaction_id,applied_at=excluded.applied_at,metadata=excluded.metadata;

      insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
      values(actor,item.client_id,'reconcile_cashback_formula_paid_amount_v1','redemptions',item.redemption_id::text,
        jsonb_build_object('calculationVersion','cashback-1.0.0','baseType','savings_amount','baseAmount',item.savings_amount,'cashbackPercentage',item.cashback_percentage,'cashbackAmount',item.old_cashback_amount,'earningTransactionId',item.old_earning_id),
        jsonb_build_object('calculationVersion','paid_amount_v1','baseType','paid_amount','baseAmount',item.paid_amount,'cashbackPercentage',item.cashback_percentage,'cashbackAmount',correct_now,'differenceAmount',difference_now,'allocatedAmount',allocated_now,'action',action_now,'reversalTransactionId',reversal_id,'newEarningTransactionId',new_earning_id,'adjustmentTransactionId',adjustment_id,'reconciliationKey',item.external_key));
      applied_count:=applied_count+1;
    exception when others then
      failure_message:=sqlstate||':'||sqlerrm;
      insert into public.cashback_formula_reconciliations(
        redemption_id,client_id,external_key,previous_calculation_version,new_calculation_version,
        previous_base_amount,new_base_amount,cashback_percentage,previous_cashback_amount,
        correct_cashback_amount,difference_amount,allocated_amount,available_before,action,status,
        review_reason,old_earning_transaction_id,created_by,metadata
      ) values(
        item.redemption_id,item.client_id,item.external_key,'cashback-1.0.0','paid_amount_v1',
        item.savings_amount,item.paid_amount,item.cashback_percentage,item.old_cashback_amount,
        item.correct_cashback_amount,item.difference_amount,item.allocated_amount,item.available_amount,
        'review','review','PROCESSING_ERROR',item.old_earning_id,actor,jsonb_build_object('error',failure_message)
      ) on conflict(external_key) do update set status='review',action='review',review_reason='PROCESSING_ERROR',metadata=excluded.metadata;
      review_count:=review_count+1;
    end;
  end loop;

  return jsonb_build_object(
    'formulaVersion','paid_amount_v1','candidateCount',candidate_count,'applied',applied_count,
    'replaced',replace_count,'adjusted',adjustment_count,'review',review_count,'newMovements',movement_count,
    'totals',jsonb_build_object('reversed',reversed_total,'credited',credited_total,'adjusted',adjusted_total),
    'alreadyReconciled',(select count(*) from public.cashback_formula_reconciliations where status='applied' and new_calculation_version='paid_amount_v1'),
    'remainingCandidates',(select count(*) from public.cashback_paid_amount_reconciliation_candidates())
  );
end; $$;

create or replace function public.get_travel_sales(p_client_id uuid default null,p_start_date date default null,p_end_date date default null,p_limit integer default 20,p_offset integer default 0,p_travel_type public.redemption_type default null,p_has_cashback boolean default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),100);safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'INVALID_PERIOD' using errcode='22007';end if;
  return (with filtered as materialized(
    select r.*,c.full_name,c.cashback_enabled,c.cashback_default_percentage,lp.name program_name,exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active') has_evidence
    from public.redemptions r join public.clients c on c.id=r.client_id left join public.program_accounts pa on pa.id=r.travel_account_id left join public.loyalty_programs lp on lp.id=pa.program_id
    where r.payment_mode is not null and r.status='confirmed' and (p_client_id is null or r.client_id=p_client_id) and (p_start_date is null or r.launched_on>=p_start_date) and (p_end_date is null or r.launched_on<=p_end_date) and (p_travel_type is null or r.redemption_type=p_travel_type) and (p_has_cashback is null or (r.cashback_amount>0)=p_has_cashback)
  ),paged as(select * from filtered order by launched_on desc,created_at desc limit safe_limit offset safe_offset),ranking as(
    select client_id,full_name,sum(savings_amount) total_savings,count(*) records,row_number() over(order by sum(savings_amount) desc,full_name,client_id) position from filtered group by client_id,full_name
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'clientId',p.client_id,'clientName',p.full_name,'launchedOn',p.launched_on,'paymentMode',p.payment_mode,'travelType',p.redemption_type,'details',p.description,'originalValue',p.cash_reference_total,'paidValue',p.effective_cost,'savingsAmount',p.savings_amount,'programName',p.program_name,'pointsUsed',p.travel_points_used,'sourceSystem',p.source_system,'sourceBatchKey',p.source_batch_key,'migrated',p.source_system='iddas','updatedAt',p.updated_at,'cashbackPercentage',p.cashback_percentage,'cashbackAmount',p.cashback_amount,'cashbackBaseType',p.cashback_base_type,'cashbackBaseAmount',p.cashback_base_amount,'cashbackCalculationVersion',p.cashback_calculation_version,'hasEvidence',p.has_evidence) order by p.launched_on desc,p.created_at desc) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),'totalSavings',coalesce((select sum(savings_amount) from filtered),0),'totalCashback',coalesce((select sum(cashback_amount) from filtered),0),'limit',safe_limit,'offset',safe_offset,
    'ranking',coalesce((select jsonb_agg(jsonb_build_object('position',r.position,'clientId',r.client_id,'clientName',r.full_name,'totalSavings',r.total_savings,'records',r.records) order by r.position) from ranking r),'[]'::jsonb),
    'pendingReconciliation',(select count(*) from public.iddas_savings_reconciliations where status in ('pending','conflict')),'canWrite',public.can_write_client_data(),
    'selectedClientCashback',case when p_client_id is null then null else (select jsonb_build_object('enabled',c.cashback_enabled,'defaultPercentage',c.cashback_default_percentage,'summary',public.cashback_snapshot(c.id)) from public.clients c where c.id=p_client_id) end
  ));
end; $$;

create or replace function public.build_public_client_savings_history(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'date',r.launched_on,'description',r.description,'originalValue',r.cash_reference_total,'paidValue',r.effective_cost,'savingsValue',r.savings_amount,'travelType',r.redemption_type,'migrated',r.source_system='iddas','cashbackPercentage',r.cashback_percentage,'cashbackAmount',r.cashback_amount,'cashbackBaseType',r.cashback_base_type,'cashbackBaseAmount',r.cashback_base_amount,'cashbackCalculationVersion',r.cashback_calculation_version,'hasEvidence',exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active')) order by r.launched_on desc,r.created_at desc),'[]'::jsonb)
  from public.redemptions r join public.clients c on c.id=r.client_id where r.client_id=p_client_id and c.status='active' and r.status='confirmed';
$$;

revoke all on function public.cashback_paid_amount_reconciliation_candidates(),public.admin_preview_cashback_paid_amount_reconciliation(),public.admin_apply_cashback_paid_amount_reconciliation(text) from public,anon;
grant execute on function public.admin_preview_cashback_paid_amount_reconciliation(),public.admin_apply_cashback_paid_amount_reconciliation(text) to authenticated;
grant execute on function public.cashback_paid_amount_reconciliation_candidates() to service_role;

notify pgrst,'reload schema';
commit;
