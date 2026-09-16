begin;

alter table public.redemptions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists deletion_reason text;

create index if not exists redemptions_visible_savings_idx
  on public.redemptions(client_id,launched_on desc,created_at desc)
  where deleted_at is null and payment_mode is not null;

create or replace function public.admin_delete_travel_saving(
  p_redemption_id uuid,p_reason text,p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); saving public.redemptions%rowtype; void_result jsonb; replay boolean:=false;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'DELETE_REASON_REQUIRED' using errcode='22023'; end if;
  select * into saving from public.redemptions where id=p_redemption_id for update;
  if saving.id is null or saving.payment_mode is null then raise exception 'SAVING_NOT_FOUND' using errcode='P0002'; end if;
  if saving.deleted_at is not null then
    return jsonb_build_object('redemptionId',saving.id,'status','deleted','idempotentReplay',true,'summary',public.cashback_snapshot(saving.client_id));
  end if;
  if p_expected_updated_at is not null and saving.updated_at<>p_expected_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
  if saving.status='confirmed' then
    void_result:=public.admin_void_travel_saving(saving.id,p_reason,p_expected_updated_at);
  elsif saving.status not in ('cancelled','voided') then
    raise exception 'SAVING_NOT_ACTIVE' using errcode='55000';
  end if;
  update public.redemptions set deleted_at=clock_timestamp(),deleted_by=actor,deletion_reason=trim(p_reason),
    updated_at=clock_timestamp(),notes=concat_ws(E'\n',notes,'Excluída administrativamente: '||trim(p_reason))
  where id=saving.id;
  update public.cashback_transactions set visibility_scope='admin_only' where redemption_id=saving.id;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,saving.client_id,'delete_travel_saving','redemptions',saving.id::text,
    jsonb_build_object('status',saving.status,'deletedAt',saving.deleted_at,'savingsValue',saving.savings_amount,'cashbackAmount',saving.cashback_amount),
    jsonb_build_object('status','deleted','reason',trim(p_reason),'softDelete',true));
  return jsonb_build_object('redemptionId',saving.id,'status','deleted','idempotentReplay',replay,'summary',public.cashback_snapshot(saving.client_id));
end; $$;

create or replace function public.cashback_snapshot(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with official_earnings as (
    select coalesce(sum(r.cashback_amount),0)::numeric generated from public.redemptions r
    where r.client_id=p_client_id and r.status='confirmed' and r.deleted_at is null
  ), standalone as (
    select
      coalesce(sum(t.amount) filter(where t.transaction_type='redemption' and coalesce(t.redemption_mode,'usage')='usage'),0)::numeric used,
      coalesce(sum(t.amount) filter(where t.transaction_type='redemption' and t.redemption_mode='payment'),0)::numeric paid,
      coalesce(sum(t.amount) filter(where t.transaction_type='reversal'),0)::numeric reversed,
      coalesce(sum(t.amount) filter(where t.transaction_type='adjustment'),0)::numeric adjusted
    from public.cashback_transactions t where t.client_id=p_client_id and t.status='confirmed' and t.redemption_id is null
  ) select jsonb_build_object('generated',round(e.generated,2),'used',round(s.used,2),'paid',round(s.paid,2),
    'reversed',round(s.reversed,2),'adjusted',round(s.adjusted,2),'available',round(e.generated+s.adjusted-s.used-s.paid-s.reversed,2))
  from official_earnings e cross join standalone s;
$$;

create or replace function public.build_public_client_cashback(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with client_row as (select c.id,c.cashback_enabled from public.clients c where c.id=p_client_id and c.status='active'),
  public_entries as (
    select r.id,'earning'::text type,r.cashback_amount amount,'Cashback da reserva: '||r.description description,r.id redemption_id,r.created_at
    from public.redemptions r join client_row c on c.id=r.client_id
    where r.status='confirmed' and r.deleted_at is null and r.cashback_amount>0
    union all
    select t.id,t.transaction_type,t.amount,t.description,null::uuid,t.created_at
    from public.cashback_transactions t join client_row c on c.id=t.client_id
    where t.status='confirmed' and t.redemption_id is null and t.visibility_scope='public'
  ) select jsonb_build_object('enabled',coalesce((select cashback_enabled from client_row),false),
    'summary',public.cashback_snapshot(p_client_id),'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'type',e.type,'amount',e.amount,'description',e.description,'redemptionId',e.redemption_id,'createdAt',e.created_at
    ) order by e.created_at desc,e.id desc) from public_entries e),'[]'::jsonb));
$$;

