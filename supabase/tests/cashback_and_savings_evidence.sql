begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000923','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cashback-admin@example.invalid','',now(),'{}','{"full_name":"Cashback Admin"}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000000923','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,created_by) values
('00000000-0000-0000-0000-000000000924','Cliente Cashback A','cliente','cashback-a@example.invalid','active','00000000-0000-0000-0000-000000000923'),
('00000000-0000-0000-0000-000000000925','Cliente Cashback B','cliente','cashback-b@example.invalid','active','00000000-0000-0000-0000-000000000923');

select is((select count(*) from public.iddas_savings_source_rows),68::bigint,'as 68 economias legadas permanecem na fonte canônica');
select is((select sum(verified_savings_value_brl) from public.iddas_savings_source_rows),130404.85::numeric,'economia legada permanece em R$ 130.404,85');
select is((select sum(points) from public.iddas_balance_source_rows),3080020::numeric,'saldo do PATCH 020 permanece em 3.080.020 pontos');
select is((select cashback_enabled from public.clients where id='00000000-0000-0000-0000-000000000924'),false,'novo cliente começa sem cashback');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000923',true);

select is((public.update_client_cashback_config('00000000-0000-0000-0000-000000000924',true,10,'Habilitação para teste')->>'enabled')::boolean,true,'administrador habilita cashback');

create temporary table first_sale as
select public.record_travel_sale(
  p_client_id=>'00000000-0000-0000-0000-000000000924',p_launched_on=>current_date,p_payment_mode=>'cash',p_travel_type=>'flight',p_details=>'Teste obrigatório 1000 por 500',p_original_value=>1000,p_paid_value=>500,p_operation_id=>'10000000-0000-0000-0000-000000000001',p_cashback_percentage=>10
) result;
select is((select (result->>'savingsAmount')::numeric from first_sale),500.00::numeric,'R$ 1.000 menos R$ 500 produz R$ 500 de economia');
select is((select (result->>'cashbackAmount')::numeric from first_sale),50.00::numeric,'10% de R$ 500 produz exatamente R$ 50 de cashback');
select is((select count(*) from public.cashback_transactions where client_id='00000000-0000-0000-0000-000000000924' and transaction_type='earning'),1::bigint,'confirmação cria exatamente um earning');
select is((public.record_travel_sale(p_client_id=>'00000000-0000-0000-0000-000000000924',p_launched_on=>current_date,p_payment_mode=>'cash',p_travel_type=>'flight',p_details=>'Teste obrigatório 1000 por 500',p_original_value=>1000,p_paid_value=>500,p_operation_id=>'10000000-0000-0000-0000-000000000001',p_cashback_percentage=>10)->>'idempotentReplay')::boolean,true,'repetição retorna replay idempotente');
select is((select count(*) from public.cashback_transactions where idempotency_key='10000000-0000-0000-0000-000000000001'),1::bigint,'repetição não duplica o crédito');

select is((public.record_travel_sale(p_client_id=>'00000000-0000-0000-0000-000000000924',p_launched_on=>current_date,p_payment_mode=>'cash',p_travel_type=>'hotel',p_details=>'Economia sem percentual',p_original_value=>800,p_paid_value=>700,p_operation_id=>'10000000-0000-0000-0000-000000000002',p_cashback_percentage=>null)->>'cashbackAmount')::numeric,0::numeric,'percentual vazio produz cashback zero');
select is((public.record_travel_sale(p_client_id=>'00000000-0000-0000-0000-000000000925',p_launched_on=>current_date,p_payment_mode=>'cash',p_travel_type=>'other',p_details=>'Cliente com cashback desabilitado',p_original_value=>1000,p_paid_value=>500,p_operation_id=>'10000000-0000-0000-0000-000000000003',p_cashback_percentage=>10)->>'cashbackAmount')::numeric,0::numeric,'backend ignora percentual enviado para cliente desabilitado');

