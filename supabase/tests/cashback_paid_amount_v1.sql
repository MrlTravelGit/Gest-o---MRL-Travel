begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000002400','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch024-admin@example.invalid','',now(),'{}','{"full_name":"Patch 024 Admin"}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000002400','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,cashback_enabled,cashback_default_percentage,created_by) values
('00000000-0000-0000-0000-000000002401','Fluxo novo Patch 024','fluxo','patch024-flow@example.invalid','active',true,2,'00000000-0000-0000-0000-000000002400'),
('00000000-0000-0000-0000-000000002402','Rafael Weck','rafael','patch024-rafael@example.invalid','active',true,2,'00000000-0000-0000-0000-000000002400'),
('00000000-0000-0000-0000-000000002403','Cashback usado Patch 024','usado','patch024-used@example.invalid','active',true,10,'00000000-0000-0000-0000-000000002400');

select is(public.cashback_amount_for(1706.90,2),34.14::numeric,'R$ 1.706,90 a 2% arredonda para R$ 34,14');
select isnt(public.cashback_amount_for(1706.90,2),34.13::numeric,'R$ 34,13 por truncamento é proibido');
select is(public.cashback_amount_for(500,10),50.00::numeric,'R$ 500,00 a 10% gera R$ 50,00');
select is(public.cashback_amount_for(1100.25,7.5),82.52::numeric,'R$ 1.100,25 a 7,5% gera R$ 82,52');
select is(public.cashback_amount_for(0,10),0.00::numeric,'valor pago zero gera cashback zero');
select is(public.cashback_amount_for(500,null),0.00::numeric,'percentual vazio gera cashback zero');
select throws_ok($$select public.cashback_amount_for(-0.01,2)$$,'22003','INVALID_PAID_AMOUNT','valor pago negativo é rejeitado');
select throws_ok($$select public.cashback_amount_for(100,101)$$,'22023','INVALID_CASHBACK_PERCENTAGE','percentual inválido é rejeitado');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002400',true);

create temporary table patch024_new_sale as
select public.record_travel_sale(
  p_client_id=>'00000000-0000-0000-0000-000000002401',p_launched_on=>current_date,
  p_payment_mode=>'cash',p_travel_type=>'flight',p_details=>'Caso novo Rafael',
  p_original_value=>1884.04,p_paid_value=>1706.90,
  p_operation_id=>'00000000-0000-0000-0000-000000002411',p_cashback_percentage=>2
) result;
select is((select (result->>'savingsAmount')::numeric from patch024_new_sale),177.14::numeric,'economia continua sendo R$ 177,14');
select is((select (result->>'cashbackAmount')::numeric from patch024_new_sale),34.14::numeric,'novo fluxo usa o valor pago, não a economia');
select is((select result->>'cashbackBaseType' from patch024_new_sale),'paid_amount','backend persiste o tipo da base');
select is((select (result->>'cashbackBaseAmount')::numeric from patch024_new_sale),1706.90::numeric,'backend persiste a base canônica');
select is((select result->>'cashbackCalculationVersion' from patch024_new_sale),'paid_amount_v1','backend persiste a versão da fórmula');
select is((select metadata->>'baseType' from public.cashback_transactions where idempotency_key='00000000-0000-0000-0000-000000002411'),'paid_amount','earning registra a base no ledger');
select is((public.record_travel_sale(
  p_client_id=>'00000000-0000-0000-0000-000000002401',p_launched_on=>current_date,
  p_payment_mode=>'cash',p_travel_type=>'flight',p_details=>'Caso novo Rafael',
  p_original_value=>1884.04,p_paid_value=>1706.90,
  p_operation_id=>'00000000-0000-0000-0000-000000002411',p_cashback_percentage=>2
)->>'idempotentReplay')::boolean,true,'confirmação repetida é idempotente');

reset role;

insert into public.redemptions(
  id,client_id,redemption_type,description,issued_at,cash_reference_total,taxes_paid,additional_cash_paid,
  attributed_points_cost,formula_version,reference_captured_at,status,created_by,payment_mode,launched_on,
  operation_id,cashback_percentage,cashback_amount,cashback_calculation_version,cashback_calculated_at
) values(
  '00000000-0000-0000-0000-000000002420','00000000-0000-0000-0000-000000002402','flight',
  'Rafael Weck - fórmula anterior',now(),1884.04,0,1706.90,0,'2.1.0',now(),'confirmed',
  '00000000-0000-0000-0000-000000002400','cash',current_date,'00000000-0000-0000-0000-000000002421',
  2,3.54,'cashback-1.0.0',now()
);
insert into public.cashback_transactions(
  id,client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,metadata
) values(
  '00000000-0000-0000-0000-000000002422','00000000-0000-0000-0000-000000002402',
  '00000000-0000-0000-0000-000000002420','earning',3.54,'confirmed','Cashback da economia: Rafael',
  'cashback:earning:patch024-rafael:1','00000000-0000-0000-0000-000000002421',
  '00000000-0000-0000-0000-000000002400','{"percentage":2,"savingsAmount":177.14,"calculationVersion":"cashback-1.0.0"}'
);

