begin;

create type public.point_entry_category as enum (
  'initial_balance',
  'points_purchase',
  'transfer',
  'credit_card',
  'other'
);

alter table public.program_accounts
  add column club_active boolean not null default false,
  add column club_updated_at timestamptz;

alter table public.point_transactions
  add column entry_category public.point_entry_category,
  add column entry_date date,
  add column valuation_mode text,
  add column cash_total numeric(16,2),
  add column cost_per_thousand numeric(14,4),
  add column operation_id uuid,
  add constraint point_transactions_valuation_mode_valid
    check (valuation_mode is null or valuation_mode in ('total_value', 'per_thousand')),
  add constraint point_transactions_cash_total_nonnegative
    check (cash_total is null or cash_total >= 0),
  add constraint point_transactions_cost_nonnegative
    check (cost_per_thousand is null or cost_per_thousand >= 0);

alter table public.expiration_lots
  add column source_transaction_id uuid
    references public.point_transactions(id) on delete set null;

create index transactions_account_entry_date_idx
  on public.point_transactions(account_id, entry_date desc, created_at desc);

create unique index transactions_one_initial_balance_idx
  on public.point_transactions(account_id)
  where entry_category = 'initial_balance';

create unique index transactions_operation_id_idx
  on public.point_transactions(operation_id)
  where operation_id is not null;

create unique index expiration_source_transaction_idx
  on public.expiration_lots(source_transaction_id)
  where source_transaction_id is not null;

comment on column public.point_transactions.operation_id is
  'Chave idempotente gerada pelo cliente para impedir lançamentos duplicados por reenvio.';

revoke insert, update, delete on public.program_accounts from authenticated;
revoke insert, update, delete on public.balance_snapshots from authenticated;
revoke insert, update, delete on public.point_transactions from authenticated;
revoke insert, update, delete on public.expiration_lots from authenticated;

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

  resolved_account_id := coalesce(
    nullif(new_row ->> 'account_id', '')::uuid,
    nullif(old_row ->> 'account_id', '')::uuid
  );

  resolved_client_id := coalesce(
    nullif(new_row ->> 'client_id', '')::uuid,
    nullif(old_row ->> 'client_id', '')::uuid,
    case when tg_table_name = 'clients' then coalesce(
      nullif(new_row ->> 'id', '')::uuid,
      nullif(old_row ->> 'id', '')::uuid
    ) else null end,
    (select pa.client_id from public.program_accounts pa where pa.id = resolved_account_id)
  );

  resolved_record_id := coalesce(new_row ->> 'id', old_row ->> 'id');

  insert into public.audit_logs (
    actor_user_id,
    client_id,
    action,
    table_name,
    record_id,
    old_data,
    new_data
  )
  values (
    auth.uid(),
    resolved_client_id,
    lower(tg_op),
    tg_table_name,
    resolved_record_id,
    old_row,
    new_row
  );

  return coalesce(new, old);
end;
$$;

create or replace function public.get_admin_clients(
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  normalized_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  return (
    with filtered as materialized (
      select
        c.id,
        c.public_id,
        c.full_name,
        c.status,
        coalesce((
          select sum(coalesce(latest.balance, 0))
          from public.program_accounts pa
          left join lateral (
            select bs.balance
            from public.balance_snapshots bs
            where bs.account_id = pa.id
            order by bs.captured_at desc, bs.id desc
            limit 1
          ) latest on true
          where pa.client_id = c.id and pa.active
        ), 0) as total_points,
        (select count(*) from public.program_accounts pa where pa.client_id = c.id and pa.active) as programs_count,
        (select count(*) from public.program_accounts pa where pa.client_id = c.id and pa.active and pa.club_active) as active_clubs_count,
        (select min(el.expires_on)
         from public.expiration_lots el
         join public.program_accounts pa on pa.id = el.account_id
         where pa.client_id = c.id and el.status = 'active' and el.remaining_points > 0 and el.expires_on >= current_date) as next_expiration_date,
        coalesce((select sum(el.remaining_points)
         from public.expiration_lots el
         join public.program_accounts pa on pa.id = el.account_id
         where pa.client_id = c.id and el.status = 'active' and el.remaining_points > 0
           and el.expires_on between current_date and current_date + 90), 0) as expiring_points,
        (select max(pt.occurred_at)
         from public.point_transactions pt
         join public.program_accounts pa on pa.id = pt.account_id
         where pa.client_id = c.id) as last_movement_at
      from public.clients c
      where normalized_search is null or c.full_name ilike '%' || normalized_search || '%'
    ), paged as (
      select *
      from filtered
      order by full_name, id
      limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'clientId', p.id,
          'publicId', p.public_id,
          'fullName', p.full_name,
          'status', p.status,
          'totalPoints', p.total_points,
          'programsCount', p.programs_count,
          'activeClubsCount', p.active_clubs_count,
          'nextExpirationDate', p.next_expiration_date,
          'expiringPoints', p.expiring_points,
          'lastMovementAt', p.last_movement_at
        ) order by p.full_name, p.id)
        from paged p
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'limit', safe_limit,
      'offset', safe_offset
    )
  );
