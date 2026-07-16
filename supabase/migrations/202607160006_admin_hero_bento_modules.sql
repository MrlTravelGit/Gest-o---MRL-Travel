begin;

alter table public.clients
  add column birth_date date,
  add constraint clients_birth_date_not_future_at_creation
    check (birth_date is null or birth_date <= created_at::date);

create table public.client_addresses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete restrict,
  postal_code text not null,
  street text not null,
  number text not null,
  complement text,
  neighborhood text not null,
  city text not null,
  state text not null,
  country_code char(2) not null default 'BR',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_addresses_postal_length check (char_length(postal_code) between 3 and 16),
  constraint client_addresses_street_length check (char_length(street) between 2 and 160),
  constraint client_addresses_number_length check (char_length(number) between 1 and 30),
  constraint client_addresses_complement_length check (complement is null or char_length(complement) <= 120),
  constraint client_addresses_neighborhood_length check (char_length(neighborhood) between 2 and 100),
  constraint client_addresses_city_length check (char_length(city) between 2 and 100),
  constraint client_addresses_state_valid check (
    (country_code = 'BR' and state ~ '^[A-Z]{2}$') or
    (country_code <> 'BR' and char_length(state) between 2 and 80)
  ),
  constraint client_addresses_country_valid check (country_code ~ '^[A-Z]{2}$')
);

create type public.travel_interest_status as enum (
  'open', 'quoting', 'converted', 'cancelled'
);

create table public.travel_interests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  destination text not null,
  desired_start_date date,
  desired_end_date date,
  details text not null,
  status public.travel_interest_status not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint travel_interest_destination_length check (char_length(destination) between 2 and 160),
  constraint travel_interest_details_length check (char_length(details) between 3 and 2000),
  constraint travel_interest_date_order check (
    desired_end_date is null or desired_start_date is null or desired_end_date >= desired_start_date
  )
);

alter table public.redemptions
  add column payment_mode text,
  add column launched_on date,
  add column operation_id uuid,
  add column travel_account_id uuid references public.program_accounts(id) on delete restrict,
  add column travel_points_used bigint,
  add constraint redemptions_payment_mode_valid
    check (payment_mode is null or payment_mode in ('cash', 'miles')),
  add constraint redemptions_travel_points_positive
    check (travel_points_used is null or travel_points_used > 0),
  add constraint redemptions_travel_mode_consistent check (
    payment_mode is null or
    (payment_mode = 'cash' and travel_account_id is null and travel_points_used is null) or
    (payment_mode = 'miles' and travel_account_id is not null and travel_points_used is not null)
  );

create unique index redemptions_operation_id_idx
  on public.redemptions(operation_id) where operation_id is not null;
create index redemptions_admin_filters_idx
  on public.redemptions(client_id, launched_on desc, status);

alter table public.transfers
  add column parity numeric(12,6) not null default 1,
  add column destination_base_points bigint,
  add column bonus_points bigint,
  add column received_on date,
  add column bonus_received_on date,
  add column destination_expires_on date,
  add column operation_id uuid,
  add column status text not null default 'completed',
  add constraint transfers_parity_positive check (parity > 0),
  add constraint transfers_base_positive check (destination_base_points is null or destination_base_points > 0),
  add constraint transfers_bonus_points_nonnegative check (bonus_points is null or bonus_points >= 0),
  add constraint transfers_status_valid check (status in ('completed')),
  add constraint transfers_dates_valid check (
    received_on is null or destination_expires_on is null or destination_expires_on >= received_on
  );

create unique index transfers_operation_id_idx
  on public.transfers(operation_id) where operation_id is not null;
create index transfers_admin_filters_idx
  on public.transfers(client_id, transferred_at desc);
create index travel_interests_filters_idx
  on public.travel_interests(status, created_at desc, client_id);
create index client_addresses_client_idx on public.client_addresses(client_id);

create trigger client_addresses_set_updated_at before update on public.client_addresses
for each row execute function public.set_updated_at();
create trigger travel_interests_set_updated_at before update on public.travel_interests
for each row execute function public.set_updated_at();

alter table public.client_addresses enable row level security;
alter table public.client_addresses force row level security;
alter table public.travel_interests enable row level security;
alter table public.travel_interests force row level security;

revoke all on public.client_addresses from anon, authenticated;
revoke all on public.travel_interests from anon, authenticated;
grant select on public.client_addresses to authenticated;
grant select on public.travel_interests to authenticated;

create policy client_addresses_select_staff on public.client_addresses
for select to authenticated using (public.is_staff());
create policy client_addresses_write_staff on public.client_addresses
for all to authenticated using (public.can_write_client_data())
with check (public.can_write_client_data());
create policy travel_interests_select_staff on public.travel_interests
for select to authenticated using (public.is_staff());
create policy travel_interests_write_staff on public.travel_interests
for all to authenticated using (public.can_write_client_data())
with check (public.can_write_client_data());

revoke insert, update, delete on public.redemptions from authenticated;
revoke insert, update, delete on public.redemption_point_usages from authenticated;
revoke insert, update, delete on public.transfers from authenticated;

create or replace function public.admin_mfa_verified()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.can_write_client_data()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.admin_mfa_verified() and public.has_staff_role(
    array['super_admin', 'manager', 'operator']::public.app_role[]
  );