select is((public.update_client_cashback_config('00000000-0000-0000-0000-000000000925',true,7.5,'Habilitação para arredondamento')->>'defaultPercentage')::numeric,7.50::numeric,'percentual padrão aceita duas casas');
select is((public.record_travel_sale(p_client_id=>'00000000-0000-0000-0000-000000000925',p_launched_on=>current_date,p_payment_mode=>'cash',p_travel_type=>'hotel',p_details=>'Teste de arredondamento',p_original_value=>2235.50,p_paid_value=>1100.25,p_operation_id=>'10000000-0000-0000-0000-000000000004',p_cashback_percentage=>7.5)->>'cashbackAmount')::numeric,82.52::numeric,'R$ 1.100,25 a 7,5% arredonda para R$ 82,52');
select throws_ok($$select public.record_travel_sale(p_client_id=>'00000000-0000-0000-0000-000000000925',p_launched_on=>current_date,p_payment_mode=>'cash',p_travel_type=>'hotel',p_details=>'Percentual inválido',p_original_value=>100,p_paid_value=>50,p_operation_id=>'10000000-0000-0000-0000-000000000005',p_cashback_percentage=>101)$$,'22023','INVALID_CASHBACK_PERCENTAGE','percentual acima de 100 é rejeitado');
select is((public.record_travel_sale(p_client_id=>'00000000-0000-0000-0000-000000000925',p_launched_on=>current_date,p_payment_mode=>'cash',p_travel_type=>'other',p_details=>'Valor pago zero',p_original_value=>500,p_paid_value=>0,p_operation_id=>'10000000-0000-0000-0000-000000000006',p_cashback_percentage=>10)->>'cashbackAmount')::numeric,0::numeric,'valor pago zero não gera cashback');

select is((public.record_cashback_redemption('00000000-0000-0000-0000-000000000924',20,'Pagamento parcial ao cliente','20000000-0000-0000-0000-000000000001')->'summary'->>'available')::numeric,30.00::numeric,'utilização reduz o saldo disponível');
select is((select count(*) from public.cashback_transactions where client_id='00000000-0000-0000-0000-000000000924' and transaction_type='redemption'),1::bigint,'utilização entra no ledger');
select is((public.record_cashback_redemption('00000000-0000-0000-0000-000000000924',20,'Pagamento parcial ao cliente','20000000-0000-0000-0000-000000000001')->>'idempotentReplay')::boolean,true,'repetição da utilização é idempotente');
select throws_ok($$select public.record_cashback_redemption('00000000-0000-0000-0000-000000000924',31,'Tentativa acima do saldo','20000000-0000-0000-0000-000000000002')$$,'23514','INSUFFICIENT_CASHBACK_BALANCE','utilização acima do saldo é bloqueada');

select is((public.update_client_cashback_config('00000000-0000-0000-0000-000000000924',false,null,'Desabilitação preservando histórico')->'summary'->>'available')::numeric,30.00::numeric,'desabilitar preserva saldo e histórico');
select is((select count(*) from public.cashback_transactions where client_id='00000000-0000-0000-0000-000000000924'),2::bigint,'alterar configuração não cria nem recalcula créditos');

select throws_ok(format($sql$select public.admin_update_travel_saving(%L,current_date,'flight','Correção bloqueada',1000,500,20,'Tentativa após utilização',null)$sql$,(select result->>'saleId' from first_sale)),'55000','CASHBACK_ALREADY_USED','economia cujo cashback foi utilizado exige ajuste auditado');

create temporary table correctable_sale as
select public.record_travel_sale(p_client_id=>'00000000-0000-0000-0000-000000000925',p_launched_on=>current_date,p_payment_mode=>'cash',p_travel_type=>'flight',p_details=>'Economia corrigível',p_original_value=>1000,p_paid_value=>500,p_operation_id=>'10000000-0000-0000-0000-000000000007',p_cashback_percentage=>10) result;
select is((public.admin_update_travel_saving((select (result->>'saleId')::uuid from correctable_sale),current_date,'flight','Economia corrigida',1000,500,20,'Correção percentual auditada',null)->>'cashbackAmount')::numeric,100.00::numeric,'correção não utilizada recalcula cashback');
select is((select count(*) from public.cashback_transactions where redemption_id=(select (result->>'saleId')::uuid from correctable_sale) and transaction_type='reversal'),1::bigint,'correção gera um estorno do crédito anterior');
select is((select count(*) from public.cashback_transactions where redemption_id=(select (result->>'saleId')::uuid from correctable_sale) and transaction_type='earning'),2::bigint,'correção gera novo earning sem sobrescrever o anterior');
select is((public.admin_cancel_travel_saving((select (result->>'saleId')::uuid from correctable_sale),'Cancelamento testado',null)->>'idempotentReplay')::boolean,false,'cancelamento confirmado cria estorno');
select is((public.admin_cancel_travel_saving((select (result->>'saleId')::uuid from correctable_sale),'Cancelamento repetido',null)->>'idempotentReplay')::boolean,true,'cancelamento repetido não duplica estorno');

reset role;
select is((select count(*) from public.redemptions where source_system='iddas' and cashback_amount<>0),0::bigint,'nenhuma economia legada recebe cashback retroativo');
select is((select count(*) from public.cashback_transactions t join public.redemptions r on r.id=t.redemption_id where r.source_system='iddas'),0::bigint,'nenhum earning retroativo é criado para o Iddas');

select * from finish();
rollback;
