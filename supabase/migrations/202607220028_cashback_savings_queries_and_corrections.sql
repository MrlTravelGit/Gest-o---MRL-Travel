begin;

drop function if exists public.admin_update_travel_saving(uuid,date,public.redemption_type,text,numeric,numeric,text,timestamptz);
create function public.admin_update_travel_saving(
  p_redemption_id uuid,p_launched_on date,p_travel_type public.redemption_type,p_details text,
  p_original_value numeric,p_paid_value numeric,p_cashback_percentage numeric,p_reason text,p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); before_row public.redemptions%rowtype; after_row public.redemptions%rowtype; client_row public.clients%rowtype; old_earning public.cashback_transactions%rowtype; financial_changed boolean; effective_percentage numeric(5,2); new_cashback numeric(14,2); sequence_no integer; reversal_id uuid; new_earning_id uuid; allocated numeric;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if p_launched_on is null or p_launched_on>current_date then raise exception 'INVALID_DATE' using errcode='22007';end if;
  if length(trim(coalesce(p_details,'')))<3 then raise exception 'DETAILS_REQUIRED' using errcode='22023';end if;
  if p_original_value<0 or p_paid_value<0 then raise exception 'INVALID_VALUES' using errcode='22003';end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'CHANGE_REASON_REQUIRED' using errcode='22023';end if;
  select * into before_row from public.redemptions where id=p_redemption_id for update;
  if before_row.id is null or before_row.payment_mode<>'cash' or before_row.travel_points_used is not null or before_row.status<>'confirmed' then raise exception 'SAVING_NOT_FOUND' using errcode='P0002';end if;
  if p_expected_updated_at is not null and before_row.updated_at<>p_expected_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001';end if;
  select * into client_row from public.clients where id=before_row.client_id for update;
  effective_percentage:=case when client_row.cashback_enabled then p_cashback_percentage else null end;
  if effective_percentage is not null and (effective_percentage<=0 or effective_percentage>100) then raise exception 'INVALID_CASHBACK_PERCENTAGE' using errcode='22023';end if;
  new_cashback:=public.cashback_amount_for(round(p_original_value,2)-round(p_paid_value,2),effective_percentage);
  financial_changed:=before_row.cash_reference_total<>round(p_original_value,2) or before_row.effective_cost<>round(p_paid_value,2) or before_row.cashback_percentage is distinct from effective_percentage;
  if financial_changed then
    select e.* into old_earning from public.cashback_transactions e where e.redemption_id=before_row.id and e.transaction_type='earning' and e.status='confirmed' and not exists(select 1 from public.cashback_transactions rv where rv.transaction_type='reversal' and rv.reversed_transaction_id=e.id and rv.status='confirmed') order by e.created_at desc,e.id desc limit 1 for update;
    if old_earning.id is not null then
      select coalesce(sum(a.amount),0) into allocated from public.cashback_transaction_allocations a where a.earning_transaction_id=old_earning.id;
      if allocated>0 then raise exception 'CASHBACK_ALREADY_USED' using errcode='55000';end if;
      insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,reversed_transaction_id,metadata)
      values(before_row.client_id,before_row.id,'reversal',old_earning.amount,'confirmed','Estorno para correção da economia','cashback:reversal:'||old_earning.id,public.cashback_deterministic_uuid('reversal:'||old_earning.id),actor,old_earning.id,jsonb_build_object('reason',trim(p_reason))) returning id into reversal_id;
    end if;
  end if;
  update public.redemptions set redemption_type=p_travel_type,description=trim(p_details),issued_at=(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo',launched_on=p_launched_on,
    cash_reference_total=round(p_original_value,2),taxes_paid=0,additional_cash_paid=round(p_paid_value,2),attributed_points_cost=0,reference_captured_at=(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo',
    cashback_percentage=case when financial_changed then effective_percentage else cashback_percentage end,cashback_amount=case when financial_changed then new_cashback else cashback_amount end,
    cashback_calculation_version=case when financial_changed and effective_percentage is not null then 'cashback-1.0.0' when financial_changed then null else cashback_calculation_version end,
    cashback_calculated_at=case when financial_changed and effective_percentage is not null then clock_timestamp() when financial_changed then null else cashback_calculated_at end,updated_at=clock_timestamp()
  where id=p_redemption_id returning * into after_row;
  if financial_changed and new_cashback>0 then
    select count(*)+1 into sequence_no from public.cashback_transactions where redemption_id=after_row.id and transaction_type='earning';
    insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,metadata)
    values(after_row.client_id,after_row.id,'earning',new_cashback,'confirmed','Cashback corrigido da economia: '||after_row.description,'cashback:earning:'||after_row.id||':'||sequence_no,public.cashback_deterministic_uuid('earning:'||after_row.id||':'||sequence_no),actor,jsonb_build_object('percentage',effective_percentage,'savingsAmount',after_row.savings_amount,'reason',trim(p_reason),'correctionSequence',sequence_no)) returning id into new_earning_id;
  end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data) values(actor,after_row.client_id,'update_travel_saving','redemptions',after_row.id::text,
    jsonb_build_object('launchedOn',before_row.launched_on,'travelType',before_row.redemption_type,'details',before_row.description,'originalValue',before_row.cash_reference_total,'paidValue',before_row.effective_cost,'savingsValue',before_row.savings_amount,'cashbackPercentage',before_row.cashback_percentage,'cashbackAmount',before_row.cashback_amount),
    jsonb_build_object('launchedOn',after_row.launched_on,'travelType',after_row.redemption_type,'details',after_row.description,'originalValue',after_row.cash_reference_total,'paidValue',after_row.effective_cost,'savingsValue',after_row.savings_amount,'cashbackPercentage',after_row.cashback_percentage,'cashbackAmount',after_row.cashback_amount,'reason',trim(p_reason),'reversalTransactionId',reversal_id,'newEarningTransactionId',new_earning_id,'sourceMetadataPreserved',before_row.source_external_key is not null));
  return jsonb_build_object('redemptionId',after_row.id,'savingsAmount',after_row.savings_amount,'cashbackPercentage',after_row.cashback_percentage,'cashbackAmount',after_row.cashback_amount,'reversalTransactionId',reversal_id,'newEarningTransactionId',new_earning_id,'updatedAt',after_row.updated_at);