$$;

create or replace function public.can_manage_security()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.admin_mfa_verified() and public.has_staff_role(
    array['super_admin', 'manager']::public.app_role[]
  );
$$;

revoke all on function public.admin_mfa_verified() from public, anon;
grant execute on function public.admin_mfa_verified() to authenticated;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb;
  new_row jsonb;
  resolved_client_id uuid;
  resolved_account_id uuid;
  resolved_record_id text;
begin
  old_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  resolved_account_id := coalesce(nullif(new_row ->> 'account_id', '')::uuid, nullif(old_row ->> 'account_id', '')::uuid);
  resolved_client_id := coalesce(
    nullif(new_row ->> 'client_id', '')::uuid,
    nullif(old_row ->> 'client_id', '')::uuid,
    case when tg_table_name = 'clients' then coalesce(nullif(new_row ->> 'id', '')::uuid, nullif(old_row ->> 'id', '')::uuid) end,
    (select pa.client_id from public.program_accounts pa where pa.id = resolved_account_id)
  );
  resolved_record_id := coalesce(new_row ->> 'id', old_row ->> 'id');

  if tg_table_name = 'clients' then
    old_row := old_row - array['email', 'phone_e164', 'notes', 'birth_date'];
    new_row := new_row - array['email', 'phone_e164', 'notes', 'birth_date'];
  elsif tg_table_name = 'client_addresses' then
    old_row := case when old_row is null then null else jsonb_build_object('id', old_row -> 'id', 'client_id', old_row -> 'client_id') end;
    new_row := case when new_row is null then null else jsonb_build_object('id', new_row -> 'id', 'client_id', new_row -> 'client_id') end;
  elsif tg_table_name = 'travel_interests' then
    old_row := old_row - array['details'];
    new_row := new_row - array['details'];
  elsif tg_table_name = 'redemptions' then
    old_row := old_row - array['description','notes','cash_reference_total','taxes_paid','additional_cash_paid','attributed_points_cost','effective_cost','savings_amount','travel_points_used'];
    new_row := new_row - array['description','notes','cash_reference_total','taxes_paid','additional_cash_paid','attributed_points_cost','effective_cost','savings_amount','travel_points_used'];
  elsif tg_table_name = 'transfers' then
    old_row := old_row - array['notes','source_points','destination_points','destination_base_points','bonus_points','bonus_percentage','parity'];
    new_row := new_row - array['notes','source_points','destination_points','destination_base_points','bonus_points','bonus_percentage','parity'];
  elsif tg_table_name = 'point_transactions' then
    old_row := old_row - array['description','points_delta','cash_total','cost_per_thousand','metadata'];
    new_row := new_row - array['description','points_delta','cash_total','cost_per_thousand','metadata'];
  elsif tg_table_name = 'balance_snapshots' then
    old_row := old_row - array['balance','average_cost_per_thousand','value_per_thousand','estimated_value','notes'];
    new_row := new_row - array['balance','average_cost_per_thousand','value_per_thousand','estimated_value','notes'];
  end if;

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), resolved_client_id, lower(tg_op), tg_table_name, resolved_record_id, old_row, new_row);
  return coalesce(new, old);
end;
$$;

create trigger client_addresses_audit after insert or update or delete on public.client_addresses
for each row execute function public.audit_row_change();
create trigger travel_interests_audit after insert or update or delete on public.travel_interests
for each row execute function public.audit_row_change();