create or replace function public.build_public_client_savings_history(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'date',r.launched_on,'description',r.description,'originalValue',r.cash_reference_total,
    'paidValue',r.effective_cost,'savingsValue',r.savings_amount,'travelType',r.redemption_type,
    'migrated',r.source_system='iddas','cashbackPercentage',r.cashback_percentage,'cashbackAmount',r.cashback_amount,
    'cashbackBaseType',r.cashback_base_type,'cashbackBaseAmount',r.cashback_base_amount,
    'cashbackCalculationVersion',r.cashback_calculation_version,
    'hasEvidence',exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active')
  ) order by r.launched_on desc,r.created_at desc),'[]'::jsonb)
  from public.redemptions r join public.clients c on c.id=r.client_id
  where r.client_id=p_client_id and c.status='active' and r.status='confirmed' and r.deleted_at is null;
$$;

drop function if exists public.get_travel_sales_v2(uuid,date,date,integer,integer,public.redemption_type,boolean,text);
create function public.get_travel_sales_v2(
  p_client_id uuid default null,p_start_date date default null,p_end_date date default null,
  p_limit integer default 20,p_offset integer default 0,p_travel_type public.redemption_type default null,
  p_has_cashback boolean default null,p_status text default 'active'
)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0);
  normalized_status text:=lower(coalesce(nullif(trim(p_status),''),'active'));
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if normalized_status not in ('active','voided','all') then raise exception 'INVALID_STATUS' using errcode='22023'; end if;
  if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'INVALID_PERIOD' using errcode='22007'; end if;
  return (with filtered as materialized(
    select r.*,c.full_name,lp.name program_name,
      exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active') has_evidence,
      case when r.status in ('cancelled','voided') then 'voided' else 'active' end public_status
    from public.redemptions r join public.clients c on c.id=r.client_id
    left join public.program_accounts pa on pa.id=r.travel_account_id left join public.loyalty_programs lp on lp.id=pa.program_id
    where r.payment_mode is not null and r.deleted_at is null
      and (normalized_status='all' or (normalized_status='active' and r.status='confirmed') or (normalized_status='voided' and r.status in ('cancelled','voided')))
      and (p_client_id is null or r.client_id=p_client_id) and (p_start_date is null or r.launched_on>=p_start_date)
      and (p_end_date is null or r.launched_on<=p_end_date) and (p_travel_type is null or r.redemption_type=p_travel_type)
      and (p_has_cashback is null or (r.cashback_amount>0)=p_has_cashback)
  ),paged as(select * from filtered order by launched_on desc,created_at desc limit safe_limit offset safe_offset),
  ranking as(select client_id,full_name,sum(savings_amount) total_savings,count(*) records,
    row_number() over(order by sum(savings_amount) desc,full_name,client_id) position from filtered where public_status='active' group by client_id,full_name)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'clientId',p.client_id,'clientName',p.full_name,'launchedOn',p.launched_on,'paymentMode',p.payment_mode,
      'travelType',p.redemption_type,'details',p.description,'originalValue',p.cash_reference_total,'paidValue',p.effective_cost,
      'savingsAmount',p.savings_amount,'programName',p.program_name,'pointsUsed',p.travel_points_used,'sourceSystem',p.source_system,
      'sourceBatchKey',p.source_batch_key,'migrated',p.source_system='iddas','updatedAt',p.updated_at,
      'cashbackPercentage',p.cashback_percentage,'cashbackAmount',p.cashback_amount,'cashbackBaseType',p.cashback_base_type,
      'cashbackBaseAmount',p.cashback_base_amount,'cashbackCalculationVersion',p.cashback_calculation_version,'hasEvidence',p.has_evidence,
      'status',p.public_status,'deletedAt',p.deleted_at,'deletedBy',p.deleted_by,'deletionReason',p.deletion_reason,
      'voidedAt',p.voided_at,'voidedBy',p.voided_by,'voidReason',p.void_reason,'operationGroupId',p.operation_group_id
    ) order by p.launched_on desc,p.created_at desc) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),'totalSavings',coalesce((select sum(savings_amount) from filtered where public_status='active'),0),
    'totalCashback',coalesce((select sum(cashback_amount) from filtered where public_status='active'),0),'limit',safe_limit,'offset',safe_offset,
    'ranking',coalesce((select jsonb_agg(jsonb_build_object('position',r.position,'clientId',r.client_id,'clientName',r.full_name,'totalSavings',r.total_savings,'records',r.records) order by r.position) from ranking r),'[]'::jsonb),
    'pendingReconciliation',(select count(*) from public.iddas_savings_reconciliations where status in ('pending','conflict')),
    'canWrite',public.can_write_client_data(),'selectedClientCashback',case when p_client_id is null then null else
      (select jsonb_build_object('enabled',c.cashback_enabled,'defaultPercentage',c.cashback_default_percentage,'summary',public.cashback_snapshot(c.id)) from public.clients c where c.id=p_client_id) end
  ));
