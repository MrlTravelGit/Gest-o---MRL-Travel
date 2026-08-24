begin;

alter type public.redemption_status add value if not exists 'voided';

alter table public.redemptions
  add column if not exists operation_group_id uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

update public.redemptions
set operation_group_id = coalesce(operation_group_id, public.cashback_deterministic_uuid('saving-group:' || id::text))
where operation_group_id is null;

alter table public.redemptions alter column operation_group_id set not null;
alter table public.redemptions alter column operation_group_id set default gen_random_uuid();

alter table public.cashback_transactions
  add column if not exists operation_group_id uuid,
  add column if not exists visibility_scope text not null default 'public',
  add column if not exists origin_kind text not null default 'standalone',
  add column if not exists redemption_mode text;

alter table public.cashback_transactions drop constraint if exists cashback_visibility_scope_valid;
alter table public.cashback_transactions add constraint cashback_visibility_scope_valid
  check (visibility_scope in ('public','admin_only'));
alter table public.cashback_transactions drop constraint if exists cashback_redemption_mode_valid;
alter table public.cashback_transactions add constraint cashback_redemption_mode_valid
  check (redemption_mode is null or redemption_mode in ('usage','payment'));

update public.cashback_transactions t
set operation_group_id = r.operation_group_id,
    visibility_scope = 'admin_only',
    origin_kind = case
      when t.transaction_type = 'earning' then 'saving_earning'
      when t.transaction_type = 'reversal' then 'saving_reversal'
      else 'saving_reconciliation'
    end
from public.redemptions r
where r.id = t.redemption_id
  and (t.operation_group_id is distinct from r.operation_group_id
    or t.visibility_scope <> 'admin_only'
    or t.origin_kind = 'standalone');

update public.cashback_transactions
set operation_group_id = coalesce(operation_group_id, public.cashback_deterministic_uuid('cashback-group:' || id::text)),
    redemption_mode = case when transaction_type = 'redemption' then coalesce(redemption_mode, 'usage') else redemption_mode end
where operation_group_id is null or (transaction_type = 'redemption' and redemption_mode is null);

alter table public.cashback_transactions alter column operation_group_id set not null;
alter table public.cashback_transactions alter column operation_group_id set default gen_random_uuid();

create index if not exists redemptions_operation_group_idx on public.redemptions(operation_group_id);
create index if not exists cashback_transactions_operation_group_idx on public.cashback_transactions(operation_group_id, created_at);
create index if not exists cashback_transactions_public_idx on public.cashback_transactions(client_id, created_at desc)
  where status = 'confirmed' and visibility_scope = 'public';

create or replace function public.assign_cashback_operation_authority()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare saving_group uuid;
begin
  if new.redemption_id is not null then
    select operation_group_id into saving_group from public.redemptions where id = new.redemption_id;
    if saving_group is null then raise exception 'SAVING_NOT_FOUND' using errcode='23503'; end if;
    new.operation_group_id := saving_group;
    new.visibility_scope := 'admin_only';
    new.origin_kind := case
      when new.transaction_type = 'earning' then 'saving_earning'
      when new.transaction_type = 'reversal' then 'saving_reversal'
      else 'saving_reconciliation'
    end;
  else
    new.operation_group_id := coalesce(new.operation_group_id, gen_random_uuid());
    new.origin_kind := coalesce(nullif(new.origin_kind,''), 'standalone');
  end if;
  if new.transaction_type = 'redemption' then
    new.redemption_mode := coalesce(new.redemption_mode, 'usage');
  else
    new.redemption_mode := null;
  end if;
  return new;
end; $$;

drop trigger if exists cashback_operation_authority_trg on public.cashback_transactions;
create trigger cashback_operation_authority_trg
before insert or update of redemption_id,transaction_type,operation_group_id,visibility_scope,origin_kind,redemption_mode
on public.cashback_transactions for each row execute function public.assign_cashback_operation_authority();