create or replace function public.consume_expiration_lots(p_account_id uuid, p_points bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining bigint := greatest(coalesce(p_points, 0), 0);
  consumed bigint := 0;
  lot record;
  take_points bigint;
begin
  for lot in
    select id, remaining_points from public.expiration_lots
    where account_id = p_account_id and status = 'active' and remaining_points > 0
    order by expires_on, created_at, id for update
  loop
    exit when remaining = 0;
    take_points := least(remaining, lot.remaining_points);
    update public.expiration_lots
      set points_used = points_used + take_points,
          status = case when points_used + take_points = points_amount then 'used' else status end
      where id = lot.id;
    remaining := remaining - take_points;
    consumed := consumed + take_points;
  end loop;
  return consumed;
end;
$$;

revoke all on function public.consume_expiration_lots(uuid, bigint) from public, anon, authenticated;

create or replace function public.get_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode = '42501'; end if;
  return jsonb_build_object(
    'activeClients', (select count(*) from public.clients where status = 'active'),
    'managedPoints', coalesce((select sum(coalesce(latest.balance, 0)) from public.program_accounts pa left join lateral (
      select bs.balance from public.balance_snapshots bs where bs.account_id = pa.id order by bs.captured_at desc, bs.id desc limit 1
    ) latest on true where pa.active), 0),
    'generatedSavings', coalesce((select sum(savings_amount) from public.redemptions where status = 'confirmed'), 0),
    'expiringIn30Days', coalesce((select sum(remaining_points) from public.expiration_lots where status = 'active' and expires_on between current_date and current_date + 30), 0),
    'contractsEndingIn30Days', (select count(*) from public.management_contracts where status = 'active' and ends_on between current_date and current_date + 30),
    'openTasks', (select count(*) from public.tasks where status in ('open', 'in_progress')),
    'openInterests', (select count(*) from public.travel_interests where status in ('open', 'quoting')),
    'transfersCount', (select count(*) from public.transfers),
    'operatorName', coalesce((select split_part(trim(p.full_name), ' ', 1) from public.profiles p where p.id = actor_id), 'Equipe MRL'),
    'role', (select sm.role from public.staff_members sm where sm.user_id = actor_id and sm.active),
    'canWrite', public.can_write_client_data(),
    'canArchive', public.can_manage_security()
  );
end;
$$;

create or replace function public.get_admin_clients(
  p_search text default null,
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit,20),1),100);
  safe_offset integer := greatest(coalesce(p_offset,0),0);
  normalized_search text := nullif(trim(coalesce(p_search,'')),'');
  normalized_status text := nullif(trim(coalesce(p_status,'')),'');
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if normalized_status is not null and normalized_status not in ('lead','active','paused','ended') then raise exception 'Status inválido' using errcode='22023'; end if;
  return (with filtered as materialized (
    select c.id,c.public_id,c.full_name,c.status,
      coalesce((select sum(coalesce(latest.balance,0)) from public.program_accounts pa left join lateral (
        select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1
      ) latest on true where pa.client_id=c.id and pa.active),0) total_points,
      coalesce((select sum(r.savings_amount) from public.redemptions r where r.client_id=c.id and r.status='confirmed'),0) generated_savings,
      (select count(*) from public.program_accounts pa where pa.client_id=c.id and pa.active) programs_count,
      (select count(*) from public.program_accounts pa where pa.client_id=c.id and pa.active and pa.club_active) active_clubs_count,
      (select min(el.expires_on) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=c.id and el.status='active' and el.remaining_points>0 and el.expires_on>=current_date) next_expiration_date,
      coalesce((select sum(el.remaining_points) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=c.id and el.status='active' and el.remaining_points>0 and el.expires_on between current_date and current_date+90),0) expiring_points,
      (select max(pt.occurred_at) from public.point_transactions pt join public.program_accounts pa on pa.id=pt.account_id where pa.client_id=c.id) last_movement_at
    from public.clients c where (normalized_search is null or c.full_name ilike '%'||normalized_search||'%') and (normalized_status is null or c.status::text=normalized_status)
  ), paged as (select * from filtered order by full_name,id limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'clientId',p.id,'publicId',p.public_id,'fullName',p.full_name,'status',p.status,'totalPoints',p.total_points,
    'generatedSavings',p.generated_savings,'programsCount',p.programs_count,'activeClubsCount',p.active_clubs_count,
    'nextExpirationDate',p.next_expiration_date,'expiringPoints',p.expiring_points,'lastMovementAt',p.last_movement_at
  ) order by p.full_name,p.id) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset));
end;
$$;

create or replace function public.get_admin_form_options()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'canWrite', public.can_write_client_data(),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
      'clientId',c.id,'fullName',c.full_name,'accounts',coalesce((select jsonb_agg(jsonb_build_object(
        'accountId',pa.id,'programId',lp.id,'programName',lp.name,'balance',coalesce(latest.balance,0)
      ) order by lp.name) from public.program_accounts pa join public.loyalty_programs lp on lp.id=pa.program_id left join lateral (
        select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1
      ) latest on true where pa.client_id=c.id and pa.active and lp.active),'[]'::jsonb)
    ) order by c.full_name) from public.clients c where c.status='active'),'[]'::jsonb)
  );
end;
$$;

create or replace function public.archive_client(p_client_id uuid, p_confirmation_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor_id uuid:=auth.uid(); client_row public.clients%rowtype; affected_users uuid[];
begin
  if actor_id is null or not public.can_manage_security() then raise exception 'Somente gestores podem arquivar clientes.' using errcode='42501'; end if;
  select * into client_row from public.clients where id=p_client_id for update;
  if client_row.id is null then raise exception 'Cliente não encontrado.' using errcode='P0002'; end if;
  if trim(coalesce(p_confirmation_name,'')) <> client_row.full_name then raise exception 'Digite o nome completo para confirmar.' using errcode='22023'; end if;
  select array_agg(user_id) into affected_users from public.client_users where client_id=p_client_id and active;
  update public.clients set status='ended',updated_at=clock_timestamp() where id=p_client_id;
  update public.client_users set active=false,updated_at=clock_timestamp() where client_id=p_client_id and active;
  update public.management_contracts set status=case when status='active' then 'ended'::public.contract_status else 'cancelled'::public.contract_status end,updated_at=clock_timestamp()
    where client_id=p_client_id and status in ('draft','active','paused');
  update public.profiles p set active=false,updated_at=clock_timestamp()
    where p.id=any(coalesce(affected_users,array[]::uuid[])) and not exists(select 1 from public.client_users cu where cu.user_id=p.id and cu.active) and not exists(select 1 from public.staff_members sm where sm.user_id=p.id and sm.active);
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data)
    values(actor_id,p_client_id,'archive_client','clients',p_client_id::text,jsonb_build_object('status','ended'));
  return jsonb_build_object('clientId',p_client_id,'status','ended');
