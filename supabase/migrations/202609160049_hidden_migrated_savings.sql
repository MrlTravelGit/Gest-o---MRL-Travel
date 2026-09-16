begin;

create table if not exists public.client_savings_hidden_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source text not null default 'unknown',
  source_id text,
  title text not null,
  launched_on date,
  original_amount numeric,
  paid_amount numeric,
  saved_amount numeric,
  match_key text not null,
  hidden_reason text,
  hidden_by uuid references auth.users(id) on delete set null,
  hidden_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint client_savings_hidden_items_match_key_not_blank check (length(trim(match_key)) > 0),
  constraint client_savings_hidden_items_client_match_unique unique(client_id,match_key)
);

create index if not exists client_savings_hidden_items_client_id_idx
  on public.client_savings_hidden_items(client_id);
create index if not exists client_savings_hidden_items_match_key_idx
  on public.client_savings_hidden_items(match_key);

alter table public.client_savings_hidden_items enable row level security;
alter table public.client_savings_hidden_items force row level security;
revoke all on public.client_savings_hidden_items from public,anon,authenticated;
grant all on public.client_savings_hidden_items to service_role;

create or replace function public.normalize_savings_match_text(p_value text)
returns text language sql immutable parallel safe set search_path=pg_catalog,public as $$
  select trim(both '-' from regexp_replace(regexp_replace(
    translate(lower(trim(coalesce(p_value,''))),
      'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
      'aaaaaaeeeeiiiiooooouuuucnyy'),
    '[$.,]','','g'),'[^a-z0-9]+','-','g'));
$$;

create or replace function public.build_savings_match_key(
  p_client_id uuid,p_source text,p_source_id text,p_title text,p_launched_on date,
  p_original_amount numeric,p_paid_amount numeric,p_saved_amount numeric
)
returns text language sql immutable parallel safe set search_path=pg_catalog,public as $$
  select case when nullif(public.normalize_savings_match_text(p_source_id),'') is not null then
    public.normalize_savings_match_text(p_client_id::text)||'|'||
    coalesce(nullif(public.normalize_savings_match_text(p_source),''),'unknown')||'|'||
    public.normalize_savings_match_text(p_source_id)
  else concat_ws('|',
    public.normalize_savings_match_text(p_client_id::text),
    coalesce(nullif(public.normalize_savings_match_text(p_source),''),'unknown'),
    'sem-id',coalesce(nullif(public.normalize_savings_match_text(p_title),''),'sem-titulo'),
    coalesce(to_char(p_launched_on,'YYYY-MM-DD'),'sem-data'),
    to_char(round(coalesce(p_original_amount,0),2),'FM999999999999990.00'),
    to_char(round(coalesce(p_paid_amount,0),2),'FM999999999999990.00'),
    to_char(round(coalesce(p_saved_amount,0),2),'FM999999999999990.00')) end;
$$;