create or replace function public.cashback_snapshot(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with official_earnings as (
    select coalesce(sum(r.cashback_amount),0)::numeric generated
    from public.redemptions r
    where r.client_id=p_client_id and r.status='confirmed'
  ), standalone as (
    select
      coalesce(sum(t.amount) filter(where t.transaction_type='redemption' and coalesce(t.redemption_mode,'usage')='usage'),0)::numeric used,
      coalesce(sum(t.amount) filter(where t.transaction_type='redemption' and t.redemption_mode='payment'),0)::numeric paid,
      coalesce(sum(t.amount) filter(where t.transaction_type='reversal'),0)::numeric reversed,
      coalesce(sum(t.amount) filter(where t.transaction_type='adjustment'),0)::numeric adjusted
    from public.cashback_transactions t
    where t.client_id=p_client_id and t.status='confirmed' and t.redemption_id is null
  )
  select jsonb_build_object(
    'generated',round(e.generated,2),'used',round(s.used,2),'paid',round(s.paid,2),
    'reversed',round(s.reversed,2),'adjusted',round(s.adjusted,2),
    'available',round(e.generated+s.adjusted-s.used-s.paid-s.reversed,2)
  ) from official_earnings e cross join standalone s;
$$;

create or replace function public.build_public_client_cashback(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with client_row as (
    select c.id,c.cashback_enabled from public.clients c where c.id=p_client_id and c.status='active'
  ), public_entries as (
    select
      r.id, 'earning'::text type, r.cashback_amount amount,
      'Cashback da reserva: ' || r.description description,
      r.id redemption_id, r.created_at
    from public.redemptions r join client_row c on c.id=r.client_id
    where r.status='confirmed' and r.cashback_amount>0
    union all
    select
      t.id,t.transaction_type,t.amount,t.description,null::uuid,t.created_at
    from public.cashback_transactions t join client_row c on c.id=t.client_id
    where t.status='confirmed' and t.redemption_id is null and t.visibility_scope='public'
  )
  select jsonb_build_object(
    'enabled',coalesce((select cashback_enabled from client_row),false),
    'summary',public.cashback_snapshot(p_client_id),
    'transactions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'type',e.type,'amount',e.amount,'description',e.description,
        'redemptionId',e.redemption_id,'createdAt',e.created_at
      ) order by e.created_at desc,e.id desc) from public_entries e
    ),'[]'::jsonb)
  );
$$;

create or replace function public.build_public_client_savings_history(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'date',r.launched_on,'description',r.description,
    'originalValue',r.cash_reference_total,'paidValue',r.effective_cost,
    'savingsValue',r.savings_amount,'travelType',r.redemption_type,
    'migrated',r.source_system='iddas','cashbackPercentage',r.cashback_percentage,
    'cashbackAmount',r.cashback_amount,'cashbackBaseType',r.cashback_base_type,
    'cashbackBaseAmount',r.cashback_base_amount,
    'cashbackCalculationVersion',r.cashback_calculation_version,
    'hasEvidence',exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active')
  ) order by r.launched_on desc,r.created_at desc),'[]'::jsonb)
  from public.redemptions r join public.clients c on c.id=r.client_id
  where r.client_id=p_client_id and c.status='active' and r.status='confirmed';
$$;

create or replace function public.admin_preview_travel_saving_void(p_redemption_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); saving public.redemptions%rowtype; generated numeric:=0; allocated numeric:=0; used numeric:=0; paid numeric:=0;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into saving from public.redemptions where id=p_redemption_id;
  if saving.id is null or saving.payment_mode<>'cash' or saving.travel_points_used is not null then raise exception 'SAVING_NOT_FOUND' using errcode='P0002'; end if;
  select coalesce(sum(e.amount),0),coalesce(sum(a.amount),0),
    coalesce(sum(a.amount) filter(where coalesce(spend.redemption_mode,'usage')='usage'),0),
    coalesce(sum(a.amount) filter(where spend.redemption_mode='payment'),0)
  into generated,allocated,used,paid
  from public.cashback_transactions e
  left join public.cashback_transaction_allocations a on a.earning_transaction_id=e.id
  left join public.cashback_transactions spend on spend.id=a.redemption_transaction_id and spend.status='confirmed'
  where e.redemption_id=saving.id and e.transaction_type='earning' and e.status='confirmed'
    and not exists(select 1 from public.cashback_transactions rv where rv.reversed_transaction_id=e.id and rv.transaction_type='reversal' and rv.status='confirmed');
  return jsonb_build_object(
    'redemptionId',saving.id,'status',case when saving.status in ('cancelled','voided') then 'voided' else saving.status::text end,
    'operationGroupId',saving.operation_group_id,'generated',round(coalesce(generated,0),2),
    'used',round(coalesce(used,0),2),'paid',round(coalesce(paid,0),2),
    'allocated',round(coalesce(allocated,0),2),
    'available',round(greatest(coalesce(generated,0)-coalesce(allocated,0),0),2),
    'blocked',coalesce(allocated,0)>0,
    'requiresRegularization',coalesce(allocated,0)>0
  );