end;
$$;

create or replace function public.record_travel_sale(
  p_client_id uuid,p_launched_on date,p_payment_mode text,p_travel_type public.redemption_type,p_details text,
  p_original_value numeric,p_paid_value numeric,p_account_id uuid default null,p_points_used bigint default null,p_operation_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); account_row public.program_accounts%rowtype; current_balance bigint:=0; current_average numeric(14,4):=0; new_balance bigint; program_value numeric(14,4):=0; redemption_row public.redemptions%rowtype; transaction_row public.point_transactions%rowtype; existing public.redemptions%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Você não possui permissão para registrar viagens.' using errcode='42501'; end if;
  if p_launched_on is null or p_launched_on>current_date then raise exception 'A data do lançamento não pode estar no futuro.' using errcode='22007'; end if;
  if p_payment_mode not in ('cash','miles') then raise exception 'Forma da operação inválida.' using errcode='22023'; end if;
  if char_length(trim(coalesce(p_details,'')))<3 then raise exception 'Informe os detalhes da viagem.' using errcode='22023'; end if;
  if p_original_value is null or p_original_value<0 or p_paid_value is null or p_paid_value<0 then raise exception 'Valores não podem ser negativos.' using errcode='22003'; end if;
  if not exists(select 1 from public.clients where id=p_client_id and status='active') then raise exception 'Cliente ativo não encontrado.' using errcode='P0002'; end if;
  select * into existing from public.redemptions where operation_id=p_operation_id;
  if existing.id is not null then
    if existing.client_id<>p_client_id or existing.launched_on<>p_launched_on or existing.payment_mode<>p_payment_mode
       or existing.cash_reference_total<>round(p_original_value,2) or existing.effective_cost<>round(p_paid_value,2)
       or existing.travel_account_id is distinct from p_account_id or existing.travel_points_used is distinct from p_points_used then
      raise exception 'A chave da operação já foi utilizada.' using errcode='23505';
    end if;
    return jsonb_build_object('saleId',existing.id,'savingsAmount',existing.savings_amount,'idempotentReplay',true);
  end if;
  if p_payment_mode='cash' and (p_account_id is not null or p_points_used is not null) then raise exception 'Operação em dinheiro não recebe pontos.' using errcode='22023'; end if;
  if p_payment_mode='miles' then
    if p_account_id is null or p_points_used is null or p_points_used<=0 then raise exception 'Informe programa e pontos utilizados.' using errcode='22023'; end if;
    select * into account_row from public.program_accounts where id=p_account_id and client_id=p_client_id and active for update;
    if account_row.id is null then raise exception 'A conta não pertence ao cliente.' using errcode='42501'; end if;
    select coalesce(bs.balance,0),coalesce(bs.average_cost_per_thousand,0) into current_balance,current_average from public.balance_snapshots bs where bs.account_id=account_row.id order by bs.captured_at desc,bs.id desc limit 1;
    if not found then current_balance:=0; current_average:=0; end if;
    if p_points_used>current_balance then raise exception 'Saldo insuficiente.' using errcode='23514'; end if;
    new_balance:=current_balance-p_points_used;
    select lp.default_value_per_thousand into program_value from public.loyalty_programs lp where lp.id=account_row.program_id;
  end if;
  insert into public.redemptions(client_id,redemption_type,description,issued_at,cash_reference_total,taxes_paid,additional_cash_paid,attributed_points_cost,formula_version,reference_captured_at,status,created_by,payment_mode,launched_on,operation_id,travel_account_id,travel_points_used)
  values(p_client_id,p_travel_type,trim(p_details),p_launched_on::timestamp at time zone 'America/Sao_Paulo',round(p_original_value,2),0,round(p_paid_value,2),0,'2.0.0',clock_timestamp(),'confirmed',actor_id,p_payment_mode,p_launched_on,p_operation_id,p_account_id,p_points_used) returning * into redemption_row;
  if p_payment_mode='miles' then
    insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,source,metadata,created_by,entry_date,operation_id)
      values(account_row.id,p_launched_on::timestamp at time zone 'America/Sao_Paulo','redemption',-p_points_used,'Uso de pontos em viagem: '||trim(p_details),'travel_sale',jsonb_build_object('redemptionId',redemption_row.id),actor_id,p_launched_on,p_operation_id) returning * into transaction_row;
    insert into public.redemption_point_usages(redemption_id,account_id,points_used,value_per_thousand) values(redemption_row.id,account_row.id,p_points_used,current_average);
    perform public.consume_expiration_lots(account_row.id,p_points_used);
    insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,notes,created_by)
      values(account_row.id,clock_timestamp(),new_balance,current_average,program_value,'travel_sale','Baixa atômica vinculada à viagem',actor_id);
  end if;
  return jsonb_build_object('saleId',redemption_row.id,'savingsAmount',redemption_row.savings_amount,'newBalance',case when p_payment_mode='miles' then new_balance else null end,'idempotentReplay',false);
end;
$$;