end; $$;

drop function if exists public.admin_cancel_travel_saving(uuid,text,timestamptz);
create function public.admin_cancel_travel_saving(p_redemption_id uuid,p_reason text,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); before_row public.redemptions%rowtype; after_row public.redemptions%rowtype; earning public.cashback_transactions%rowtype; allocated numeric; reversal_id uuid;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'CANCEL_REASON_REQUIRED' using errcode='22023';end if;
  select * into before_row from public.redemptions where id=p_redemption_id for update;
  if before_row.id is null or before_row.payment_mode<>'cash' or before_row.travel_points_used is not null then raise exception 'SAVING_NOT_FOUND' using errcode='P0002';end if;
  if p_expected_updated_at is not null and before_row.updated_at<>p_expected_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001';end if;
  if before_row.status='cancelled' then return jsonb_build_object('redemptionId',before_row.id,'status','cancelled','idempotentReplay',true);end if;
  select e.* into earning from public.cashback_transactions e where e.redemption_id=before_row.id and e.transaction_type='earning' and e.status='confirmed' and not exists(select 1 from public.cashback_transactions rv where rv.transaction_type='reversal' and rv.reversed_transaction_id=e.id and rv.status='confirmed') order by e.created_at desc,e.id desc limit 1 for update;
  if earning.id is not null then
    select coalesce(sum(a.amount),0) into allocated from public.cashback_transaction_allocations a where a.earning_transaction_id=earning.id;
    if allocated>0 then raise exception 'CASHBACK_ALREADY_USED' using errcode='55000';end if;
    insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,reversed_transaction_id,metadata)
    values(before_row.client_id,before_row.id,'reversal',earning.amount,'confirmed','Estorno por cancelamento da economia','cashback:reversal:'||earning.id,public.cashback_deterministic_uuid('reversal:'||earning.id),actor,earning.id,jsonb_build_object('reason',trim(p_reason))) returning id into reversal_id;
  end if;
  update public.redemptions set status='cancelled',updated_at=clock_timestamp(),notes=concat_ws(E'\n',notes,'Cancelado administrativamente: '||trim(p_reason)) where id=p_redemption_id returning * into after_row;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data) values(actor,after_row.client_id,'cancel_travel_saving','redemptions',after_row.id::text,jsonb_build_object('status',before_row.status,'savingsValue',before_row.savings_amount,'cashbackAmount',before_row.cashback_amount),jsonb_build_object('status','cancelled','reason',trim(p_reason),'reversalTransactionId',reversal_id,'sourceMetadataPreserved',before_row.source_external_key is not null));
  return jsonb_build_object('redemptionId',after_row.id,'status','cancelled','reversalTransactionId',reversal_id,'idempotentReplay',false);