insert into public.redemptions(
  id,client_id,redemption_type,description,issued_at,cash_reference_total,taxes_paid,additional_cash_paid,
  attributed_points_cost,formula_version,reference_captured_at,status,created_by,payment_mode,launched_on,
  operation_id,cashback_percentage,cashback_amount,cashback_calculation_version,cashback_calculated_at
) values(
  '00000000-0000-0000-0000-000000002430','00000000-0000-0000-0000-000000002403','hotel',
  'Crédito anterior parcialmente utilizado',now(),800,0,700,0,'2.1.0',now(),'confirmed',
  '00000000-0000-0000-0000-000000002400','cash',current_date,'00000000-0000-0000-0000-000000002431',
  10,10,'cashback-1.0.0',now()
);
insert into public.cashback_transactions(
  id,client_id,redemption_id,transaction_type,amount,status,description,source_external_key,idempotency_key,created_by,metadata
) values
('00000000-0000-0000-0000-000000002432','00000000-0000-0000-0000-000000002403','00000000-0000-0000-0000-000000002430','earning',10,'confirmed','Cashback antigo utilizado','cashback:earning:patch024-used:1','00000000-0000-0000-0000-000000002431','00000000-0000-0000-0000-000000002400','{"percentage":10,"savingsAmount":100,"calculationVersion":"cashback-1.0.0"}'),
('00000000-0000-0000-0000-000000002433','00000000-0000-0000-0000-000000002403',null,'redemption',5,'confirmed','Uso parcial','cashback:redemption:patch024-used','00000000-0000-0000-0000-000000002433','00000000-0000-0000-0000-000000002400','{}');
insert into public.cashback_transaction_allocations(redemption_transaction_id,earning_transaction_id,amount)
values('00000000-0000-0000-0000-000000002433','00000000-0000-0000-0000-000000002432',5);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002400',true);

select is((public.admin_preview_cashback_paid_amount_reconciliation()->>'candidateCount')::integer,2,'prévia encontra somente os dois créditos da fórmula anterior');
select is((public.admin_preview_cashback_paid_amount_reconciliation()->'totals'->>'previousCashback')::numeric,13.54::numeric,'prévia soma os créditos anteriores');
select is((public.admin_preview_cashback_paid_amount_reconciliation()->'totals'->>'correctCashback')::numeric,104.14::numeric,'prévia soma os créditos corretos');
select is((public.admin_apply_cashback_paid_amount_reconciliation('cashback_formula_reconciliation_paid_amount_v1')->>'applied')::integer,2,'lote aplica as duas correções independentes');
select is((select cashback_amount from public.redemptions where id='00000000-0000-0000-0000-000000002420'),34.14::numeric,'Rafael passa a ter cashback oficial de R$ 34,14');
select is((select count(*) from public.cashback_transactions where redemption_id='00000000-0000-0000-0000-000000002420' and transaction_type='reversal'),1::bigint,'crédito incorreto de Rafael recebe estorno');
select is((select count(*) from public.cashback_transactions where redemption_id='00000000-0000-0000-0000-000000002420' and transaction_type='earning'),2::bigint,'novo crédito de Rafael preserva o crédito anterior');
select is((select amount from public.cashback_transactions where source_external_key='cashback_formula_reconciliation_paid_amount_v1:00000000-0000-0000-0000-000000002430:adjustment'),60.00::numeric,'cashback utilizado recebe ajuste líquido auditável');
select is((select cashback_calculation_version from public.redemptions where id='00000000-0000-0000-0000-000000002420'),'paid_amount_v1','registro reconciliado usa a nova versão');
select is((public.admin_apply_cashback_paid_amount_reconciliation('cashback_formula_reconciliation_paid_amount_v1')->>'newMovements')::integer,0,'reexecução cria zero movimentações');
select is((public.admin_preview_cashback_paid_amount_reconciliation()->>'candidateCount')::integer,0,'reexecução deixa zero candidatos');

reset role;
select is((select count(*) from public.redemptions where source_system='iddas' and cashback_percentage is null and cashback_amount<>0),0::bigint,'economias legadas sem percentual continuam sem cashback');

select * from finish();
rollback;