create or replace function public.get_travel_sales(p_client_id uuid default null,p_start_date date default null,p_end_date date default null,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'Período inválido' using errcode='22007'; end if;
  return (with filtered as materialized(select r.*,c.full_name,lp.name program_name from public.redemptions r join public.clients c on c.id=r.client_id left join public.program_accounts pa on pa.id=r.travel_account_id left join public.loyalty_programs lp on lp.id=pa.program_id where r.payment_mode is not null and (p_client_id is null or r.client_id=p_client_id) and (p_start_date is null or r.launched_on>=p_start_date) and (p_end_date is null or r.launched_on<=p_end_date)), paged as(select * from filtered order by launched_on desc,created_at desc limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'clientId',p.client_id,'clientName',p.full_name,'launchedOn',p.launched_on,'paymentMode',p.payment_mode,'travelType',p.redemption_type,'details',p.description,'originalValue',p.cash_reference_total,'paidValue',p.effective_cost,'savingsAmount',p.savings_amount,'programName',p.program_name,'pointsUsed',p.travel_points_used) order by p.launched_on desc,p.created_at desc) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'totalSavings',coalesce((select sum(savings_amount) from filtered),0),'limit',safe_limit,'offset',safe_offset));
end;
$$;

create or replace function public.upsert_travel_interest(p_client_id uuid,p_destination text,p_start_date date,p_end_date date,p_details text,p_status public.travel_interest_status default 'open',p_interest_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); interest_row public.travel_interests%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Você não possui permissão para registrar interesses.' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id=p_client_id and status='active') then raise exception 'Cliente ativo não encontrado.' using errcode='P0002'; end if;
  if char_length(trim(coalesce(p_destination,'')))<2 or char_length(trim(coalesce(p_details,'')))<3 then raise exception 'Destino e detalhes são obrigatórios.' using errcode='22023'; end if;
  if p_start_date is not null and p_end_date is not null and p_end_date<p_start_date then raise exception 'A data final não pode ser anterior à inicial.' using errcode='22007'; end if;
  if p_interest_id is null then insert into public.travel_interests(client_id,destination,desired_start_date,desired_end_date,details,status,created_by) values(p_client_id,trim(p_destination),p_start_date,p_end_date,trim(p_details),p_status,actor_id) returning * into interest_row;
  else update public.travel_interests set destination=trim(p_destination),desired_start_date=p_start_date,desired_end_date=p_end_date,details=trim(p_details),status=p_status where id=p_interest_id and client_id=p_client_id returning * into interest_row; end if;
  if interest_row.id is null then raise exception 'Interesse não encontrado.' using errcode='P0002'; end if;
  return jsonb_build_object('interestId',interest_row.id,'status',interest_row.status);
end;
$$;

create or replace function public.get_travel_interests(p_search text default null,p_status text default null,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0); normalized text:=nullif(trim(coalesce(p_search,'')),'');
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return (with filtered as materialized(select ti.*,c.full_name from public.travel_interests ti join public.clients c on c.id=ti.client_id where (normalized is null or c.full_name ilike '%'||normalized||'%' or ti.destination ilike '%'||normalized||'%') and (nullif(p_status,'') is null or ti.status::text=p_status)), paged as(select * from filtered order by created_at desc limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'clientId',p.client_id,'clientName',p.full_name,'destination',p.destination,'startDate',p.desired_start_date,'endDate',p.desired_end_date,'details',p.details,'status',p.status,'createdAt',p.created_at) order by p.created_at desc) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset));
end;
$$;

create or replace function public.get_points_ranking(p_search text default null,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0); normalized text:=nullif(trim(coalesce(p_search,'')),'');
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return (with totals as materialized(select c.id,c.full_name,coalesce(sum(coalesce(latest.balance,0)),0) total_points,count(pa.id) filter(where pa.active) programs_count,max(last_tx.occurred_at) last_movement_at from public.clients c left join public.program_accounts pa on pa.client_id=c.id and pa.active left join lateral(select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1) latest on true left join lateral(select max(pt.occurred_at) occurred_at from public.point_transactions pt where pt.account_id=pa.id) last_tx on true where c.status='active' group by c.id,c.full_name), ranked as(select t.*,row_number() over(order by total_points desc,full_name,id) ranking_position from totals t), filtered as materialized(select r.*,coalesce((select sum(el.remaining_points) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=r.id and el.status='active' and el.expires_on between current_date and current_date+30),0) expiring_30,coalesce((select sum(el.remaining_points) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=r.id and el.status='active' and el.expires_on between current_date+31 and current_date+60),0) expiring_60,coalesce((select sum(el.remaining_points) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=r.id and el.status='active' and el.expires_on between current_date+61 and current_date+90),0) expiring_90,coalesce((select jsonb_agg(jsonb_build_object('programName',lp.name,'balance',coalesce(latest.balance,0)) order by lp.name) from public.program_accounts pa join public.loyalty_programs lp on lp.id=pa.program_id left join lateral(select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1) latest on true where pa.client_id=r.id and pa.active),'[]'::jsonb) programs from ranked r where normalized is null or r.full_name ilike '%'||normalized||'%'), paged as(select * from filtered order by ranking_position limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('position',p.ranking_position,'clientId',p.id,'clientName',p.full_name,'totalPoints',p.total_points,'programsCount',p.programs_count,'expiring30',p.expiring_30,'expiring60',p.expiring_60,'expiring90',p.expiring_90,'lastMovementAt',p.last_movement_at,'programs',p.programs) order by p.ranking_position) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset));
end;
$$;