end; $$;

drop function if exists public.get_travel_sales(uuid,date,date,integer,integer);
create function public.get_travel_sales(p_client_id uuid default null,p_start_date date default null,p_end_date date default null,p_limit integer default 20,p_offset integer default 0,p_travel_type public.redemption_type default null,p_has_cashback boolean default null)
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
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'clientId',p.client_id,'clientName',p.full_name,'launchedOn',p.launched_on,'paymentMode',p.payment_mode,'travelType',p.redemption_type,'details',p.description,'originalValue',p.cash_reference_total,'paidValue',p.effective_cost,'savingsAmount',p.savings_amount,'programName',p.program_name,'pointsUsed',p.travel_points_used,'sourceSystem',p.source_system,'sourceBatchKey',p.source_batch_key,'migrated',p.source_system='iddas','updatedAt',p.updated_at,'cashbackPercentage',p.cashback_percentage,'cashbackAmount',p.cashback_amount,'hasEvidence',p.has_evidence) order by p.launched_on desc,p.created_at desc) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),'totalSavings',coalesce((select sum(savings_amount) from filtered),0),'totalCashback',coalesce((select sum(cashback_amount) from filtered),0),'limit',safe_limit,'offset',safe_offset,
    'ranking',coalesce((select jsonb_agg(jsonb_build_object('position',r.position,'clientId',r.client_id,'clientName',r.full_name,'totalSavings',r.total_savings,'records',r.records) order by r.position) from ranking r),'[]'::jsonb),
    'pendingReconciliation',(select count(*) from public.iddas_savings_reconciliations where status in ('pending','conflict')),'canWrite',public.can_write_client_data(),
    'selectedClientCashback',case when p_client_id is null then null else (select jsonb_build_object('enabled',c.cashback_enabled,'defaultPercentage',c.cashback_default_percentage,'summary',public.cashback_snapshot(c.id)) from public.clients c where c.id=p_client_id) end
  ));
end; $$;