end; $$;

create or replace function public.get_admin_client_cashback(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.clients%rowtype;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into c from public.clients where id=p_client_id;
  if c.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('config',jsonb_build_object('enabled',c.cashback_enabled,'defaultPercentage',c.cashback_default_percentage,
    'enabledAt',c.cashback_enabled_at,'enabledBy',c.cashback_enabled_by,'updatedAt',c.cashback_config_updated_at,'updatedBy',c.cashback_config_updated_by),
    'summary',public.cashback_snapshot(p_client_id),'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'type',t.transaction_type,'amount',t.amount,'status',t.status,'description',t.description,
      'redemptionId',t.redemption_id,'reversedTransactionId',t.reversed_transaction_id,'createdAt',t.created_at,
      'operationGroupId',t.operation_group_id,'visibilityScope',t.visibility_scope,'originKind',t.origin_kind,'redemptionMode',t.redemption_mode
    ) order by t.created_at desc,t.id desc) from public.cashback_transactions t where t.client_id=p_client_id
      and (t.redemption_id is null or exists(select 1 from public.redemptions r where r.id=t.redemption_id and r.deleted_at is null))),'[]'::jsonb),
    'canManage',public.has_staff_role(array['super_admin','manager']::public.app_role[]));
end; $$;

create or replace function public.get_admin_overview()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor_id uuid:=auth.uid();
begin
  if actor_id is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return jsonb_build_object('activeClients',(select count(*) from public.clients where status='active'),
    'pendingLeads',(select count(*) from public.clients where status='lead'),
    'managedPoints',coalesce((select sum(coalesce(latest.balance,0)) from public.program_accounts pa left join lateral(select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1) latest on true where pa.active),0),
    'generatedSavings',coalesce((select sum(savings_amount) from public.redemptions where status='confirmed' and deleted_at is null),0),
    'expiringIn30Days',coalesce((select sum(remaining_points) from public.expiration_lots where status='active' and expires_on between current_date and current_date+30),0),
    'contractsEndingIn30Days',(select count(*) from public.management_contracts where status='active' and ends_on between current_date and current_date+30),
    'openTasks',(select count(*) from public.tasks where status in ('open','in_progress')),'openInterests',(select count(*) from public.travel_interests where status::text in ('waiting','in_progress')),
    'transfersCount',(select count(*) from public.transfers),'operatorName',coalesce((select split_part(trim(p.full_name),' ',1) from public.profiles p where p.id=actor_id),'Equipe MRL'),
    'role',(select sm.role from public.staff_members sm where sm.user_id=actor_id and sm.active),'canWrite',public.can_write_client_data(),'canArchive',public.can_manage_security());
end; $$;

do $$ begin
  if to_regprocedure('public.build_public_client_dashboard_payload_pre_soft_delete(uuid)') is null then
    alter function public.build_public_client_dashboard_payload(uuid) rename to build_public_client_dashboard_payload_pre_soft_delete;
  end if;
end $$;
create or replace function public.build_public_client_dashboard_payload(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_set(
    jsonb_set(public.build_public_client_dashboard_payload_pre_soft_delete(p_client_id),'{summary,generatedSavings}',
      to_jsonb(coalesce((select sum(r.savings_amount) from public.redemptions r where r.client_id=p_client_id and r.status='confirmed' and r.deleted_at is null),0)),true),
    '{summary,redemptionsCount}',
    to_jsonb((select count(*) from public.redemptions r where r.client_id=p_client_id and r.status='confirmed' and r.deleted_at is null)),true);
$$;

revoke all on function public.admin_delete_travel_saving(uuid,text,timestamptz) from public,anon;
grant execute on function public.admin_delete_travel_saving(uuid,text,timestamptz) to authenticated;
revoke all on function public.get_travel_sales_v2(uuid,date,date,integer,integer,public.redemption_type,boolean,text),public.get_admin_client_cashback(uuid),public.get_admin_overview() from public,anon;
grant execute on function public.get_travel_sales_v2(uuid,date,date,integer,integer,public.redemption_type,boolean,text),public.get_admin_client_cashback(uuid),public.get_admin_overview() to authenticated;
revoke all on function public.cashback_snapshot(uuid),public.build_public_client_cashback(uuid),public.build_public_client_savings_history(uuid),public.build_public_client_dashboard_payload(uuid),public.build_public_client_dashboard_payload_pre_soft_delete(uuid) from public,anon,authenticated;
grant execute on function public.cashback_snapshot(uuid),public.build_public_client_cashback(uuid),public.build_public_client_savings_history(uuid),public.build_public_client_dashboard_payload(uuid),public.build_public_client_dashboard_payload_pre_soft_delete(uuid) to service_role;

notify pgrst,'reload schema';
commit;
