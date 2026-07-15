begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-test@example.invalid', '', now(), '{}'::jsonb, '{"full_name":"Admin Teste"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operator-test@example.invalid', '', now(), '{}'::jsonb, '{"full_name":"Operador Teste"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'auditor-test@example.invalid', '', now(), '{}'::jsonb, '{"full_name":"Auditor Teste"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client-test@example.invalid', '', now(), '{}'::jsonb, '{"full_name":"Cliente Teste"}'::jsonb, now(), now());

insert into public.staff_members (user_id, role, active) values
  ('00000000-0000-0000-0000-000000000101', 'super_admin', true),
  ('00000000-0000-0000-0000-000000000102', 'operator', true),
  ('00000000-0000-0000-0000-000000000103', 'auditor', true);

insert into public.clients (id, full_name, first_name_normalized, email, status, created_by) values
  ('00000000-0000-0000-0000-000000000201', 'Cliente Alfa', 'cliente', 'alfa@example.invalid', 'active', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000202', 'Cliente Beta', 'cliente', 'beta@example.invalid', 'active', '00000000-0000-0000-0000-000000000101');

insert into public.client_users (client_id, user_id, role, active, created_by)
values ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000104', 'client', true, '00000000-0000-0000-0000-000000000101');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);

select is((public.get_admin_clients(null, 20, 0) ->> 'total')::integer, 2, 'staff lista clientes');
select ok(jsonb_array_length(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000201') -> 'programs') >= 6, 'detalhe inclui programas ativos sem conta');

select is(
  (public.record_point_entry(
    '00000000-0000-0000-0000-000000000201',
    (select id from public.loyalty_programs where slug = 'smiles'),
    'initial_balance', current_date, 100000, 'total_value', 1500, null, null,
    '00000000-0000-0000-0000-000000000301'
  ) ->> 'newBalance')::bigint,
  100000::bigint,
  'saldo inicial cria conta e saldo'
);
select is((select count(*) from public.program_accounts where client_id = '00000000-0000-0000-0000-000000000201'), 1::bigint, 'conta criada automaticamente');
select is((select count(*) from public.point_transactions where operation_id = '00000000-0000-0000-0000-000000000301'), 1::bigint, 'transação criada');
select is((select count(*) from public.balance_snapshots bs join public.program_accounts pa on pa.id = bs.account_id where pa.client_id = '00000000-0000-0000-0000-000000000201'), 1::bigint, 'snapshot criado na mesma operação');

select throws_ok(
  $$select public.record_point_entry('00000000-0000-0000-0000-000000000201', (select id from public.loyalty_programs where slug = 'smiles'), 'initial_balance', current_date, 1, 'total_value', 0, null, null, '00000000-0000-0000-0000-000000000302')$$,
  '23505', 'Já existe um saldo inicial para este programa.', 'saldo inicial duplicado é bloqueado'
);

select is(
  (public.record_point_entry(
    '00000000-0000-0000-0000-000000000201',
    (select id from public.loyalty_programs where slug = 'smiles'),
    'points_purchase', current_date, 20000, 'total_value', 400, current_date + 30, 'Compra teste',
    '00000000-0000-0000-0000-000000000303'
  ) ->> 'newAverageCostPerThousand')::numeric,
  15.8333::numeric,
  'custo médio ponderado calculado no banco'
);
select is((select balance from public.balance_snapshots bs join public.program_accounts pa on pa.id = bs.account_id where pa.client_id = '00000000-0000-0000-0000-000000000201' order by bs.captured_at desc limit 1), 120000::bigint, 'novo saldo calculado');
select is((select count(*) from public.expiration_lots where source_transaction_id = (select id from public.point_transactions where operation_id = '00000000-0000-0000-0000-000000000303')), 1::bigint, 'validade cria lote vinculado');
select is((public.record_point_entry('00000000-0000-0000-0000-000000000201', (select id from public.loyalty_programs where slug = 'smiles'), 'points_purchase', current_date, 20000, 'total_value', 400, current_date + 30, 'Compra teste', '00000000-0000-0000-0000-000000000303') ->> 'idempotentReplay')::boolean, true, 'reenvio é idempotente');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select is((public.set_program_club_status('00000000-0000-0000-0000-000000000201', (select id from public.loyalty_programs where slug = 'smiles'), true) ->> 'clubActive')::boolean, true, 'operador altera clube do programa');
select is((public.add_expiration_lot('00000000-0000-0000-0000-000000000201', (select id from public.loyalty_programs where slug = 'smiles'), 30000, current_date + 60, 'Lote manual') ->> 'pointsAmount')::bigint, 30000::bigint, 'vencimento manual não altera saldo');
select is((select balance from public.balance_snapshots bs join public.program_accounts pa on pa.id = bs.account_id where pa.client_id = '00000000-0000-0000-0000-000000000201' order by bs.captured_at desc limit 1), 120000::bigint, 'vencimento manual preserva saldo');
select throws_ok(
  $$select public.add_expiration_lot('00000000-0000-0000-0000-000000000201', (select id from public.loyalty_programs where slug = 'smiles'), 80000, current_date + 90, null)$$,
  '23514', 'A quantidade com vencimento ultrapassa o saldo disponível.', 'vencimentos não ultrapassam saldo'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
select throws_ok(
  $$select public.set_program_club_status('00000000-0000-0000-0000-000000000201', (select id from public.loyalty_programs where slug = 'smiles'), false)$$,
  '42501', 'Você não possui permissão para alterar este cliente.', 'auditor não altera clube'
);
select lives_ok($$select public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000201')$$, 'auditor possui leitura');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000104', true);
select throws_ok(
  $$select public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000201')$$,
  '42501', 'Acesso não autorizado', 'cliente não acessa RPC administrativo'
);
select throws_ok(
  $$select public.get_client_dashboard((select public_id from public.clients where id = '00000000-0000-0000-0000-000000000202'))$$,
  '42501', 'Acesso não autorizado', 'cliente A não acessa cliente B'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select ok(exists(select 1 from public.audit_logs where actor_user_id = '00000000-0000-0000-0000-000000000101' and table_name in ('point_transactions', 'balance_snapshots')), 'auditoria registra ator e tabelas');

select * from finish();
rollback;
