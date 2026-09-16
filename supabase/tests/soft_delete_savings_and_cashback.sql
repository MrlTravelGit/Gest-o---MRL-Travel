begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000003900','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch-delete-admin@example.invalid','',now(),'{}','{"full_name":"Patch Delete Admin"}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000003900','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,cashback_enabled,cashback_default_percentage,created_by)
values('00000000-0000-0000-0000-000000003901','Cliente Exclusão','cliente','patch-delete-client@example.invalid','active',true,10,'00000000-0000-0000-0000-000000003900');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000003900',true);

create temporary table deleted_sale as
select public.record_travel_sale(
  p_client_id=>'00000000-0000-0000-0000-000000003901',p_launched_on=>current_date,
  p_payment_mode=>'cash',p_travel_type=>'flight',p_details=>'Emissão de Passagem Aérea CNF GRU',
  p_original_value=>1000,p_paid_value=>739.87,p_operation_id=>'00000000-0000-0000-0000-000000003911',p_cashback_percentage=>10
) result;

select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000003901',null,null,100,0,null,null,'active')->>'total')::integer,1,'economia aparece em Ativas antes da exclusão');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000003901',null,null,100,0,null,null,'active')->>'totalSavings')::numeric,260.13::numeric,'economia soma antes da exclusão');
select is((public.admin_delete_travel_saving((select (result->>'saleId')::uuid from deleted_sale),'Lançamento excluído pelo administrador',null)->>'status'),'deleted','exclusão retorna estado deleted');
select ok((select deleted_at is not null from public.redemptions where id=(select (result->>'saleId')::uuid from deleted_sale)),'soft delete grava deleted_at');
select is((select deleted_by from public.redemptions where id=(select (result->>'saleId')::uuid from deleted_sale)),'00000000-0000-0000-0000-000000003900'::uuid,'soft delete grava deleted_by');
select is((select status::text from public.redemptions where id=(select (result->>'saleId')::uuid from deleted_sale)),'voided','exclusão também retira o registro dos agregados confirmados');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000003901',null,null,100,0,null,null,'active')->>'total')::integer,0,'economia some de Ativas');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000003901',null,null,100,0,null,null,'all')->>'total')::integer,0,'economia some de Todas');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000003901',null,null,100,0,null,null,'voided')->>'total')::integer,0,'economia excluída não aparece em Anuladas');
select is((public.get_travel_sales_v2('00000000-0000-0000-0000-000000003901',null,null,100,0,null,null,'all')->>'totalSavings')::numeric,0::numeric,'total economizado deixa de contar a exclusão');

reset role;
select is(jsonb_array_length(public.build_public_client_savings_history('00000000-0000-0000-0000-000000003901')),0,'painel público não recebe a economia excluída');
select is((public.cashback_snapshot('00000000-0000-0000-0000-000000003901')->>'generated')::numeric,0::numeric,'cashback gerado e saldo ignoram a economia excluída');

select * from finish();
rollback;