end;
$$;

create or replace function public.get_admin_client_points_detail(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved_client public.clients%rowtype;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;

  select * into resolved_client from public.clients where id = p_client_id;
  if resolved_client.id is null then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'client', jsonb_build_object(
      'id', resolved_client.id,
      'publicId', resolved_client.public_id,
      'fullName', resolved_client.full_name,
      'status', resolved_client.status,
      'contractStatus', (
        select mc.status from public.management_contracts mc
        where mc.client_id = resolved_client.id
        order by mc.ends_on desc, mc.created_at desc limit 1
      ),
      'totalPoints', coalesce((
        select sum(coalesce(latest.balance, 0))
        from public.program_accounts pa
        left join lateral (
          select bs.balance from public.balance_snapshots bs
          where bs.account_id = pa.id order by bs.captured_at desc, bs.id desc limit 1
        ) latest on true
        where pa.client_id = resolved_client.id and pa.active
      ), 0),
      'estimatedValue', coalesce((
        select sum(coalesce(latest.estimated_value, 0))
        from public.program_accounts pa
        left join lateral (
          select bs.estimated_value from public.balance_snapshots bs
          where bs.account_id = pa.id order by bs.captured_at desc, bs.id desc limit 1
        ) latest on true
        where pa.client_id = resolved_client.id and pa.active
      ), 0),
      'expiringPoints', coalesce((
        select sum(el.remaining_points)
        from public.expiration_lots el
        join public.program_accounts pa on pa.id = el.account_id
        where pa.client_id = resolved_client.id and el.status = 'active'
          and el.remaining_points > 0 and el.expires_on between current_date and current_date + 90
      ), 0)
    ),
    'canWrite', public.can_write_client_data(),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'programId', lp.id,
        'slug', lp.slug,
        'name', lp.name,
        'logoUrl', lp.logo_url,
        'accountId', pa.id,
        'balance', coalesce(latest.balance, 0),
        'averageCostPerThousand', coalesce(latest.average_cost_per_thousand, 0),
        'estimatedValue', coalesce(latest.estimated_value, 0),
        'marketValuePerThousand', lp.default_value_per_thousand,
        'clubActive', coalesce(pa.club_active, false),
        'clubUpdatedAt', pa.club_updated_at,
        'expiringPoints', coalesce((
          select sum(el.remaining_points) from public.expiration_lots el
          where el.account_id = pa.id and el.status = 'active' and el.remaining_points > 0
            and el.expires_on between current_date and current_date + 90
        ), 0),
        'nextExpirationDate', (
          select min(el.expires_on) from public.expiration_lots el
          where el.account_id = pa.id and el.status = 'active' and el.remaining_points > 0
            and el.expires_on >= current_date
        ),
        'lastUpdatedAt', latest.captured_at
      ) order by lp.name)
      from public.loyalty_programs lp
      left join public.program_accounts pa
        on pa.program_id = lp.id and pa.client_id = resolved_client.id
      left join lateral (
        select bs.balance, bs.average_cost_per_thousand, bs.estimated_value, bs.captured_at
        from public.balance_snapshots bs
        where bs.account_id = pa.id
        order by bs.captured_at desc, bs.id desc limit 1
      ) latest on true
      where lp.active
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rows.id,
        'programId', rows.program_id,
        'programName', rows.program_name,
        'entryCategory', rows.entry_category,
        'entryDate', rows.entry_date,
        'pointsAmount', rows.points_delta,
        'cashTotal', rows.cash_total,
        'costPerThousand', rows.cost_per_thousand,
        'expiresOn', rows.expires_on,
        'description', rows.description,
        'createdAt', rows.created_at
      ) order by rows.entry_date desc nulls last, rows.created_at desc)
      from (
        select pt.*, pa.program_id, lp.name as program_name
        from public.point_transactions pt
        join public.program_accounts pa on pa.id = pt.account_id
        join public.loyalty_programs lp on lp.id = pa.program_id
        where pa.client_id = resolved_client.id
        order by pt.entry_date desc nulls last, pt.created_at desc
        limit 100
      ) rows
    ), '[]'::jsonb),
    'expirationLots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', el.id,
        'programId', pa.program_id,
        'programName', lp.name,
        'expiresOn', el.expires_on,
        'pointsAmount', el.points_amount,
        'remainingPoints', el.remaining_points,
        'status', el.status,
        'notes', el.notes,
        'sourceTransactionId', el.source_transaction_id,
        'createdAt', el.created_at
      ) order by el.expires_on, el.created_at)
      from public.expiration_lots el
      join public.program_accounts pa on pa.id = el.account_id
      join public.loyalty_programs lp on lp.id = pa.program_id
      where pa.client_id = resolved_client.id and el.status = 'active' and el.remaining_points > 0
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.record_point_entry(
  p_client_id uuid,
  p_program_id uuid,
  p_entry_category public.point_entry_category,
  p_entry_date date,
  p_points_amount bigint,
  p_valuation_mode text,
  p_entered_value numeric,
  p_expires_on date default null,
  p_notes text default null,
  p_operation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  account_row public.program_accounts%rowtype;
  program_row public.loyalty_programs%rowtype;
  current_balance bigint := 0;
  current_average numeric(14,4) := 0;
  new_balance bigint;
  cash_total_value numeric(16,2);
  per_thousand_value numeric(14,4);
  new_average numeric(14,4);
  transaction_kind public.point_transaction_type;
  description_value text;
  occurred_value timestamptz;
  captured_value timestamptz := clock_timestamp();
  transaction_row public.point_transactions%rowtype;
  expiration_row public.expiration_lots%rowtype;
  existing_operation public.point_transactions%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then
    raise exception 'Você não possui permissão para alterar este cliente.' using errcode = '42501';
  end if;
  if p_entry_date is null or p_entry_date > current_date then
    raise exception 'A data da entrada não pode estar no futuro.' using errcode = '22007';
  end if;
  if p_points_amount is null or p_points_amount <= 0 then
    raise exception 'Informe uma quantidade maior que zero.' using errcode = '22003';
  end if;
  if p_valuation_mode not in ('total_value', 'per_thousand') then
    raise exception 'Selecione VT ou VM.' using errcode = '22023';
  end if;
  if p_entered_value is null or p_entered_value < 0 then
    raise exception 'O valor informado não pode ser negativo.' using errcode = '22003';
  end if;
  if p_expires_on is not null and p_expires_on < p_entry_date then
    raise exception 'A validade não pode ser anterior à entrada.' using errcode = '22007';
  end if;
  if p_entry_category = 'other' and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'Informe a observação para o tipo Outros.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.status = 'active') then
    raise exception 'Cliente ativo não encontrado.' using errcode = 'P0002';
  end if;

  select * into program_row
  from public.loyalty_programs lp where lp.id = p_program_id and lp.active;
  if program_row.id is null then
    raise exception 'Selecione um programa.' using errcode = 'P0002';
  end if;

  insert into public.program_accounts (client_id, program_id, active, created_by)
  values (p_client_id, p_program_id, true, actor_id)
  on conflict (client_id, program_id) do nothing
  returning * into account_row;

  if account_row.id is null then
    select * into account_row
    from public.program_accounts
    where client_id = p_client_id and program_id = p_program_id;
  end if;

  select * into account_row
  from public.program_accounts
  where id = account_row.id
  for update;

  if not account_row.active then
    update public.program_accounts set active = true where id = account_row.id returning * into account_row;
  end if;

  select * into existing_operation
  from public.point_transactions pt
  where pt.operation_id = p_operation_id;

  if existing_operation.id is not null then
    if existing_operation.account_id <> account_row.id
       or existing_operation.entry_category <> p_entry_category
       or existing_operation.entry_date <> p_entry_date
       or existing_operation.points_delta <> p_points_amount then
      raise exception 'A chave da operação já foi utilizada.' using errcode = '23505';
    end if;
    select coalesce(bs.balance, 0), coalesce(bs.average_cost_per_thousand, 0)
      into current_balance, current_average
    from public.balance_snapshots bs
    where bs.account_id = account_row.id
    order by bs.captured_at desc, bs.id desc limit 1;
    if not found then
      current_balance := 0;
      current_average := 0;
    end if;
    return jsonb_build_object(
      'transactionId', existing_operation.id,
      'accountId', account_row.id,
      'newBalance', current_balance,
      'newAverageCostPerThousand', current_average,
      'expirationLotId', (select el.id from public.expiration_lots el where el.source_transaction_id = existing_operation.id),
      'idempotentReplay', true
    );
  end if;

  select coalesce(bs.balance, 0), coalesce(bs.average_cost_per_thousand, 0)
    into current_balance, current_average
  from public.balance_snapshots bs
  where bs.account_id = account_row.id
  order by bs.captured_at desc, bs.id desc limit 1;
  if not found then
    current_balance := 0;
    current_average := 0;
  end if;

  if p_entry_category = 'initial_balance' and exists (
    select 1 from public.point_transactions pt
    where pt.account_id = account_row.id and pt.entry_category = 'initial_balance'
  ) then
    raise exception 'Já existe um saldo inicial para este programa.' using errcode = '23505';
  end if;

  if p_valuation_mode = 'total_value' then
    cash_total_value := round(p_entered_value, 2);
    per_thousand_value := round(cash_total_value / (p_points_amount::numeric / 1000), 4);
  else
    per_thousand_value := round(p_entered_value, 4);
    cash_total_value := round((p_points_amount::numeric / 1000) * per_thousand_value, 2);
  end if;

  new_balance := current_balance + p_points_amount;
  new_average := case when new_balance = 0 then 0 else round(
    (((current_balance::numeric / 1000) * current_average) + cash_total_value)
    / (new_balance::numeric / 1000), 4
  ) end;

  transaction_kind := case p_entry_category
    when 'initial_balance' then 'adjustment'::public.point_transaction_type
    when 'transfer' then 'transfer_in'::public.point_transaction_type
    else 'credit'::public.point_transaction_type
  end;
  description_value := coalesce(nullif(trim(coalesce(p_notes, '')), ''), case p_entry_category
    when 'initial_balance' then 'Saldo inicial cadastrado pela equipe MRL Travel.'
    when 'points_purchase' then 'Compra de pontos cadastrada pela equipe MRL Travel.'
    when 'transfer' then 'Transferência de entrada cadastrada pela equipe MRL Travel.'
    when 'credit_card' then 'Pontos de cartão de crédito cadastrados pela equipe MRL Travel.'
    else 'Entrada de pontos cadastrada pela equipe MRL Travel.'
  end);
  occurred_value := p_entry_date::timestamp at time zone 'America/Sao_Paulo';

  insert into public.point_transactions (
    account_id, occurred_at, transaction_type, points_delta, description,
    expires_on, source, created_by, entry_category, entry_date,
    valuation_mode, cash_total, cost_per_thousand, operation_id
  ) values (
    account_row.id, occurred_value, transaction_kind, p_points_amount, description_value,
    p_expires_on, 'admin_points_management', actor_id, p_entry_category, p_entry_date,
    p_valuation_mode, cash_total_value, per_thousand_value, p_operation_id
  ) returning * into transaction_row;

  if p_expires_on is not null then
    insert into public.expiration_lots (
      account_id, expires_on, points_amount, status, notes, created_by, source_transaction_id
    ) values (
      account_row.id, p_expires_on, p_points_amount, 'active', description_value, actor_id, transaction_row.id
    ) returning * into expiration_row;
  end if;

  insert into public.balance_snapshots (
    account_id, captured_at, balance, average_cost_per_thousand,
    value_per_thousand, source, notes, created_by
  ) values (
    account_row.id, captured_value, new_balance, new_average,
    program_row.default_value_per_thousand, 'admin_points_management', description_value, actor_id
  );

  return jsonb_build_object(
    'transactionId', transaction_row.id,
    'accountId', account_row.id,
    'newBalance', new_balance,
    'newAverageCostPerThousand', new_average,
    'cashTotal', cash_total_value,
    'costPerThousand', per_thousand_value,
    'expirationLotId', expiration_row.id,
    'idempotentReplay', false
  );
exception
  when unique_violation then
    if p_entry_category = 'initial_balance' then
      raise exception 'Já existe um saldo inicial para este programa.' using errcode = '23505';
    end if;
    raise exception 'O lançamento não foi concluído. Nenhum dado foi alterado.' using errcode = '23505';
end;
$$;

create or replace function public.set_program_club_status(
  p_client_id uuid,
  p_program_id uuid,
  p_club_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  account_row public.program_accounts%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then
    raise exception 'Você não possui permissão para alterar este cliente.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and status = 'active')
     or not exists (select 1 from public.loyalty_programs where id = p_program_id and active) then
    raise exception 'Cliente ou programa ativo não encontrado.' using errcode = 'P0002';
  end if;

  insert into public.program_accounts (client_id, program_id, active, club_active, club_updated_at, created_by)
  values (p_client_id, p_program_id, true, p_club_active, clock_timestamp(), actor_id)
  on conflict (client_id, program_id) do update set
    active = true,
    club_active = excluded.club_active,
    club_updated_at = excluded.club_updated_at,
    updated_at = clock_timestamp()
  returning * into account_row;

  return jsonb_build_object(
    'accountId', account_row.id,
    'programId', account_row.program_id,
    'clubActive', account_row.club_active,
    'clubUpdatedAt', account_row.club_updated_at
  );
end;
$$;

create or replace function public.add_expiration_lot(
  p_client_id uuid,
  p_program_id uuid,
  p_points_amount bigint,
  p_expires_on date,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  account_row public.program_accounts%rowtype;
  current_balance bigint := 0;
  classified_points bigint := 0;
  lot_row public.expiration_lots%rowtype;
begin
  if actor_id is null or not public.can_write_client_data() then
    raise exception 'Você não possui permissão para alterar este cliente.' using errcode = '42501';
  end if;
  if p_points_amount is null or p_points_amount <= 0 then
    raise exception 'Informe uma quantidade maior que zero.' using errcode = '22003';
  end if;
  if p_expires_on is null or p_expires_on < current_date then
    raise exception 'A data de vencimento não pode estar no passado.' using errcode = '22007';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and status = 'active')
     or not exists (select 1 from public.loyalty_programs where id = p_program_id and active) then
    raise exception 'Cliente ou programa ativo não encontrado.' using errcode = 'P0002';
  end if;

  select * into account_row from public.program_accounts
  where client_id = p_client_id and program_id = p_program_id and active
  for update;
  if account_row.id is null then
    raise exception 'O programa ainda não possui saldo para classificar.' using errcode = 'P0002';
  end if;

  select coalesce(bs.balance, 0) into current_balance
  from public.balance_snapshots bs
  where bs.account_id = account_row.id
  order by bs.captured_at desc, bs.id desc limit 1;
  if not found then
    current_balance := 0;
  end if;

  select coalesce(sum(el.remaining_points), 0) into classified_points
  from public.expiration_lots el
  where el.account_id = account_row.id and el.status = 'active' and el.remaining_points > 0;

  if classified_points + p_points_amount > current_balance then
    raise exception 'A quantidade com vencimento ultrapassa o saldo disponível.' using errcode = '23514';
  end if;

  insert into public.expiration_lots (
    account_id, expires_on, points_amount, status, notes, created_by
  ) values (
    account_row.id, p_expires_on, p_points_amount, 'active', nullif(trim(coalesce(p_notes, '')), ''), actor_id
  ) returning * into lot_row;

  return jsonb_build_object(
    'lotId', lot_row.id,
    'accountId', lot_row.account_id,
    'expiresOn', lot_row.expires_on,
    'pointsAmount', lot_row.points_amount,
    'remainingPoints', lot_row.remaining_points
  );
end;
$$;

revoke all on function public.get_admin_clients(text, integer, integer) from public, anon;
revoke all on function public.get_admin_client_points_detail(uuid) from public, anon;
revoke all on function public.record_point_entry(uuid, uuid, public.point_entry_category, date, bigint, text, numeric, date, text, uuid) from public, anon;
revoke all on function public.set_program_club_status(uuid, uuid, boolean) from public, anon;
revoke all on function public.add_expiration_lot(uuid, uuid, bigint, date, text) from public, anon;

grant execute on function public.get_admin_clients(text, integer, integer) to authenticated;
grant execute on function public.get_admin_client_points_detail(uuid) to authenticated;
grant execute on function public.record_point_entry(uuid, uuid, public.point_entry_category, date, bigint, text, numeric, date, text, uuid) to authenticated;
grant execute on function public.set_program_club_status(uuid, uuid, boolean) to authenticated;
grant execute on function public.add_expiration_lot(uuid, uuid, bigint, date, text) to authenticated;

commit;