create or replace function public.confirm_transfer(p_client_id uuid,p_transferred_on date,p_source_account_id uuid,p_destination_account_id uuid,p_source_points bigint,p_parity numeric,p_received_on date,p_destination_expires_on date,p_bonus_percentage numeric default 0,p_bonus_received_on date default null,p_notes text default null,p_operation_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); source_row public.program_accounts%rowtype; destination_row public.program_accounts%rowtype; existing public.transfers%rowtype; source_balance bigint:=0; source_average numeric(14,4):=0; destination_balance bigint:=0; destination_average numeric(14,4):=0; source_market numeric(14,4):=0; destination_market numeric(14,4):=0; base_points bigint; bonus_points_value bigint; total_points bigint; new_source bigint; new_destination bigint; new_destination_average numeric(14,4); transfer_row public.transfers%rowtype; destination_tx public.point_transactions%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Você não possui permissão para transferir pontos.' using errcode='42501'; end if;
  if p_transferred_on is null or p_transferred_on>current_date or p_received_on is null or p_received_on<p_transferred_on then raise exception 'Datas da transferência inválidas.' using errcode='22007'; end if;
  if p_source_account_id=p_destination_account_id then raise exception 'Origem e destino devem ser diferentes.' using errcode='22023'; end if;
  if p_source_points is null or p_source_points<=0 or p_parity is null or p_parity<=0 or p_bonus_percentage<0 then raise exception 'Quantidade, paridade e bônus devem ser válidos.' using errcode='22003'; end if;
  if p_destination_expires_on is not null and (p_destination_expires_on<p_received_on or (p_bonus_received_on is not null and p_destination_expires_on<p_bonus_received_on)) then raise exception 'A validade não pode ser anterior ao recebimento.' using errcode='22007'; end if;
  base_points:=round(p_source_points::numeric*p_parity)::bigint; bonus_points_value:=round(base_points::numeric*p_bonus_percentage/100)::bigint; total_points:=base_points+bonus_points_value;
  if base_points<=0 then raise exception 'A paridade resulta em zero pontos.' using errcode='22003'; end if;
  if bonus_points_value>0 and (p_bonus_received_on is null or p_bonus_received_on<p_received_on) then raise exception 'Informe uma data válida para o bônus.' using errcode='22007'; end if;
  select * into existing from public.transfers where operation_id=p_operation_id;
  if existing.id is not null then
    if existing.client_id<>p_client_id or existing.source_account_id is distinct from p_source_account_id
       or existing.destination_account_id is distinct from p_destination_account_id or existing.source_points<>p_source_points
       or existing.parity<>p_parity or existing.bonus_percentage<>p_bonus_percentage then
      raise exception 'A chave da operação já foi utilizada.' using errcode='23505';
    end if;
    return jsonb_build_object('transferId',existing.id,'destinationBase',existing.destination_base_points,'bonusPoints',existing.bonus_points,'destinationTotal',existing.destination_points,'idempotentReplay',true);
  end if;
  perform 1 from public.program_accounts where id in(p_source_account_id,p_destination_account_id) order by id for update;
  select * into source_row from public.program_accounts where id=p_source_account_id and client_id=p_client_id and active;
  select * into destination_row from public.program_accounts where id=p_destination_account_id and client_id=p_client_id and active;
  if source_row.id is null or destination_row.id is null then raise exception 'As contas devem pertencer ao cliente.' using errcode='42501'; end if;
  select coalesce(bs.balance,0),coalesce(bs.average_cost_per_thousand,0) into source_balance,source_average from public.balance_snapshots bs where bs.account_id=source_row.id order by bs.captured_at desc,bs.id desc limit 1; if not found then source_balance:=0;source_average:=0;end if;
  select coalesce(bs.balance,0),coalesce(bs.average_cost_per_thousand,0) into destination_balance,destination_average from public.balance_snapshots bs where bs.account_id=destination_row.id order by bs.captured_at desc,bs.id desc limit 1; if not found then destination_balance:=0;destination_average:=0;end if;
  if p_source_points>source_balance then raise exception 'Saldo insuficiente.' using errcode='23514'; end if;
  select default_value_per_thousand into source_market from public.loyalty_programs where id=source_row.program_id; select default_value_per_thousand into destination_market from public.loyalty_programs where id=destination_row.program_id;
  new_source:=source_balance-p_source_points; new_destination:=destination_balance+total_points;
  new_destination_average:=case when new_destination=0 then 0 else round((((destination_balance::numeric/1000)*destination_average)+((base_points::numeric/1000)*source_average))/(new_destination::numeric/1000),4) end;
  insert into public.transfers(client_id,source_account_id,destination_account_id,transferred_at,source_points,bonus_percentage,destination_points,notes,created_by,parity,destination_base_points,bonus_points,received_on,bonus_received_on,destination_expires_on,operation_id,status)
    values(p_client_id,p_source_account_id,p_destination_account_id,p_transferred_on::timestamp at time zone 'America/Sao_Paulo',p_source_points,p_bonus_percentage,total_points,nullif(trim(coalesce(p_notes,'')),''),actor_id,p_parity,base_points,bonus_points_value,p_received_on,p_bonus_received_on,p_destination_expires_on,p_operation_id,'completed') returning * into transfer_row;
  insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,source,metadata,created_by,entry_date,operation_id) values(source_row.id,p_transferred_on::timestamp at time zone 'America/Sao_Paulo','transfer_out',-p_source_points,'Transferência entre programas','transfer',jsonb_build_object('transferId',transfer_row.id),actor_id,p_transferred_on,p_operation_id);
  insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,expires_on,source,metadata,created_by,entry_date) values(destination_row.id,p_received_on::timestamp at time zone 'America/Sao_Paulo','transfer_in',base_points,'Transferência recebida',p_destination_expires_on,'transfer',jsonb_build_object('transferId',transfer_row.id),actor_id,p_received_on) returning * into destination_tx;
  if bonus_points_value>0 then insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,expires_on,source,metadata,created_by,entry_date) values(destination_row.id,p_bonus_received_on::timestamp at time zone 'America/Sao_Paulo','bonus',bonus_points_value,'Bônus de transferência',p_destination_expires_on,'transfer',jsonb_build_object('transferId',transfer_row.id),actor_id,p_bonus_received_on); end if;
  perform public.consume_expiration_lots(source_row.id,p_source_points);
  insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,notes,created_by) values(source_row.id,clock_timestamp(),new_source,source_average,source_market,'transfer','Saída atômica de transferência',actor_id),(destination_row.id,clock_timestamp()+interval '1 microsecond',new_destination,new_destination_average,destination_market,'transfer','Entrada atômica de transferência',actor_id);
  if p_destination_expires_on is not null then insert into public.expiration_lots(account_id,expires_on,points_amount,status,notes,created_by,source_transaction_id) values(destination_row.id,p_destination_expires_on,total_points,'active','Pontos recebidos por transferência',actor_id,destination_tx.id); end if;
  return jsonb_build_object('transferId',transfer_row.id,'destinationBase',base_points,'bonusPoints',bonus_points_value,'destinationTotal',total_points,'sourceBalance',new_source,'destinationBalance',new_destination,'idempotentReplay',false);