end; $$;

create or replace function public.admin_void_travel_saving(
  p_redemption_id uuid,p_reason text,p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); before_row public.redemptions%rowtype; after_row public.redemptions%rowtype;
  earning record; allocated numeric:=0; reversal_ids uuid[]:='{}'; reversal_id uuid; preview jsonb;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'VOID_REASON_REQUIRED' using errcode='22023'; end if;
  select * into before_row from public.redemptions where id=p_redemption_id for update;
  if before_row.id is null or before_row.payment_mode<>'cash' or before_row.travel_points_used is not null then raise exception 'SAVING_NOT_FOUND' using errcode='P0002'; end if;
  if before_row.status in ('cancelled','voided') then
    return jsonb_build_object('redemptionId',before_row.id,'status','voided','operationGroupId',before_row.operation_group_id,'idempotentReplay',true,'summary',public.cashback_snapshot(before_row.client_id));
  end if;
  if before_row.status<>'confirmed' then raise exception 'SAVING_NOT_ACTIVE' using errcode='55000'; end if;
  if p_expected_updated_at is not null and before_row.updated_at<>p_expected_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;

  preview:=public.admin_preview_travel_saving_void(p_redemption_id);
  if coalesce((preview->>'allocated')::numeric,0)>0 then raise exception 'CASHBACK_REGULARIZATION_REQUIRED' using errcode='55000', detail=preview::text; end if;

  for earning in
    select e.* from public.cashback_transactions e
    where e.redemption_id=before_row.id and e.transaction_type='earning' and e.status='confirmed'
      and not exists(select 1 from public.cashback_transactions rv where rv.reversed_transaction_id=e.id and rv.transaction_type='reversal' and rv.status='confirmed')
    order by e.created_at,e.id for update
  loop
    insert into public.cashback_transactions(
      client_id,redemption_id,transaction_type,amount,status,description,source_external_key,
      idempotency_key,created_by,reversed_transaction_id,metadata
    ) values (
      before_row.client_id,before_row.id,'reversal',earning.amount,'confirmed',
      'Estorno técnico por anulação da economia','cashback:void:'||earning.id,
      public.cashback_deterministic_uuid('void:'||earning.id),actor,earning.id,
      jsonb_build_object('reason',trim(p_reason),'voidOperationGroupId',before_row.operation_group_id)
    ) on conflict (idempotency_key) where idempotency_key is not null do nothing returning id into reversal_id;
    if reversal_id is not null then reversal_ids:=array_append(reversal_ids,reversal_id); end if;
  end loop;

  update public.redemptions set status='voided',voided_at=clock_timestamp(),voided_by=actor,
    void_reason=trim(p_reason),updated_at=clock_timestamp(),
    notes=concat_ws(E'\n',notes,'Anulada administrativamente: '||trim(p_reason))
  where id=before_row.id returning * into after_row;
  update public.cashback_transactions set visibility_scope='admin_only',operation_group_id=after_row.operation_group_id
  where redemption_id=after_row.id;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,after_row.client_id,'void_travel_saving','redemptions',after_row.id::text,
    jsonb_build_object('status',before_row.status,'savingsValue',before_row.savings_amount,'cashbackAmount',before_row.cashback_amount),
    jsonb_build_object('status','voided','reason',trim(p_reason),'operationGroupId',after_row.operation_group_id,'reversalTransactionIds',to_jsonb(reversal_ids)));
  return jsonb_build_object('redemptionId',after_row.id,'status','voided','operationGroupId',after_row.operation_group_id,
    'reversalTransactionIds',to_jsonb(reversal_ids),'idempotentReplay',false,'summary',public.cashback_snapshot(after_row.client_id));
end; $$;

drop function if exists public.admin_cancel_travel_saving(uuid,text,timestamptz);
create function public.admin_cancel_travel_saving(p_redemption_id uuid,p_reason text,p_expected_updated_at timestamptz default null)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$
  select public.admin_void_travel_saving(p_redemption_id,p_reason,p_expected_updated_at);