create or replace function public.admin_hide_travel_saving(
  p_redemption_id uuid,p_reason text,p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  actor uuid:=auth.uid(); saving public.redemptions%rowtype; saving_key text; saving_source text; saving_source_id text;
  already_hidden boolean:=false;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'HIDE_REASON_REQUIRED' using errcode='22023'; end if;
  select * into saving from public.redemptions where id=p_redemption_id for update;
  if saving.id is null or saving.payment_mode is null then raise exception 'SAVING_NOT_FOUND' using errcode='P0002'; end if;

  saving_source:=coalesce(nullif(trim(saving.source_system),''),'redemptions');
  saving_source_id:=coalesce(nullif(trim(saving.source_external_key),''),saving.id::text);
  saving_key:=public.build_savings_match_key(saving.client_id,saving_source,saving_source_id,saving.description,
    saving.launched_on,saving.cash_reference_total,saving.effective_cost,saving.savings_amount);
  select exists(select 1 from public.client_savings_hidden_items h where h.client_id=saving.client_id and h.match_key=saving_key)
    into already_hidden;
  if already_hidden then
    return jsonb_build_object('redemptionId',saving.id,'status','hidden','matchKey',saving_key,
      'idempotentReplay',true,'summary',public.cashback_snapshot(saving.client_id));
  end if;
  if p_expected_updated_at is not null and saving.updated_at<>p_expected_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;

  insert into public.client_savings_hidden_items(
    client_id,source,source_id,title,launched_on,original_amount,paid_amount,saved_amount,
    match_key,hidden_reason,hidden_by,hidden_at
  ) values (
    saving.client_id,saving_source,saving_source_id,saving.description,saving.launched_on,
    saving.cash_reference_total,saving.effective_cost,saving.savings_amount,saving_key,trim(p_reason),actor,clock_timestamp()
  );

  update public.redemptions set
    status=case when status='confirmed' then 'voided'::public.redemption_status else status end,
    voided_at=coalesce(voided_at,clock_timestamp()),voided_by=coalesce(voided_by,actor),
    void_reason=coalesce(void_reason,'Ocultada do painel: '||trim(p_reason)),updated_at=clock_timestamp(),
    notes=concat_ws(E'\n',notes,'Ocultada administrativamente: '||trim(p_reason))
  where id=saving.id;
  update public.cashback_transactions set visibility_scope='admin_only' where redemption_id=saving.id;

  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,saving.client_id,'hide_travel_saving','client_savings_hidden_items',saving.id::text,
    jsonb_build_object('status',saving.status,'source',saving_source,'sourceId',saving_source_id,
      'savingsValue',saving.savings_amount,'cashbackAmount',saving.cashback_amount),
    jsonb_build_object('status','hidden','matchKey',saving_key,'reason',trim(p_reason),'originalPreserved',true));
  return jsonb_build_object('redemptionId',saving.id,'status','hidden','matchKey',saving_key,
    'idempotentReplay',false,'summary',public.cashback_snapshot(saving.client_id));
end; $$;

create or replace function public.cashback_snapshot(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with official_earnings as (
    select coalesce(sum(r.cashback_amount),0)::numeric generated from public.redemptions r
    where r.client_id=p_client_id and r.status='confirmed' and r.deleted_at is null
      and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
        r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),
        r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount))
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
      and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
        r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),
        r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount))
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
    'migrated',r.source_system is not null,'sourceSystem',r.source_system,'sourceExternalKey',r.source_external_key,
    'matchKey',public.build_savings_match_key(r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount),
    'status',r.status,'deletedAt',r.deleted_at,'cashbackPercentage',r.cashback_percentage,'cashbackAmount',r.cashback_amount,
    'cashbackBaseType',r.cashback_base_type,'cashbackBaseAmount',r.cashback_base_amount,
    'cashbackCalculationVersion',r.cashback_calculation_version,
    'hasEvidence',exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active')
  ) order by r.launched_on desc,r.created_at desc),'[]'::jsonb)
  from public.redemptions r join public.clients c on c.id=r.client_id
  where r.client_id=p_client_id and c.status='active' and r.status='confirmed' and r.deleted_at is null
    and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
      r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),
      r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount));
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
      public.build_savings_match_key(r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount) match_key,
      exists(select 1 from public.saving_evidence_files e where e.redemption_id=r.id and e.status='active') has_evidence,
      case when r.status in ('cancelled','voided') then 'voided' else 'active' end public_status
    from public.redemptions r join public.clients c on c.id=r.client_id
    left join public.program_accounts pa on pa.id=r.travel_account_id left join public.loyalty_programs lp on lp.id=pa.program_id
    where r.payment_mode is not null and r.deleted_at is null
      and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
        r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount))
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
      'sourceBatchKey',p.source_batch_key,'sourceExternalKey',p.source_external_key,'matchKey',p.match_key,
      'migrated',p.source_system is not null,'updatedAt',p.updated_at,
      'cashbackPercentage',p.cashback_percentage,'cashbackAmount',p.cashback_amount,'cashbackBaseType',p.cashback_base_type,
      'cashbackBaseAmount',p.cashback_base_amount,'cashbackCalculationVersion',p.cashback_calculation_version,'hasEvidence',p.has_evidence,
      'status',p.public_status,'deletedAt',p.deleted_at,'deletedBy',p.deleted_by,'deletionReason',p.deletion_reason,
      'voidedAt',p.voided_at,'voidedBy',p.voided_by,'voidReason',p.void_reason,'operationGroupId',p.operation_group_id
    ) order by p.launched_on desc,p.created_at desc) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),'totalSavings',coalesce((select sum(savings_amount) from filtered where public_status='active'),0),
    'totalCashback',coalesce((select sum(cashback_amount) from filtered where public_status='active'),0),'limit',safe_limit,'offset',safe_offset,
    'ranking',coalesce((select jsonb_agg(jsonb_build_object('position',r.position,'clientId',r.client_id,'clientName',r.full_name,'totalSavings',r.total_savings,'records',r.records) order by r.position) from ranking r),'[]'::jsonb),
    'hiddenKeys',case when p_client_id is null then '[]'::jsonb else coalesce((select jsonb_agg(h.match_key) from public.client_savings_hidden_items h where h.client_id=p_client_id),'[]'::jsonb) end,
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
      and (t.redemption_id is null or exists(select 1 from public.redemptions r where r.id=t.redemption_id and r.deleted_at is null
        and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
          r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),
          r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount))))),'[]'::jsonb),
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
    'generatedSavings',coalesce((select sum(r.savings_amount) from public.redemptions r where r.status='confirmed' and r.deleted_at is null
      and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
        r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount))),0),
    'expiringIn30Days',coalesce((select sum(remaining_points) from public.expiration_lots where status='active' and expires_on between current_date and current_date+30),0),
    'contractsEndingIn30Days',(select count(*) from public.management_contracts where status='active' and ends_on between current_date and current_date+30),
    'openTasks',(select count(*) from public.tasks where status in ('open','in_progress')),'openInterests',(select count(*) from public.travel_interests where status::text in ('waiting','in_progress')),
    'transfersCount',(select count(*) from public.transfers),'operatorName',coalesce((select split_part(trim(p.full_name),' ',1) from public.profiles p where p.id=actor_id),'Equipe MRL'),
    'role',(select sm.role from public.staff_members sm where sm.user_id=actor_id and sm.active),'canWrite',public.can_write_client_data(),'canArchive',public.can_manage_security());
