begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('06200000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch062@example.invalid','',now(),'{}'::jsonb,'{"full_name":"Admin Patch 062"}'::jsonb,now(),now());
insert into public.staff_members(user_id,role,active) values('06200000-0000-4000-8000-000000000001','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,created_by)
values('06200000-0000-4000-8000-000000000002','Cliente Patch 062','cliente','client-patch062@example.invalid','active','06200000-0000-4000-8000-000000000001');
insert into public.program_accounts(id,client_id,program_id,active,created_by)
select '06200000-0000-4000-8000-000000000003','06200000-0000-4000-8000-000000000002',id,true,'06200000-0000-4000-8000-000000000001'
from public.loyalty_programs where slug='azul_fidelidade';
insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,created_by)
values('06200000-0000-4000-8000-000000000003',clock_timestamp(),64180,20,20,'patch062-test','06200000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.aal','aal2',true);
select set_config('request.jwt.claim.sub','06200000-0000-4000-8000-000000000001',true);

select throws_ok(
  $$select public.record_travel_sale('06200000-0000-4000-8000-000000000002',current_date,'miles','flight','Tentativa acima do saldo',5000,1000,'06200000-0000-4000-8000-000000000003',72000,'06200000-0000-4000-8000-000000000004',null)$$,
  '23514','INSUFFICIENT_POINTS','backend recusa pontos acima do saldo'
);
select is((select count(*) from public.redemptions where operation_id='06200000-0000-4000-8000-000000000004'),0::bigint,'tentativa recusada não cria viagem');
select is((select balance from public.balance_snapshots where account_id='06200000-0000-4000-8000-000000000003' order by captured_at desc,id desc limit 1),64180::bigint,'tentativa recusada preserva saldo');
select is((public.record_travel_sale('06200000-0000-4000-8000-000000000002',current_date,'miles','flight','Viagem dentro do saldo',5000,1000,'06200000-0000-4000-8000-000000000003',60000,'06200000-0000-4000-8000-000000000005',null)->>'newBalance')::bigint,4180::bigint,'viagem dentro do saldo é registrada');
select is((select balance from public.balance_snapshots where account_id='06200000-0000-4000-8000-000000000003' order by captured_at desc,id desc limit 1),4180::bigint,'saldo final nunca fica negativo');

select * from finish();
rollback;