$$;

create or replace function public.admin_preview_voided_savings_repair()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not public.has_staff_role(array['super_admin','manager']::public.app_role[]) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  return (
    with candidates as (
      select r.id,r.client_id,c.full_name,r.description,r.status,r.operation_group_id,
        coalesce(sum(e.amount) filter(where e.transaction_type='earning'),0) generated,
        coalesce(sum(rv.amount) filter(where rv.transaction_type='reversal'),0) reversed,
        coalesce(sum(a.amount),0) allocated
      from public.redemptions r join public.clients c on c.id=r.client_id
      left join public.cashback_transactions e on e.redemption_id=r.id and e.status='confirmed'
      left join public.cashback_transactions rv on rv.reversed_transaction_id=e.id and rv.transaction_type='reversal' and rv.status='confirmed'
      left join public.cashback_transaction_allocations a on a.earning_transaction_id=e.id
      where r.status='cancelled'
      group by r.id,c.full_name
    )
    select jsonb_build_object(
      'candidateCount',count(*),
      'applicableCount',count(*) filter(where allocated=0),
      'blockedCount',count(*) filter(where allocated>0),
      'items',coalesce(jsonb_agg(jsonb_build_object(
        'redemptionId',id,'clientId',client_id,'clientName',full_name,'description',description,
        'operationGroupId',operation_group_id,'generated',generated,'reversed',reversed,
        'allocated',allocated,'action',case when allocated>0 then 'regularize' else 'normalize_void' end
      ) order by full_name,id),'[]'::jsonb)
    ) from candidates
  );
end; $$;

create or replace function public.admin_apply_voided_savings_repair(p_confirmation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); item record; applied integer:=0; blocked integer:=0;
begin
  if actor is null or not public.has_staff_role(array['super_admin','manager']::public.app_role[]) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_confirmation<>'cashback_void_visibility_v1' then raise exception 'CONFIRMATION_REQUIRED' using errcode='22023'; end if;
  for item in
    select r.*,coalesce((select sum(a.amount) from public.cashback_transactions e join public.cashback_transaction_allocations a on a.earning_transaction_id=e.id where e.redemption_id=r.id),0) allocated
    from public.redemptions r where r.status='cancelled' order by r.id for update
  loop
    if item.allocated>0 then blocked:=blocked+1; continue; end if;
    update public.redemptions set status='voided',voided_at=coalesce(voided_at,updated_at,clock_timestamp()),
      void_reason=coalesce(void_reason,'Operação cancelada anteriormente; metadados normalizados pelo Patch 026'),
      updated_at=clock_timestamp() where id=item.id;
    update public.cashback_transactions set operation_group_id=item.operation_group_id,visibility_scope='admin_only'
      where redemption_id=item.id;
    insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
    values(actor,item.client_id,'normalize_cancelled_saving_as_voided','redemptions',item.id::text,
      jsonb_build_object('status','cancelled'),jsonb_build_object('status','voided','operationGroupId',item.operation_group_id));
    applied:=applied+1;
  end loop;
  return jsonb_build_object('applied',applied,'blocked',blocked,'idempotentReplay',applied=0);
end; $$;

