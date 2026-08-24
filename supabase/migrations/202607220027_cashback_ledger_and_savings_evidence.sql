begin;

-- PATCH MRL 20260722-023: cashback por economia e comprovante privado opcional.
alter table public.clients
  add column if not exists cashback_enabled boolean not null default false,
  add column if not exists cashback_enabled_at timestamptz,
  add column if not exists cashback_enabled_by uuid references auth.users(id) on delete set null,
  add column if not exists cashback_default_percentage numeric(5,2),
  add column if not exists cashback_config_updated_at timestamptz,
  add column if not exists cashback_config_updated_by uuid references auth.users(id) on delete set null;

alter table public.clients drop constraint if exists clients_cashback_default_percentage_valid;
alter table public.clients add constraint clients_cashback_default_percentage_valid
  check (cashback_default_percentage is null or (cashback_default_percentage>0 and cashback_default_percentage<=100));

alter table public.redemptions
  add column if not exists cashback_percentage numeric(5,2),
  add column if not exists cashback_amount numeric(14,2) not null default 0,
  add column if not exists cashback_calculation_version text,
  add column if not exists cashback_calculated_at timestamptz;

alter table public.redemptions drop constraint if exists redemptions_cashback_percentage_valid;
alter table public.redemptions drop constraint if exists redemptions_cashback_amount_valid;
alter table public.redemptions add constraint redemptions_cashback_percentage_valid
  check (cashback_percentage is null or (cashback_percentage>0 and cashback_percentage<=100));
alter table public.redemptions add constraint redemptions_cashback_amount_valid check (cashback_amount>=0);

create table public.cashback_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  redemption_id uuid references public.redemptions(id) on delete restrict,
  transaction_type text not null,
  amount numeric(14,2) not null,
  status text not null default 'confirmed',
  description text not null,
  source_external_key text unique,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reversed_transaction_id uuid references public.cashback_transactions(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  constraint cashback_transaction_type_valid check (transaction_type in ('earning','redemption','reversal','adjustment')),
  constraint cashback_transaction_status_valid check (status in ('confirmed','void')),
  constraint cashback_transaction_amount_valid check (
    (transaction_type='adjustment' and amount<>0) or (transaction_type<>'adjustment' and amount>0)
  ),
  constraint cashback_transaction_metadata_object check (jsonb_typeof(metadata)='object'),
  constraint cashback_reversal_reference_valid check ((transaction_type='reversal')=(reversed_transaction_id is not null))
);
create index cashback_transactions_client_idx on public.cashback_transactions(client_id,created_at desc);
create index cashback_transactions_redemption_idx on public.cashback_transactions(redemption_id,created_at desc) where redemption_id is not null;
create unique index cashback_reversal_once_idx on public.cashback_transactions(reversed_transaction_id) where transaction_type='reversal' and status='confirmed';

create table public.cashback_transaction_allocations (
  redemption_transaction_id uuid not null references public.cashback_transactions(id) on delete restrict,
  earning_transaction_id uuid not null references public.cashback_transactions(id) on delete restrict,
  amount numeric(14,2) not null check (amount>0),
  created_at timestamptz not null default now(),
  primary key(redemption_transaction_id,earning_transaction_id),
  constraint cashback_allocation_not_self check (redemption_transaction_id<>earning_transaction_id)
);
create index cashback_allocations_earning_idx on public.cashback_transaction_allocations(earning_transaction_id);

create table public.saving_evidence_files (
  id uuid primary key,
  client_id uuid not null references public.clients(id) on delete restrict,
  redemption_id uuid not null references public.redemptions(id) on delete restrict,
  bucket_id text not null default 'savings-evidence',
  object_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes>0 and size_bytes<=10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending',
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null,
  removal_reason text,
  constraint saving_evidence_bucket_fixed check (bucket_id='savings-evidence'),
  constraint saving_evidence_mime_valid check (mime_type in ('image/png','image/jpeg','image/webp')),
  constraint saving_evidence_status_valid check (status in ('pending','active','removed'))
);
create unique index saving_evidence_one_active_idx on public.saving_evidence_files(redemption_id) where status='active';
create index saving_evidence_pending_idx on public.saving_evidence_files(status,created_at) where status='pending';

