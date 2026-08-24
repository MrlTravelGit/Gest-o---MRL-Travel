begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000003100','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch031-admin@example.invalid','',now(),'{}','{}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000003100','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,created_by) values
('00000000-0000-0000-0000-000000003101','Cliente Fatura Um','cliente','patch031-one@example.invalid','active','00000000-0000-0000-0000-000000003100'),
('00000000-0000-0000-0000-000000003102','Cliente Fatura Dois','cliente','patch031-two@example.invalid','active','00000000-0000-0000-0000-000000003100');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000003100',true);

create temporary table patch031_data as select
  (select id from public.financial_institutions fi join public.card_catalog_versions cv on fi.normalized_name=lower(regexp_replace(trim(cv.issuer),'[^a-zA-Z0-9]+','','g')) where cv.card_slug='c6-basico' and cv.version=1 limit 1) institution_id,
  (select id from public.financial_institutions order by name limit 1) any_institution_id;

create temporary table patch031_card as select (public.associate_catalog_card(
  '00000000-0000-0000-0000-000000003101',(select id from public.card_catalog_versions where card_slug='c6-basico' and version=1),date '2026-08-01',null,'holder','points',null,null,null,false,false,null,null,null,null,'Cartao do teste Patch 031',null
)->>'cardId')::uuid card_id;
create temporary table patch031_other_card as select (public.associate_catalog_card(
  '00000000-0000-0000-0000-000000003102',(select id from public.card_catalog_versions where card_slug='c6-basico' and version=1),date '2026-08-01',null,'holder','points',null,null,null,false,false,null,null,null,null,'Cartao de outro cliente Patch 031',null
)->>'cardId')::uuid card_id;

select public.save_card_statement_v3(p_client_id=>'00000000-0000-0000-0000-000000003101',p_financial_institution_id=>(select institution_id from patch031_data),p_account_person_type=>'PF',p_statement_month=>date '2026-08-01',p_total_amount=>1000,p_operation_id=>'00000000-0000-0000-0000-000000003110');
select is((select prediction_status from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),'pending_card','fatura sem cartao fica pendente');
select is((select predicted_points from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),null::numeric,'fatura sem cartao nao grava zero como previsao');
select is((select client_id from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),'00000000-0000-0000-0000-000000003101'::uuid,'fatura possui cliente direto');

select public.save_card_statement_v3(p_statement_id=>(select id from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),p_client_id=>'00000000-0000-0000-0000-000000003101',p_financial_institution_id=>(select institution_id from patch031_data),p_account_person_type=>'PF',p_card_id=>(select card_id from patch031_card),p_statement_month=>date '2026-08-01',p_total_amount=>1000,p_domestic_amount=>1000,p_points_received=>25);
select is((select predicted_points from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),50.0000::numeric,'cartao por real calcula no backend');
select is((select received_points from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),25.00::numeric,'pontos recebidos permanecem separados');
select ok((select calculation_rule_snapshot ? 'applications' from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),'snapshot preserva regras aplicadas');

select throws_ok($$select public.save_card_statement_v3(p_client_id=>'00000000-0000-0000-0000-000000003101',p_financial_institution_id=>(select institution_id from patch031_data),p_account_person_type=>'PF',p_card_id=>(select card_id from patch031_other_card),p_statement_month=>date '2026-09-01',p_total_amount=>100)$$,'22023','O cartao selecionado pertence a outro cliente.','impede cartao de outro cliente');
select throws_ok($$select public.save_card_statement_v3(p_client_id=>'00000000-0000-0000-0000-000000003101',p_financial_institution_id=>(select id from public.financial_institutions where id<>(select institution_id from patch031_data) limit 1),p_account_person_type=>'PF',p_card_id=>(select card_id from patch031_card),p_statement_month=>date '2026-09-01',p_total_amount=>100,p_domestic_amount=>100)$$,'22023','O cartao selecionado nao pertence ao banco informado.','impede banco incompativel');

select public.recalculate_card_statement_v3((select id from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'));
select is((select received_points from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),25.00::numeric,'recalculo preserva pontos recebidos');
select is(((public.get_card_statements_v3('00000000-0000-0000-0000-000000003102'))->>'total')::integer,0,'consulta isola clientes');

select public.save_card_statement_v3(p_statement_id=>(select id from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),p_client_id=>'00000000-0000-0000-0000-000000003101',p_financial_institution_id=>(select institution_id from patch031_data),p_account_person_type=>'PJ',p_card_id=>null,p_statement_month=>date '2026-08-01',p_total_amount=>1000,p_points_received=>25);
select is((select prediction_status from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),'pending_card','remover cartao limpa somente a previsao');
select is((select received_points from public.card_statements where operation_id='00000000-0000-0000-0000-000000003110'),25.00::numeric,'remover cartao preserva pontos recebidos');

update public.clients set status='ended' where id='00000000-0000-0000-0000-000000003101';
select is((select count(*) from public.card_statements where client_id='00000000-0000-0000-0000-000000003101'),1::bigint,'arquivar cliente nao apaga faturas');
select * from finish();
rollback;