drop function if exists public.get_travel_sales_v2(uuid,date,date,integer,integer,public.redemption_type,boolean,text);
create function public.get_travel_sales_v2(
  p_client_id uuid default null,p_start_date date default null,p_end_date date default null,
  p_limit integer default 20,p_offset integer default 0,p_travel_type public.redemption_type default null,
  p_has_cashback boolean default null,p_status text default 'active'
)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),100);
  safe_offset integer:=greatest(coalesce(p_offset,0),0); normalized_status text:=lower(coalesce(nullif(trim(p_status),''),'active'));
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if normalized_status not in ('active','voided','all') then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
  if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'INVALID_PERIOD' using errcode='22007'; end if;
  return (with filtered as materialized(
    select r.*,c.full_name,lp.name program_name,
      exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active') has_evidence,
      case when r.status in ('cancelled','voided') then 'voided' else 'active' end public_status
    from public.redemptions r join public.clients c on c.id=r.client_id
    left join public.program_accounts pa on pa.id=r.travel_account_id
    left join public.loyalty_programs lp on lp.id=pa.program_id
    where r.payment_mode is not null
      and (normalized_status='all' or (normalized_status='active' and r.status='confirmed') or (normalized_status='voided' and r.status in ('cancelled','voided')))
      and (p_client_id is null or r.client_id=p_client_id)
      and (p_start_date is null or r.launched_on>=p_start_date) and (p_end_date is null or r.launched_on<=p_end_date)
      and (p_travel_type is null or r.redemption_type=p_travel_type)
      and (p_has_cashback is null or (r.cashback_amount>0)=p_has_cashback)
  ),paged as(select * from filtered order by launched_on desc,created_at desc limit safe_limit offset safe_offset),
  ranking as(
    select client_id,full_name,sum(savings_amount) total_savings,count(*) records,
      row_number() over(order by sum(savings_amount) desc,full_name,client_id) position
    from filtered where public_status='active' group by client_id,full_name
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'clientId',p.client_id,'clientName',p.full_name,'launchedOn',p.launched_on,
      'paymentMode',p.payment_mode,'travelType',p.redemption_type,'details',p.description,
      'originalValue',p.cash_reference_total,'paidValue',p.effective_cost,'savingsAmount',p.savings_amount,
      'programName',p.program_name,'pointsUsed',p.travel_points_used,'sourceSystem',p.source_system,
      'sourceBatchKey',p.source_batch_key,'migrated',p.source_system='iddas','updatedAt',p.updated_at,
      'cashbackPercentage',p.cashback_percentage,'cashbackAmount',p.cashback_amount,
      'cashbackBaseType',p.cashback_base_type,'cashbackBaseAmount',p.cashback_base_amount,
      'cashbackCalculationVersion',p.cashback_calculation_version,'hasEvidence',p.has_evidence,
      'status',p.public_status,'voidedAt',p.voided_at,'voidedBy',p.voided_by,
      'voidReason',p.void_reason,'operationGroupId',p.operation_group_id
    ) order by p.launched_on desc,p.created_at desc) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'totalSavings',coalesce((select sum(savings_amount) from filtered where public_status='active'),0),
    'totalCashback',coalesce((select sum(cashback_amount) from filtered where public_status='active'),0),
    'limit',safe_limit,'offset',safe_offset,
    'ranking',coalesce((select jsonb_agg(jsonb_build_object('position',r.position,'clientId',r.client_id,'clientName',r.full_name,'totalSavings',r.total_savings,'records',r.records) order by r.position) from ranking r),'[]'::jsonb),
    'pendingReconciliation',(select count(*) from public.iddas_savings_reconciliations where status in ('pending','conflict')),
    'canWrite',public.can_write_client_data(),
    'selectedClientCashback',case when p_client_id is null then null else (select jsonb_build_object('enabled',c.cashback_enabled,'defaultPercentage',c.cashback_default_percentage,'summary',public.cashback_snapshot(c.id)) from public.clients c where c.id=p_client_id) end
  ));
end; $$;