alter table public.cashback_transactions enable row level security;
alter table public.cashback_transactions force row level security;
alter table public.cashback_transaction_allocations enable row level security;
alter table public.cashback_transaction_allocations force row level security;
alter table public.saving_evidence_files enable row level security;
alter table public.saving_evidence_files force row level security;

create policy cashback_transactions_staff_read on public.cashback_transactions for select to authenticated using (public.is_staff());
create policy cashback_allocations_staff_read on public.cashback_transaction_allocations for select to authenticated using (public.is_staff());
create policy saving_evidence_staff_read on public.saving_evidence_files for select to authenticated using (public.is_staff());
revoke insert,update,delete on public.cashback_transactions,public.cashback_transaction_allocations,public.saving_evidence_files from authenticated;
grant all on public.cashback_transactions,public.cashback_transaction_allocations,public.saving_evidence_files to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('savings-evidence','savings-evidence',false,10485760,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.cashback_deterministic_uuid(p_value text)
returns uuid language sql immutable set search_path=pg_catalog as $$
  select (substr(x,1,8)||'-'||substr(x,9,4)||'-'||substr(x,13,4)||'-'||substr(x,17,4)||'-'||substr(x,21,12))::uuid
  from (select md5('mrl:cashback:'||p_value) x) s;
$$;

create or replace function public.cashback_amount_for(p_savings numeric,p_percentage numeric)
returns numeric language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_percentage is null or coalesce(p_savings,0)<=0 then return 0::numeric(14,2); end if;
  if p_percentage<=0 or p_percentage>100 then raise exception 'INVALID_CASHBACK_PERCENTAGE' using errcode='22023'; end if;
  return round(p_savings*p_percentage/100,2)::numeric(14,2);
end; $$;

create or replace function public.cashback_snapshot(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with totals as (
    select
      coalesce(sum(amount) filter(where transaction_type='earning' and status='confirmed'),0) generated,
      coalesce(sum(amount) filter(where transaction_type='redemption' and status='confirmed'),0) used,
      coalesce(sum(amount) filter(where transaction_type='reversal' and status='confirmed'),0) reversed,
      coalesce(sum(amount) filter(where transaction_type='adjustment' and status='confirmed'),0) adjusted
    from public.cashback_transactions where client_id=p_client_id
  ) select jsonb_build_object('generated',generated,'used',used,'reversed',reversed,'adjusted',adjusted,'available',generated+adjusted-used-reversed) from totals;
$$;

create or replace function public.update_client_cashback_config(p_client_id uuid,p_enabled boolean,p_default_percentage numeric,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); before_row public.clients%rowtype; after_row public.clients%rowtype;
begin
  if actor is null or not public.has_staff_role(array['super_admin','manager']::public.app_role[]) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_default_percentage is not null and (p_default_percentage<=0 or p_default_percentage>100) then raise exception 'INVALID_CASHBACK_PERCENTAGE' using errcode='22023'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'CHANGE_REASON_REQUIRED' using errcode='22023'; end if;
  select * into before_row from public.clients where id=p_client_id for update;
  if before_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  update public.clients set cashback_enabled=coalesce(p_enabled,false),cashback_default_percentage=case when p_enabled then round(p_default_percentage,2) else null end,
    cashback_enabled_at=case when p_enabled and not before_row.cashback_enabled then clock_timestamp() else cashback_enabled_at end,
    cashback_enabled_by=case when p_enabled and not before_row.cashback_enabled then actor else cashback_enabled_by end,
    cashback_config_updated_at=clock_timestamp(),cashback_config_updated_by=actor,updated_at=clock_timestamp()
  where id=p_client_id returning * into after_row;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,p_client_id,'update_client_cashback_config','clients',p_client_id::text,
    jsonb_build_object('enabled',before_row.cashback_enabled,'defaultPercentage',before_row.cashback_default_percentage),
    jsonb_build_object('enabled',after_row.cashback_enabled,'defaultPercentage',after_row.cashback_default_percentage,'reason',trim(p_reason)));
  return jsonb_build_object('clientId',p_client_id,'enabled',after_row.cashback_enabled,'defaultPercentage',after_row.cashback_default_percentage,'updatedAt',after_row.cashback_config_updated_at,'summary',public.cashback_snapshot(p_client_id));
end; $$;

drop function if exists public.record_travel_sale(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid);
create function public.record_travel_sale(
  p_client_id uuid,p_launched_on date,p_payment_mode text,p_travel_type public.redemption_type,p_details text,
  p_original_value numeric,p_paid_value numeric,p_account_id uuid default null,p_points_used bigint default null,
  p_operation_id uuid default gen_random_uuid(),p_cashback_percentage numeric default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); client_row public.clients%rowtype; account_row public.program_accounts%rowtype; current_balance bigint:=0; current_average numeric(14,4):=0; new_balance bigint; program_value numeric(14,4):=0; saving public.redemptions%rowtype; point_tx public.point_transactions%rowtype; existing public.redemptions%rowtype; effective_percentage numeric(5,2); calculated_cashback numeric(14,2); earning_id uuid;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_launched_on is null or p_launched_on>current_date then raise exception 'INVALID_DATE' using errcode='22007'; end if;
  if p_payment_mode not in ('cash','miles') then raise exception 'INVALID_PAYMENT_MODE' using errcode='22023'; end if;
  if char_length(trim(coalesce(p_details,'')))<3 then raise exception 'DETAILS_REQUIRED' using errcode='22023'; end if;
  if p_original_value is null or p_original_value<0 or p_paid_value is null or p_paid_value<0 then raise exception 'INVALID_VALUES' using errcode='22003'; end if;
  select * into client_row from public.clients where id=p_client_id and status='active' for update;
  if client_row.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  effective_percentage:=case when client_row.cashback_enabled then p_cashback_percentage else null end;
  if effective_percentage is not null and (effective_percentage<=0 or effective_percentage>100) then raise exception 'INVALID_CASHBACK_PERCENTAGE' using errcode='22023'; end if;
  calculated_cashback:=public.cashback_amount_for(round(p_original_value,2)-round(p_paid_value,2),effective_percentage);
  select * into existing from public.redemptions where operation_id=p_operation_id;
  if existing.id is not null then
    if existing.client_id<>p_client_id or existing.launched_on<>p_launched_on or existing.payment_mode<>p_payment_mode or existing.cash_reference_total<>round(p_original_value,2) or existing.effective_cost<>round(p_paid_value,2) or existing.travel_account_id is distinct from p_account_id or existing.travel_points_used is distinct from p_points_used or existing.cashback_percentage is distinct from effective_percentage then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    select id into earning_id from public.cashback_transactions where redemption_id=existing.id and transaction_type='earning' order by created_at desc limit 1;
    return jsonb_build_object('saleId',existing.id,'savingsAmount',existing.savings_amount,'cashbackPercentage',existing.cashback_percentage,'cashbackAmount',existing.cashback_amount,'cashbackTransactionId',earning_id,'idempotentReplay',true);
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
  insert into public.redemptions(client_id,redemption_type,description,issued_at,cash_reference_total,taxes_paid,additional_cash_paid,attributed_points_cost,formula_version,reference_captured_at,status,created_by,payment_mode,launched_on,operation_id,travel_account_id,travel_points_used,cashback_percentage,cashback_amount,cashback_calculation_version,cashback_calculated_at)
  values(p_client_id,p_travel_type,trim(p_details),(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo',round(p_original_value,2),0,round(p_paid_value,2),0,'2.1.0',clock_timestamp(),'confirmed',actor,p_payment_mode,p_launched_on,p_operation_id,p_account_id,p_points_used,effective_percentage,calculated_cashback,case when effective_percentage is null then null else 'cashback-1.0.0' end,case when effective_percentage is null then null else clock_timestamp() end) returning * into saving;
  if calculated_cashback>0 then
    insert into public.cashback_transactions(client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,metadata)
    values(p_client_id,saving.id,'earning',calculated_cashback,'confirmed','Cashback da economia: '||trim(p_details),'cashback:earning:'||saving.id||':1',p_operation_id,actor,jsonb_build_object('percentage',effective_percentage,'savingsAmount',saving.savings_amount,'calculationVersion','cashback-1.0.0')) returning id into earning_id;
  end if;
  if p_payment_mode='miles' then
    insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,source,metadata,created_by,entry_date,operation_id) values(account_row.id,(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo','redemption',-p_points_used,'Uso de pontos em viagem: '||trim(p_details),'travel_sale',jsonb_build_object('redemptionId',saving.id),actor,p_launched_on,p_operation_id) returning * into point_tx;
    insert into public.redemption_point_usages(redemption_id,account_id,points_used,value_per_thousand) values(saving.id,account_row.id,p_points_used,current_average);
    perform public.consume_expiration_lots(account_row.id,p_points_used);
    insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,notes,created_by) values(account_row.id,clock_timestamp(),new_balance,current_average,program_value,'travel_sale','Baixa atômica vinculada à viagem',actor);
  end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(actor,p_client_id,'record_travel_sale','redemptions',saving.id::text,jsonb_build_object('savingsAmount',saving.savings_amount,'cashbackPercentage',effective_percentage,'cashbackAmount',calculated_cashback,'cashbackTransactionId',earning_id));
  return jsonb_build_object('saleId',saving.id,'savingsAmount',saving.savings_amount,'cashbackPercentage',effective_percentage,'cashbackAmount',calculated_cashback,'cashbackTransactionId',earning_id,'newBalance',case when p_payment_mode='miles' then new_balance else null end,'idempotentReplay',false);
end; $$;

create or replace function public.record_cashback_redemption(p_client_id uuid,p_amount numeric,p_description text,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); available numeric(14,2); tx public.cashback_transactions%rowtype; earning record; remaining numeric(14,2); allocated numeric(14,2);
begin
  if actor is null or not public.has_staff_role(array['super_admin','manager']::public.app_role[]) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_amount is null or round(p_amount,2)<=0 then raise exception 'INVALID_CASHBACK_AMOUNT' using errcode='22023'; end if;
  if length(trim(coalesce(p_description,'')))<5 then raise exception 'DESCRIPTION_REQUIRED' using errcode='22023'; end if;
  perform 1 from public.clients where id=p_client_id for update;
  if not found then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  select * into tx from public.cashback_transactions where idempotency_key=p_operation_id;
  if tx.id is not null then
    if tx.client_id<>p_client_id or tx.transaction_type<>'redemption' or tx.amount<>round(p_amount,2) then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('transactionId',tx.id,'idempotentReplay',true,'summary',public.cashback_snapshot(p_client_id));
  end if;
  available:=(public.cashback_snapshot(p_client_id)->>'available')::numeric;
  if round(p_amount,2)>available then raise exception 'INSUFFICIENT_CASHBACK_BALANCE' using errcode='23514'; end if;
  insert into public.cashback_transactions(client_id,transaction_type,amount,status,description,idempotency_key,created_by,metadata)
  values(p_client_id,'redemption',round(p_amount,2),'confirmed',trim(p_description),p_operation_id,actor,jsonb_build_object('balanceBefore',available)) returning * into tx;
  remaining:=tx.amount;
  for earning in select e.id,e.amount-coalesce((select sum(a.amount) from public.cashback_transaction_allocations a where a.earning_transaction_id=e.id),0) unallocated from public.cashback_transactions e where e.client_id=p_client_id and e.transaction_type='earning' and e.status='confirmed' and not exists(select 1 from public.cashback_transactions rv where rv.transaction_type='reversal' and rv.reversed_transaction_id=e.id and rv.status='confirmed') order by e.created_at,e.id for update loop
    exit when remaining<=0;allocated:=least(remaining,earning.unallocated);if allocated>0 then insert into public.cashback_transaction_allocations(redemption_transaction_id,earning_transaction_id,amount) values(tx.id,earning.id,allocated);remaining:=remaining-allocated;end if;
  end loop;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(actor,p_client_id,'record_cashback_redemption','cashback_transactions',tx.id::text,jsonb_build_object('amount',tx.amount,'description',tx.description,'balanceBefore',available));
  return jsonb_build_object('transactionId',tx.id,'idempotentReplay',false,'summary',public.cashback_snapshot(p_client_id));
end; $$;

create or replace function public.record_cashback_adjustment(p_client_id uuid,p_amount numeric,p_reason text,p_confirmation boolean,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); tx public.cashback_transactions%rowtype; available numeric;
begin
  if actor is null or not public.has_staff_role(array['super_admin']::public.app_role[]) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not coalesce(p_confirmation,false) then raise exception 'CONFIRMATION_REQUIRED' using errcode='22023'; end if;
  if p_amount is null or round(p_amount,2)=0 then raise exception 'INVALID_CASHBACK_AMOUNT' using errcode='22023'; end if;
  if length(trim(coalesce(p_reason,'')))<8 then raise exception 'ADJUSTMENT_REASON_REQUIRED' using errcode='22023'; end if;
  perform 1 from public.clients where id=p_client_id for update;if not found then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002';end if;
  select * into tx from public.cashback_transactions where idempotency_key=p_operation_id;
  if tx.id is not null then return jsonb_build_object('transactionId',tx.id,'idempotentReplay',true,'summary',public.cashback_snapshot(p_client_id));end if;
  available:=(public.cashback_snapshot(p_client_id)->>'available')::numeric;
  if round(p_amount,2)<0 and available+round(p_amount,2)<0 then raise exception 'INSUFFICIENT_CASHBACK_BALANCE' using errcode='23514';end if;
  insert into public.cashback_transactions(client_id,transaction_type,amount,status,description,idempotency_key,created_by,metadata) values(p_client_id,'adjustment',round(p_amount,2),'confirmed',trim(p_reason),p_operation_id,actor,jsonb_build_object('balanceBefore',available)) returning * into tx;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(actor,p_client_id,'record_cashback_adjustment','cashback_transactions',tx.id::text,jsonb_build_object('amount',tx.amount,'reason',tx.description,'balanceBefore',available));
  return jsonb_build_object('transactionId',tx.id,'idempotentReplay',false,'summary',public.cashback_snapshot(p_client_id));
end; $$;

create or replace function public.get_admin_client_cashback(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.clients%rowtype;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  select * into c from public.clients where id=p_client_id;if c.id is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002';end if;
  return jsonb_build_object('config',jsonb_build_object('enabled',c.cashback_enabled,'defaultPercentage',c.cashback_default_percentage,'enabledAt',c.cashback_enabled_at,'enabledBy',c.cashback_enabled_by,'updatedAt',c.cashback_config_updated_at,'updatedBy',c.cashback_config_updated_by),'summary',public.cashback_snapshot(p_client_id),'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'type',t.transaction_type,'amount',t.amount,'status',t.status,'description',t.description,'redemptionId',t.redemption_id,'reversedTransactionId',t.reversed_transaction_id,'createdAt',t.created_at) order by t.created_at desc,t.id desc) from public.cashback_transactions t where t.client_id=p_client_id),'[]'::jsonb),'canManage',public.has_staff_role(array['super_admin','manager']::public.app_role[]));
end; $$;

create or replace function public.build_public_client_cashback(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select case when not c.cashback_enabled and not exists(select 1 from public.cashback_transactions t where t.client_id=c.id) then null else jsonb_build_object(
    'enabled',c.cashback_enabled,'notice',case when c.cashback_enabled then null else 'Cashback não disponível para novas economias.' end,
    'summary',public.cashback_snapshot(c.id),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'type',t.transaction_type,'amount',t.amount,'description',t.description,'redemptionId',t.redemption_id,'createdAt',t.created_at) order by t.created_at desc,t.id desc) from public.cashback_transactions t where t.client_id=c.id and t.status='confirmed'),'[]'::jsonb)
  ) end from public.clients c where c.id=p_client_id and c.status='active';
$$;

create or replace function public.register_saving_evidence_pending(p_actor uuid,p_evidence_id uuid,p_redemption_id uuid,p_object_path text,p_original_name text,p_mime_type text,p_size_bytes bigint,p_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.redemptions%rowtype; evidence public.saving_evidence_files%rowtype;
begin
  if not exists(select 1 from public.staff_members where user_id=p_actor and active and role in ('super_admin','manager','operator')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if p_mime_type not in ('image/png','image/jpeg','image/webp') or p_size_bytes<=0 or p_size_bytes>10485760 or p_sha256!~'^[a-f0-9]{64}$' then raise exception 'INVALID_EVIDENCE_FILE' using errcode='22023';end if;
  select * into r from public.redemptions where id=p_redemption_id and status='confirmed';if r.id is null then raise exception 'SAVING_NOT_FOUND' using errcode='P0002';end if;
  if p_object_path !~ ('^'||r.client_id::text||'/'||r.id::text||'/[0-9a-f-]{36}\.(png|jpg|webp)$') then raise exception 'INVALID_EVIDENCE_PATH' using errcode='22023';end if;
  insert into public.saving_evidence_files(id,client_id,redemption_id,object_path,original_name,mime_type,size_bytes,sha256,status,uploaded_by) values(p_evidence_id,r.client_id,r.id,p_object_path,left(regexp_replace(p_original_name,'[\x00-\x1f\\/]','','g'),180),p_mime_type,p_size_bytes,p_sha256,'pending',p_actor) returning * into evidence;
  return jsonb_build_object('evidenceId',evidence.id,'clientId',evidence.client_id,'redemptionId',evidence.redemption_id,'path',evidence.object_path);
end; $$;

create or replace function public.confirm_saving_evidence(p_actor uuid,p_evidence_id uuid,p_actual_mime text,p_actual_size bigint,p_actual_sha256 text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.saving_evidence_files%rowtype; old_path text;
begin
  if not exists(select 1 from public.staff_members where user_id=p_actor and active and role in ('super_admin','manager','operator')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  select * into e from public.saving_evidence_files where id=p_evidence_id for update;
  if e.id is null or e.status<>'pending' or e.uploaded_by<>p_actor then raise exception 'EVIDENCE_NOT_PENDING' using errcode='55000';end if;
  if e.mime_type<>p_actual_mime or e.size_bytes<>p_actual_size or e.sha256<>p_actual_sha256 then raise exception 'EVIDENCE_INTEGRITY_MISMATCH' using errcode='23514';end if;
  select object_path into old_path from public.saving_evidence_files where redemption_id=e.redemption_id and status='active' for update;
  update public.saving_evidence_files set status='removed',removed_at=clock_timestamp(),removed_by=p_actor,removal_reason='Substituído por novo comprovante' where redemption_id=e.redemption_id and status='active';
  update public.saving_evidence_files set status='active',confirmed_at=clock_timestamp() where id=e.id;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(p_actor,e.client_id,'confirm_saving_evidence','saving_evidence_files',e.id::text,jsonb_build_object('redemptionId',e.redemption_id,'mimeType',e.mime_type,'sizeBytes',e.size_bytes,'sha256Verified',true,'replacedPrevious',old_path is not null));
  return jsonb_build_object('evidenceId',e.id,'redemptionId',e.redemption_id,'oldPath',old_path,'active',true);
end; $$;

create or replace function public.remove_saving_evidence(p_actor uuid,p_redemption_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.saving_evidence_files%rowtype;
begin
  if not exists(select 1 from public.staff_members where user_id=p_actor and active and role in ('super_admin','manager','operator')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'REMOVAL_REASON_REQUIRED' using errcode='22023';end if;
  select * into e from public.saving_evidence_files where redemption_id=p_redemption_id and status='active' for update;
  if e.id is null then return jsonb_build_object('removed',false,'idempotentReplay',true);end if;
  update public.saving_evidence_files set status='removed',removed_at=clock_timestamp(),removed_by=p_actor,removal_reason=trim(p_reason) where id=e.id;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(p_actor,e.client_id,'remove_saving_evidence','saving_evidence_files',e.id::text,jsonb_build_object('redemptionId',e.redemption_id,'reason',trim(p_reason)));
  return jsonb_build_object('removed',true,'idempotentReplay',false,'path',e.object_path,'evidenceId',e.id);
end; $$;

revoke all on function public.cashback_snapshot(uuid),public.update_client_cashback_config(uuid,boolean,numeric,text),public.record_travel_sale(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid,numeric),public.record_cashback_redemption(uuid,numeric,text,uuid),public.record_cashback_adjustment(uuid,numeric,text,boolean,uuid),public.get_admin_client_cashback(uuid),public.build_public_client_cashback(uuid),public.register_saving_evidence_pending(uuid,uuid,uuid,text,text,text,bigint,text),public.confirm_saving_evidence(uuid,uuid,text,bigint,text),public.remove_saving_evidence(uuid,uuid,text) from public,anon;
grant execute on function public.update_client_cashback_config(uuid,boolean,numeric,text),public.record_travel_sale(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid,numeric),public.record_cashback_redemption(uuid,numeric,text,uuid),public.record_cashback_adjustment(uuid,numeric,text,boolean,uuid),public.get_admin_client_cashback(uuid) to authenticated;
grant execute on function public.cashback_snapshot(uuid),public.build_public_client_cashback(uuid),public.register_saving_evidence_pending(uuid,uuid,uuid,text,text,text,bigint,text),public.confirm_saving_evidence(uuid,uuid,text,bigint,text),public.remove_saving_evidence(uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
