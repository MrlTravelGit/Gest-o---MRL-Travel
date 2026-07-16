begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','manager-modules@example.invalid','',now(),'{}','{"full_name":"Gestor Teste"}',now(),now()),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','operator-modules@example.invalid','',now(),'{}','{"full_name":"Operador Teste"}',now(),now()),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','auditor-modules@example.invalid','',now(),'{}','{"full_name":"Auditor Teste"}',now(),now());
insert into public.staff_members(user_id,role,active) values
('10000000-0000-0000-0000-000000000001','manager',true),('10000000-0000-0000-0000-000000000002','operator',true),('10000000-0000-0000-0000-000000000003','auditor',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,birth_date) values
('10000000-0000-0000-0000-000000000101','Cliente Módulos','cliente','cliente-modulos@example.invalid','active','1990-01-01'),
('10000000-0000-0000-0000-000000000102','Cliente Isolado','cliente','isolado-modulos@example.invalid','active','1991-01-01');

set local role authenticated;
select set_config('request.jwt.claim.aal','aal2',true);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select ok((public.get_admin_overview()->>'canWrite')::boolean,'gestor com MFA pode escrever');
select is(jsonb_array_length(public.get_admin_form_options()->'clients'),2,'opções retornam clientes ativos');
select is((public.get_admin_clients(20,0,'','all')->>'total')::integer,2,'contrato oficial lista clientes ativos');
select is((public.get_admin_clients(20,0,'Isolado','active')->>'total')::integer,1,'contrato oficial preserva busca e status');

select is((public.record_point_entry('10000000-0000-0000-0000-000000000101',(select id from public.loyalty_programs where slug='smiles'),'initial_balance',current_date,50000,'total_value',750,null,'Saldo origem','10000000-0000-0000-0000-000000000201')->>'newBalance')::bigint,50000::bigint,'cria saldo de origem');
select is((public.record_point_entry('10000000-0000-0000-0000-000000000101',(select id from public.loyalty_programs where slug='livelo'),'initial_balance',current_date,1000,'total_value',20,null,'Saldo destino','10000000-0000-0000-0000-000000000202')->>'newBalance')::bigint,1000::bigint,'cria saldo de destino');

select is((public.confirm_transfer('10000000-0000-0000-0000-000000000101',current_date,(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' and program_id=(select id from public.loyalty_programs where slug='smiles')),(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' and program_id=(select id from public.loyalty_programs where slug='livelo')),20000,1,current_date,current_date+365,30,current_date,'Teste','10000000-0000-0000-0000-000000000203')->>'destinationTotal')::bigint,26000::bigint,'transferência calcula total');
select is((select count(*) from public.transfers where operation_id='10000000-0000-0000-0000-000000000203'),1::bigint,'transferência criada uma vez');
select ok((public.confirm_transfer('10000000-0000-0000-0000-000000000101',current_date,(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' and program_id=(select id from public.loyalty_programs where slug='smiles')),(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' and program_id=(select id from public.loyalty_programs where slug='livelo')),20000,1,current_date,current_date+365,30,current_date,'Teste','10000000-0000-0000-0000-000000000203')->>'idempotentReplay')::boolean,'retry de transferência é idempotente');
select is((select count(*) from public.point_transactions where metadata->>'transferId'=(select id::text from public.transfers where operation_id='10000000-0000-0000-0000-000000000203')),3::bigint,'origem, destino e bônus têm movimentos');
select throws_ok($$select public.confirm_transfer('10000000-0000-0000-0000-000000000101',current_date,(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' limit 1),(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000102' limit 1),1,1,current_date,null,0,null,null,'10000000-0000-0000-0000-000000000204')$$,'42501','As contas devem pertencer ao cliente.','nega conta de outro cliente');

select is((public.record_manual_exit('10000000-0000-0000-0000-000000000101',(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' and program_id=(select id from public.loyalty_programs where slug='smiles')),current_date,5000,'Ajuste autorizado','10000000-0000-0000-0000-000000000205')->>'newBalance')::bigint,25000::bigint,'saída reduz saldo');
select ok((public.record_manual_exit('10000000-0000-0000-0000-000000000101',(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' and program_id=(select id from public.loyalty_programs where slug='smiles')),current_date,5000,'Ajuste autorizado','10000000-0000-0000-0000-000000000205')->>'idempotentReplay')::boolean,'saída é idempotente');
select throws_ok($$select public.record_manual_exit('10000000-0000-0000-0000-000000000101',(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' and program_id=(select id from public.loyalty_programs where slug='smiles')),current_date,999999,'Excesso','10000000-0000-0000-0000-000000000206')$$,'23514','Saldo insuficiente.','nega saldo insuficiente');
select throws_ok($$select public.record_manual_exit('10000000-0000-0000-0000-000000000101',(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' limit 1),current_date,1,'','10000000-0000-0000-0000-000000000207')$$,'22023','A observação é obrigatória.','nega observação vazia');

select is((public.record_travel_sale('10000000-0000-0000-0000-000000000101',current_date,'cash','flight','Viagem em dinheiro',5000,3200,null,null,'10000000-0000-0000-0000-000000000208')->>'savingsAmount')::numeric,1800::numeric,'economia positiva');
select is((select savings_amount from public.redemptions where operation_id='10000000-0000-0000-0000-000000000209'),null::numeric,'controle antes da economia negativa');
select is((public.record_travel_sale('10000000-0000-0000-0000-000000000101',current_date,'cash','flight','Viagem acima da referência',3200,5000,null,null,'10000000-0000-0000-0000-000000000209')->>'savingsAmount')::numeric,-1800::numeric,'economia negativa preservada');
select is((public.upsert_travel_interest('10000000-0000-0000-0000-000000000101','Lisboa',current_date+10,current_date+20,'Férias','open',null)->>'status'),'open','cria interesse');
select throws_ok($$select public.upsert_travel_interest('10000000-0000-0000-0000-000000000101','Lisboa',current_date+20,current_date+10,'Férias','open',null)$$,'22007','A data final não pode ser anterior à inicial.','nega período invertido');
select is((public.get_points_ranking(null,20,0)->'items'->0->>'position')::integer,1,'ranking calculado no servidor');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.record_manual_exit('10000000-0000-0000-0000-000000000101',(select id from public.program_accounts where client_id='10000000-0000-0000-0000-000000000101' limit 1),current_date,1,'Auditor','10000000-0000-0000-0000-000000000210')$$,'42501','Você não possui permissão para registrar saídas.','auditor não muta');
select lives_ok($$select public.get_points_ranking(null,20,0)$$,'auditor consulta ranking');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.archive_client('10000000-0000-0000-0000-000000000101','Cliente Módulos')$$,'42501','Somente gestores podem arquivar clientes.','operator não arquiva');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select is(public.archive_client('10000000-0000-0000-0000-000000000102','Cliente Isolado')->>'status','ended','manager arquiva');
select ok(exists(select 1 from public.audit_logs where client_id='10000000-0000-0000-0000-000000000102' and action='archive_client'),'arquivamento auditado');

select * from finish();
rollback;