end;
$$;

create or replace function public.record_manual_exit(p_client_id uuid,p_account_id uuid,p_exit_date date,p_points bigint,p_notes text,p_operation_id uuid default gen_random_uuid())
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); account_row public.program_accounts%rowtype; existing public.point_transactions%rowtype; current_balance bigint:=0; current_average numeric(14,4):=0; market_value numeric(14,4):=0; new_balance bigint; tx public.point_transactions%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then raise exception 'Você não possui permissão para registrar saídas.' using errcode='42501'; end if;
  if p_exit_date is null or p_exit_date>current_date then raise exception 'A data da saída não pode estar no futuro.' using errcode='22007'; end if;
  if p_points is null or p_points<=0 then raise exception 'Informe uma quantidade maior que zero.' using errcode='22003'; end if;
  if char_length(trim(coalesce(p_notes,'')))<3 then raise exception 'A observação é obrigatória.' using errcode='22023'; end if;
  select * into existing from public.point_transactions where operation_id=p_operation_id;
  if existing.id is not null then
    if existing.account_id<>p_account_id or existing.points_delta<>-p_points or existing.entry_date<>p_exit_date or existing.source<>'manual_exit' then
      raise exception 'A chave da operação já foi utilizada.' using errcode='23505';
    end if;
    select coalesce(bs.balance,0) into new_balance from public.balance_snapshots bs where bs.account_id=existing.account_id order by bs.captured_at desc,bs.id desc limit 1;
    return jsonb_build_object('transactionId',existing.id,'newBalance',new_balance,'idempotentReplay',true);
  end if;
  select * into account_row from public.program_accounts where id=p_account_id and client_id=p_client_id and active for update;
  if account_row.id is null then raise exception 'A conta não pertence ao cliente.' using errcode='42501'; end if;
  select coalesce(bs.balance,0),coalesce(bs.average_cost_per_thousand,0) into current_balance,current_average from public.balance_snapshots bs where bs.account_id=p_account_id order by bs.captured_at desc,bs.id desc limit 1; if not found then current_balance:=0;current_average:=0;end if;
  if p_points>current_balance then raise exception 'Saldo insuficiente.' using errcode='23514'; end if;
  new_balance:=current_balance-p_points; select default_value_per_thousand into market_value from public.loyalty_programs where id=account_row.program_id;
  insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,source,metadata,created_by,entry_category,entry_date,operation_id) values(p_account_id,p_exit_date::timestamp at time zone 'America/Sao_Paulo','adjustment',-p_points,trim(p_notes),'manual_exit',jsonb_build_object('kind','manual_exit'),actor_id,'manual_exit',p_exit_date,p_operation_id) returning * into tx;
  perform public.consume_expiration_lots(p_account_id,p_points);
  insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,notes,created_by) values(p_account_id,clock_timestamp(),new_balance,current_average,market_value,'manual_exit','Saída manual auditável',actor_id);
  return jsonb_build_object('transactionId',tx.id,'newBalance',new_balance,'idempotentReplay',false);
end;
$$;