create or replace function public.build_public_client_savings_history(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'date',r.launched_on,'description',r.description,'originalValue',r.cash_reference_total,'paidValue',r.effective_cost,'savingsValue',r.savings_amount,'travelType',r.redemption_type,'migrated',r.source_system='iddas','cashbackPercentage',r.cashback_percentage,'cashbackAmount',r.cashback_amount,'hasEvidence',exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active')) order by r.launched_on desc,r.created_at desc),'[]'::jsonb)
  from public.redemptions r join public.clients c on c.id=r.client_id where r.client_id=p_client_id and c.status='active' and r.status='confirmed';
$$;

create or replace function public.get_admin_clients(p_limit integer default 50,p_offset integer default 0,p_search text default '',p_status text default 'all')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100);safe_offset integer:=greatest(coalesce(p_offset,0),0);normalized_search text:=nullif(trim(coalesce(p_search,'')),'');normalized_status text:=lower(coalesce(nullif(trim(p_status),''),'all'));
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if normalized_status not in ('all','lead','active','paused','ended','archived','contract_pending','cashback_enabled','cashback_disabled') then raise exception 'INVALID_STATUS' using errcode='22023';end if;
  if normalized_status='archived' then normalized_status:='ended';end if;
  return (with base as materialized(
    select c.id,c.public_id,c.full_name,c.email::text email,c.phone_e164,c.status,c.created_at,c.archived_at,c.archive_reason,c.contract_review_status,c.registration_source,c.row_version,c.cashback_enabled,c.cashback_default_percentage,
      contract_data.contract_json,coalesce((public.safe_client_totals(c.id)->>'points')::bigint,0) total_points,coalesce((public.safe_client_totals(c.id)->>'programs')::integer,0) programs_count,
      coalesce((select sum(r.savings_amount) from public.redemptions r where r.client_id=c.id and r.status='confirmed'),0) generated_savings,
      (public.cashback_snapshot(c.id)->>'available')::numeric cashback_available,(public.cashback_snapshot(c.id)->>'generated')::numeric cashback_generated,
      (select count(*) from public.program_accounts pa where pa.client_id=c.id and pa.active and pa.club_active) active_clubs_count,
      (select min(el.expires_on) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=c.id and el.status='active' and el.remaining_points>0 and el.expires_on>=current_date) next_expiration_date,
      coalesce((select sum(el.remaining_points) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=c.id and el.status='active' and el.remaining_points>0 and el.expires_on between current_date and current_date+90),0) expiring_points,
      (select max(pt.occurred_at) from public.point_transactions pt join public.program_accounts pa on pa.id=pt.account_id where pa.client_id=c.id) last_movement_at
    from public.clients c left join lateral(select jsonb_build_object('contractId',mc.id,'startsOn',mc.starts_on,'endsOn',mc.ends_on,'status',mc.status,'planName',mc.plan_name,'contractValue',mc.contract_value,'autoRenew',mc.auto_renew,'updatedAt',mc.updated_at) contract_json from public.management_contracts mc where mc.client_id=c.id order by case when mc.status='active' then 0 when mc.status='paused' then 1 else 2 end,mc.updated_at desc,mc.id desc limit 1) contract_data on true
    where normalized_search is null or c.full_name ilike '%'||normalized_search||'%'
  ),filtered as materialized(select * from base where normalized_status='all' or (normalized_status='contract_pending' and contract_review_status='pending_review') or (normalized_status='cashback_enabled' and cashback_enabled) or (normalized_status='cashback_disabled' and not cashback_enabled) or status::text=normalized_status),paged as(select * from filtered order by full_name,id limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'clientId',p.id,'publicId',p.public_id,'fullName',p.full_name,'email',p.email,'phone',p.phone_e164,'status',p.status,'createdAt',p.created_at,'archivedAt',p.archived_at,'archiveReason',p.archive_reason,'contractReviewStatus',p.contract_review_status,'registrationSource',p.registration_source,'rowVersion',p.row_version,'contract',coalesce(p.contract_json,'null'::jsonb),'pointsBalance',p.total_points,'totalPoints',p.total_points,'generatedSavings',p.generated_savings,'programsCount',p.programs_count,'activeClubsCount',p.active_clubs_count,'nextExpirationDate',p.next_expiration_date,'expiringPoints',p.expiring_points,'lastMovementAt',p.last_movement_at,'cashbackEnabled',p.cashback_enabled,'cashbackDefaultPercentage',p.cashback_default_percentage,'cashbackAvailable',p.cashback_available,'cashbackGenerated',p.cashback_generated) order by p.full_name,p.id) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset,'counts',jsonb_build_object('all',(select count(*) from base),'active',(select count(*) from base where status='active'),'leads',(select count(*) from base where status='lead'),'archived',(select count(*) from base where status='ended'),'contractPending',(select count(*) from base where contract_review_status='pending_review'),'cashbackEnabled',(select count(*) from base where cashback_enabled))));
end; $$;

create or replace function public.get_admin_client_dashboard_preview(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  return public.build_public_client_dashboard_payload(p_client_id)||jsonb_build_object('savingsHistory',public.build_public_client_savings_history(p_client_id),'cashback',public.build_public_client_cashback(p_client_id));
end; $$;

revoke all on function public.admin_update_travel_saving(uuid,date,public.redemption_type,text,numeric,numeric,numeric,text,timestamptz),public.admin_cancel_travel_saving(uuid,text,timestamptz),public.get_travel_sales(uuid,date,date,integer,integer,public.redemption_type,boolean),public.build_public_client_savings_history(uuid),public.get_admin_clients(integer,integer,text,text),public.get_admin_client_dashboard_preview(uuid) from public,anon;
grant execute on function public.admin_update_travel_saving(uuid,date,public.redemption_type,text,numeric,numeric,numeric,text,timestamptz),public.admin_cancel_travel_saving(uuid,text,timestamptz),public.get_travel_sales(uuid,date,date,integer,integer,public.redemption_type,boolean),public.get_admin_clients(integer,integer,text,text),public.get_admin_client_dashboard_preview(uuid) to authenticated;
grant execute on function public.build_public_client_savings_history(uuid) to service_role;

notify pgrst,'reload schema';
commit;
