begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select is(public.build_savings_match_key(
  '00000000-0000-0000-0000-000000004001','migrated',null,
  'Emissão de Passagem Aérea (CNF - GRU) - Fábio R$260,13 (TAXA DE EMBARQUE)',
  '2026-01-08',2206.97,260.13,1946.84
),'00000000-0000-0000-0000-000000004001|migrated|sem-id|emissao-de-passagem-aerea-cnf-gru-fabio-r26013-taxa-de-embarque|2026-01-08|2206.97|260.13|1946.84','match_key composto é determinístico');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000004000','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch-hidden-admin@example.invalid','',now(),'{}','{"full_name":"Patch Hidden Admin"}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000004000','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,cashback_enabled,cashback_default_percentage,created_by)
values('00000000-0000-0000-0000-000000004001','Fábio Teste','fabio','patch-hidden-client@example.invalid','active',true,10,'00000000-0000-0000-0000-000000004000');

insert into public.redemptions(
  id,client_id,redemption_type,description,issued_at,cash_reference_total,taxes_paid,additional_cash_paid,
  attributed_points_cost,formula_version,reference_captured_at,status,created_by,payment_mode,launched_on,
  operation_id,source_system,source_batch_key,source_external_key,cashback_percentage,cashback_amount,
  cashback_calculation_version,cashback_calculated_at,cashback_base_type,cashback_base_amount
) values (
  '00000000-0000-0000-0000-000000004010','00000000-0000-0000-0000-000000004001','flight',
  'Emissão de Passagem Aérea (CNF - GRU) - Fábio R$260,13 (TAXA DE EMBARQUE)',
  '2026-01-08 12:00:00-03',2206.97,0,260.13,0,'legacy-iddas-direct-cost-v1',now(),'confirmed',
  '00000000-0000-0000-0000-000000004000','cash','2026-01-08','00000000-0000-0000-0000-000000004011',
  'iddas','iddas_economias_legacy','iddas:test:fabio:cnf-gru',10,26.01,'paid_amount_v1',now(),'paid_amount',260.13
);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000004000',true);

select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000004001',null,null,100,0,null,null,'active')->>'total')::integer,1,'migrada aparece em Ativas antes de ocultar');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000004001',null,null,100,0,null,null,'active')->>'totalSavings')::numeric,1946.84::numeric,'migrada soma antes de ocultar');
select is((public.admin_hide_travel_saving('00000000-0000-0000-0000-000000004010','Lançamento migrado incluído por engano',null)->>'status'),'hidden','RPC retorna hidden');

reset role;
select is((select count(*)::integer from public.client_savings_hidden_items where client_id='00000000-0000-0000-0000-000000004001'),1,'ocultação fica auditável');
select ok((select hidden_by='00000000-0000-0000-0000-000000004000'::uuid from public.client_savings_hidden_items where client_id='00000000-0000-0000-0000-000000004001'),'hidden_by registra o admin');
select is((select source from public.client_savings_hidden_items where client_id='00000000-0000-0000-0000-000000004001'),'iddas','origem migrada preservada');
select is((select status::text from public.redemptions where id='00000000-0000-0000-0000-000000004010'),'voided','origem sai dos agregados confirmados sem ser apagada');
select is((select count(*)::integer from public.redemptions where id='00000000-0000-0000-0000-000000004010'),1,'registro original permanece no banco');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000004000',true);
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000004001',null,null,100,0,null,null,'active')->>'total')::integer,0,'oculta some de Ativas');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000004001',null,null,100,0,null,null,'all')->>'total')::integer,0,'oculta some de Todas');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000004001',null,null,100,0,null,null,'voided')->>'total')::integer,0,'oculta não aparece em Anuladas');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000004001',null,null,100,0,null,null,'all')->>'totalSavings')::numeric,0::numeric,'total economizado ignora oculta');

reset role;
select is(jsonb_array_length(public.build_public_client_savings_history('00000000-0000-0000-0000-000000004001')),0,'painel público não recebe oculta');
select is((public.cashback_snapshot('00000000-0000-0000-0000-000000004001')->>'generated')::numeric,0::numeric,'cashback gerado ignora oculta');
select is((public.build_public_client_dashboard_payload('00000000-0000-0000-0000-000000004001')->'summary'->>'generatedSavings')::numeric,0::numeric,'total público ignora oculta');

select * from finish();
rollback;