create or replace function public.create_client_bundle(p_actor_user_id uuid,p_auth_user_id uuid,p_full_name text,p_email text,p_phone_e164 text,p_access_channel public.access_channel,p_birth_date date,p_notes text,p_postal_code text,p_street text,p_number text,p_complement text,p_neighborhood text,p_city text,p_state text,p_country_code char(2),p_starts_on date,p_ends_on date,p_plan_name text default null)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare created_client public.clients%rowtype; created_contract public.management_contracts%rowtype; country char(2):=upper(coalesce(nullif(trim(p_country_code),''),'BR')); state_value text:=case when upper(coalesce(nullif(trim(p_country_code),''),'BR'))='BR' then upper(trim(p_state)) else trim(p_state) end;
begin
  if not exists(select 1 from public.staff_members sm where sm.user_id=p_actor_user_id and sm.active and sm.role in('super_admin','manager')) then raise exception 'Operador sem permissão' using errcode='42501'; end if;
  if not exists(select 1 from auth.users where id=p_auth_user_id) then raise exception 'Usuário de autenticação inexistente' using errcode='23503'; end if;
  if p_birth_date is null or p_birth_date>current_date then raise exception 'Data de nascimento inválida' using errcode='22007'; end if;
  insert into public.profiles(id,full_name,first_name_normalized,email,phone_e164,preferred_access_channel,active) values(p_auth_user_id,trim(p_full_name),public.normalize_first_name(p_full_name),nullif(lower(trim(p_email)),'')::extensions.citext,nullif(trim(p_phone_e164),''),p_access_channel,true) on conflict(id) do update set full_name=excluded.full_name,email=excluded.email,phone_e164=excluded.phone_e164,preferred_access_channel=excluded.preferred_access_channel,active=true,updated_at=now();
  insert into public.clients(full_name,first_name_normalized,email,phone_e164,status,notes,birth_date,created_by) values(trim(p_full_name),public.normalize_first_name(p_full_name),nullif(lower(trim(p_email)),'')::extensions.citext,nullif(trim(p_phone_e164),''),'active',nullif(trim(coalesce(p_notes,'')),''),p_birth_date,p_actor_user_id) returning * into created_client;
  insert into public.client_addresses(client_id,postal_code,street,number,complement,neighborhood,city,state,country_code,created_by) values(created_client.id,trim(p_postal_code),trim(p_street),trim(p_number),nullif(trim(coalesce(p_complement,'')),''),trim(p_neighborhood),trim(p_city),state_value,country,p_actor_user_id);
  insert into public.client_users(client_id,user_id,role,active,created_by) values(created_client.id,p_auth_user_id,'client',true,p_actor_user_id);
  insert into public.management_contracts(client_id,starts_on,ends_on,status,plan_name,created_by) values(created_client.id,p_starts_on,p_ends_on,'active',p_plan_name,p_actor_user_id) returning * into created_contract;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(p_actor_user_id,created_client.id,'create_client_bundle','clients',created_client.id::text,jsonb_build_object('clientId',created_client.id,'publicId',created_client.public_id,'contractId',created_contract.id,'addressCreated',true));
  return jsonb_build_object('clientId',created_client.id,'publicId',created_client.public_id,'contractId',created_contract.id);
end;
$$;

revoke all on function public.get_admin_clients(text,text,integer,integer) from public,anon;
revoke all on function public.get_admin_form_options() from public,anon;
revoke all on function public.archive_client(uuid,text) from public,anon;
revoke all on function public.record_travel_sale(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid) from public,anon;
revoke all on function public.get_travel_sales(uuid,date,date,integer,integer) from public,anon;
revoke all on function public.upsert_travel_interest(uuid,text,date,date,text,public.travel_interest_status,uuid) from public,anon;
revoke all on function public.get_travel_interests(text,text,integer,integer) from public,anon;
revoke all on function public.get_points_ranking(text,integer,integer) from public,anon;
revoke all on function public.confirm_transfer(uuid,date,uuid,uuid,bigint,numeric,date,date,numeric,date,text,uuid) from public,anon;
revoke all on function public.record_manual_exit(uuid,uuid,date,bigint,text,uuid) from public,anon;
grant execute on function public.get_admin_clients(text,text,integer,integer),public.get_admin_form_options(),public.archive_client(uuid,text),public.record_travel_sale(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid),public.get_travel_sales(uuid,date,date,integer,integer),public.upsert_travel_interest(uuid,text,date,date,text,public.travel_interest_status,uuid),public.get_travel_interests(text,text,integer,integer),public.get_points_ranking(text,integer,integer),public.confirm_transfer(uuid,date,uuid,uuid,bigint,numeric,date,date,numeric,date,text,uuid),public.record_manual_exit(uuid,uuid,date,bigint,text,uuid) to authenticated;

revoke all on function public.create_client_bundle(uuid,uuid,text,text,text,public.access_channel,date,text,text,text,text,text,text,text,text,char,date,date,text) from public,anon,authenticated;
grant execute on function public.create_client_bundle(uuid,uuid,text,text,text,public.access_channel,date,text,text,text,text,text,text,text,text,char,date,date,text) to service_role;
grant all on public.client_addresses,public.travel_interests to service_role;

commit;
