begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000002600','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch026-admin@example.invalid','',now(),'{}','{"full_name":"Patch 026 Admin"}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000002600','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,cashback_enabled,cashback_default_percentage,created_by) values
('00000000-0000-0000-0000-000000002601','Patch 026 Anulável','anulavel','patch026-a@example.invalid','active',true,2,'00000000-0000-0000-0000-000000002600'),
('00000000-0000-0000-0000-000000002602','Patch 026 Consumido','consumido','patch026-b@example.invalid','active',true,10,'00000000-0000-0000-0000-000000002600'),
('00000000-0000-0000-0000-000000002603','Rafael Patch 026','rafael','patch026-rafael@example.invalid','active',true,2,'00000000-0000-0000-0000-000000002600');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002600',true);

create temporary table patch026_sale as
select public.record_travel_sale(
  p_client_id=>'00000000-0000-0000-0000-000000002601',p_launched_on=>current_date,
  p_payment_mode=>'cash',p_travel_type=>'flight',p_details=>'Compra original dez mil, paga mil',
  p_original_value=>10000,p_paid_value=>1000,p_operation_id=>'00000000-0000-0000-0000-000000002611',
  p_cashback_percentage=>2
) result;

select is((select (result->>'savingsAmount')::numeric from patch026_sale),9000.00::numeric,'economia é original menos pago');
select is((select (result->>'cashbackAmount')::numeric from patch026_sale),20.00::numeric,'cashback é 2% do valor pago');
select isnt((select (result->>'cashbackAmount')::numeric from patch026_sale),180.00::numeric,'backend não usa economia como base');
reset role;
select is((public.cashback_snapshot('00000000-0000-0000-0000-000000002601')->>'generated')::numeric,20.00::numeric,'resumo oficial gera R$ 20');
select is(jsonb_array_length(public.build_public_client_cashback('00000000-0000-0000-0000-000000002601')->'transactions'),1,'painel público consolida uma linha oficial');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002600',true);
select is((public.admin_preview_travel_saving_void((select (result->>'saleId')::uuid from patch026_sale))->>'available')::numeric,20.00::numeric,'prévia mostra cashback disponível');
select is((public.admin_preview_travel_saving_void((select (result->>'saleId')::uuid from patch026_sale))->>'blocked')::boolean,false,'anulação sem consumo é permitida');
select is((public.admin_void_travel_saving((select (result->>'saleId')::uuid from patch026_sale),'Reserva criada por engano',null)->>'idempotentReplay')::boolean,false,'primeira anulação é efetiva');
select is((public.admin_void_travel_saving((select (result->>'saleId')::uuid from patch026_sale),'Repetição idempotente',null)->>'idempotentReplay')::boolean,true,'repetição da anulação é idempotente');
reset role;
select is(jsonb_array_length(public.build_public_client_savings_history('00000000-0000-0000-0000-000000002601')),0,'economia anulada não aparece no painel público');
select is(jsonb_array_length(public.build_public_client_cashback('00000000-0000-0000-0000-000000002601')->'transactions'),0,'crédito e estorno da operação anulada não aparecem no painel público');
select is((public.cashback_snapshot('00000000-0000-0000-0000-000000002601')->>'available')::numeric,0.00::numeric,'saldo público exclui integralmente a operação anulada');
select is((select count(*) from public.cashback_transactions where redemption_id=(select (result->>'saleId')::uuid from patch026_sale)),2::bigint,'razão administrativo preserva crédito e estorno');
select is((select count(distinct operation_group_id) from public.cashback_transactions where redemption_id=(select (result->>'saleId')::uuid from patch026_sale)),1::bigint,'cadeia financeira usa um grupo explícito');
select is((select count(*) from public.cashback_transactions where redemption_id=(select (result->>'saleId')::uuid from patch026_sale) and visibility_scope<>'admin_only'),0::bigint,'toda a cadeia vinculada é somente administrativa');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002600',true);
create temporary table patch026_used_sale as
select public.record_travel_sale(
  p_client_id=>'00000000-0000-0000-0000-000000002602',p_launched_on=>current_date,
  p_payment_mode=>'cash',p_travel_type=>'hotel',p_details=>'Economia com cashback consumido',
  p_original_value=>500,p_paid_value=>400,p_operation_id=>'00000000-0000-0000-0000-000000002621',
  p_cashback_percentage=>10
) result;
select public.record_cashback_redemption_v2('00000000-0000-0000-0000-000000002602',10,'Abatimento confirmado','00000000-0000-0000-0000-000000002622','usage');
select is((public.admin_preview_travel_saving_void((select (result->>'saleId')::uuid from patch026_used_sale))->>'used')::numeric,10.00::numeric,'prévia distingue cashback utilizado');
select is((public.admin_preview_travel_saving_void((select (result->>'saleId')::uuid from patch026_used_sale))->>'blocked')::boolean,true,'consumo parcial bloqueia anulação automática');
select throws_ok(format($sql$select public.admin_void_travel_saving(%L,'Tentativa deve ser bloqueada',null)$sql$,(select result->>'saleId' from patch026_used_sale)),'55000','CASHBACK_REGULARIZATION_REQUIRED','anulação consumida exige regularização');

select public.record_cashback_redemption_v2('00000000-0000-0000-0000-000000002602',5,'Pagamento ao cliente','00000000-0000-0000-0000-000000002623','payment');
select is((public.get_admin_client_cashback('00000000-0000-0000-0000-000000002602')->'summary'->>'paid')::numeric,5.00::numeric,'resumo distingue pagamento de utilização');
select is((public.record_cashback_redemption_v2('00000000-0000-0000-0000-000000002602',5,'Pagamento ao cliente','00000000-0000-0000-0000-000000002623','payment')->>'idempotentReplay')::boolean,true,'pagamento repetido não duplica lançamento');

reset role;
select * from finish();
rollback;