end; $$;

create or replace function public.build_public_client_dashboard_payload(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_set(
    jsonb_set(public.build_public_client_dashboard_payload_pre_soft_delete(p_client_id),'{summary,generatedSavings}',
      to_jsonb(coalesce((select sum(r.savings_amount) from public.redemptions r where r.client_id=p_client_id and r.status='confirmed' and r.deleted_at is null
        and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
          r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount))),0)),true),
    '{summary,redemptionsCount}',
    to_jsonb((select count(*) from public.redemptions r where r.client_id=p_client_id and r.status='confirmed' and r.deleted_at is null
      and not exists(select 1 from public.client_savings_hidden_items h where h.client_id=r.client_id and h.match_key=public.build_savings_match_key(
        r.client_id,coalesce(nullif(r.source_system,''),'redemptions'),coalesce(nullif(r.source_external_key,''),r.id::text),r.description,r.launched_on,r.cash_reference_total,r.effective_cost,r.savings_amount)))),true);
$$;

revoke all on function public.normalize_savings_match_text(text),public.build_savings_match_key(uuid,text,text,text,date,numeric,numeric,numeric),public.admin_hide_travel_saving(uuid,text,timestamptz) from public,anon;
grant execute on function public.admin_hide_travel_saving(uuid,text,timestamptz) to authenticated;
revoke all on function public.get_travel_sales_v2(uuid,date,date,integer,integer,public.redemption_type,boolean,text),public.get_admin_client_cashback(uuid),public.get_admin_overview() from public,anon;
grant execute on function public.get_travel_sales_v2(uuid,date,date,integer,integer,public.redemption_type,boolean,text),public.get_admin_client_cashback(uuid),public.get_admin_overview() to authenticated;
revoke all on function public.cashback_snapshot(uuid),public.build_public_client_cashback(uuid),public.build_public_client_savings_history(uuid),public.build_public_client_dashboard_payload(uuid) from public,anon,authenticated;
grant execute on function public.normalize_savings_match_text(text),public.build_savings_match_key(uuid,text,text,text,date,numeric,numeric,numeric),public.cashback_snapshot(uuid),public.build_public_client_cashback(uuid),public.build_public_client_savings_history(uuid),public.build_public_client_dashboard_payload(uuid) to service_role;

notify pgrst,'reload schema';
commit;