create or replace function public.record_cashback_redemption_v2(
  p_client_id uuid,p_amount numeric,p_description text,p_operation_id uuid,p_mode text default 'usage'
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); available numeric; tx public.cashback_transactions%rowtype; earning record; remaining numeric; take_amount numeric;
begin
  if actor is null or not public.has_staff_role(array['super_admin','manager']::public.app_role[]) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_mode not in ('usage','payment') then raise exception 'INVALID_REDEMPTION_MODE' using errcode='22023'; end if;
  if p_amount is null or round(p_amount,2)<=0 or length(trim(coalesce(p_description,'')))<3 then raise exception 'INVALID_REDEMPTION' using errcode='22023'; end if;
  select * into tx from public.cashback_transactions where idempotency_key=p_operation_id;
  if tx.id is not null then
    if tx.client_id<>p_client_id or tx.amount<>round(p_amount,2) or tx.redemption_mode<>p_mode then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('transactionId',tx.id,'idempotentReplay',true,'summary',public.cashback_snapshot(p_client_id));
  end if;
  perform 1 from public.clients where id=p_client_id for update;
  available:=(public.cashback_snapshot(p_client_id)->>'available')::numeric;
  if round(p_amount,2)>available then raise exception 'INSUFFICIENT_CASHBACK_BALANCE' using errcode='23514'; end if;
  insert into public.cashback_transactions(client_id,transaction_type,amount,status,description,idempotency_key,created_by,metadata,redemption_mode,origin_kind)
  values(p_client_id,'redemption',round(p_amount,2),'confirmed',trim(p_description),p_operation_id,actor,jsonb_build_object('balanceBefore',available,'mode',p_mode),p_mode,'standalone')
  returning * into tx;
  remaining:=tx.amount;
  for earning in
    select e.id,e.amount-coalesce((select sum(a.amount) from public.cashback_transaction_allocations a where a.earning_transaction_id=e.id),0) unallocated
    from public.cashback_transactions e join public.redemptions r on r.id=e.redemption_id and r.status='confirmed'
    where e.client_id=p_client_id and e.transaction_type='earning' and e.status='confirmed'
      and not exists(select 1 from public.cashback_transactions rv where rv.transaction_type='reversal' and rv.reversed_transaction_id=e.id and rv.status='confirmed')
    order by e.created_at,e.id for update
  loop
    exit when remaining<=0; take_amount:=least(remaining,earning.unallocated);
    if take_amount>0 then insert into public.cashback_transaction_allocations(redemption_transaction_id,earning_transaction_id,amount) values(tx.id,earning.id,take_amount); remaining:=remaining-take_amount; end if;
  end loop;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data)
  values(actor,p_client_id,'record_cashback_'||p_mode,'cashback_transactions',tx.id::text,jsonb_build_object('amount',tx.amount,'mode',p_mode,'description',tx.description));
  return jsonb_build_object('transactionId',tx.id,'idempotentReplay',false,'summary',public.cashback_snapshot(p_client_id));
end; $$;

create or replace function public.get_admin_client_cashback(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.clients%rowtype;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into c from public.clients where id=p_client_id;
  if c.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object(
    'config',jsonb_build_object('enabled',c.cashback_enabled,'defaultPercentage',c.cashback_default_percentage,'enabledAt',c.cashback_enabled_at,'enabledBy',c.cashback_enabled_by,'updatedAt',c.cashback_config_updated_at,'updatedBy',c.cashback_config_updated_by),
    'summary',public.cashback_snapshot(p_client_id),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'type',t.transaction_type,'amount',t.amount,'status',t.status,
      'description',t.description,'redemptionId',t.redemption_id,
      'reversedTransactionId',t.reversed_transaction_id,'createdAt',t.created_at,
      'operationGroupId',t.operation_group_id,'visibilityScope',t.visibility_scope,
      'originKind',t.origin_kind,'redemptionMode',t.redemption_mode
    ) order by t.created_at desc,t.id desc) from public.cashback_transactions t where t.client_id=p_client_id),'[]'::jsonb),
    'canManage',public.has_staff_role(array['super_admin','manager']::public.app_role[])
  );
end; $$;

revoke all on function public.admin_preview_travel_saving_void(uuid),public.admin_void_travel_saving(uuid,text,timestamptz),
  public.admin_cancel_travel_saving(uuid,text,timestamptz),public.admin_preview_voided_savings_repair(),
  public.admin_apply_voided_savings_repair(text),public.get_travel_sales_v2(uuid,date,date,integer,integer,public.redemption_type,boolean,text),
  public.record_cashback_redemption_v2(uuid,numeric,text,uuid,text),public.build_public_client_cashback(uuid),
  public.build_public_client_savings_history(uuid),public.cashback_snapshot(uuid),public.get_admin_client_cashback(uuid)
from public,anon;
grant execute on function public.admin_preview_travel_saving_void(uuid),public.admin_void_travel_saving(uuid,text,timestamptz),
  public.admin_cancel_travel_saving(uuid,text,timestamptz),public.admin_preview_voided_savings_repair(),
  public.admin_apply_voided_savings_repair(text),public.get_travel_sales_v2(uuid,date,date,integer,integer,public.redemption_type,boolean,text),
  public.record_cashback_redemption_v2(uuid,numeric,text,uuid,text),public.get_admin_client_cashback(uuid)
to authenticated;
grant execute on function public.build_public_client_cashback(uuid),public.build_public_client_savings_history(uuid),public.cashback_snapshot(uuid)
to service_role;

notify pgrst,'reload schema';
commit;
