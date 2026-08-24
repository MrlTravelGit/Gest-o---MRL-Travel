begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('29000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch29-admin@example.invalid','',now(),'{}','{}',now(),now());
insert into public.profiles(id,full_name,first_name_normalized,email) values ('29000000-0000-0000-0000-000000000001','Admin Patch 29','admin','patch29-admin@example.invalid') on conflict(id) do update set full_name=excluded.full_name;
insert into public.staff_members(user_id,role,active) values ('29000000-0000-0000-0000-000000000001','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status) values
('29000000-0000-0000-0000-000000000101','Cliente Interesse A','cliente','interesse-a@example.invalid','active'),
('29000000-0000-0000-0000-000000000102','Cliente Interesse B','cliente','interesse-b@example.invalid','active');

set local role authenticated;
select set_config('request.jwt.claim.sub','29000000-0000-0000-0000-000000000001',true);

select lives_ok($$select public.upsert_travel_interest_v2('29000000-0000-0000-0000-000000000101','Porto de Galinhas',current_date+30,current_date+35,'Viagem em familia','waiting','high',true,'Avaliando opcoes','SEGREDO INTERNO',current_date+2,'29000000-0000-0000-0000-000000000001',null,null)$$,'cria interesse em espera');
select is((select status::text from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101'),'waiting','status inicial canonico');
select is((select priority from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101'),'high','prioridade persistida');
select ok((select public_visible from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101'),'visibilidade publica persistida');

select lives_ok(format($sql$select public.upsert_travel_interest_v2('29000000-0000-0000-0000-000000000101','Porto de Galinhas',current_date+30,current_date+35,'Viagem em familia','in_progress','high',true,'Avaliando opcoes','SEGREDO INTERNO',current_date+2,'29000000-0000-0000-0000-000000000001','Cotacao iniciada','%s')$sql$,(select id from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101')),'altera para em andamento');
select is((select count(*) from public.travel_interest_status_history),1::bigint,'mudanca cria historico');
select is((select note from public.travel_interest_status_history order by changed_at desc limit 1),'Cotacao iniciada','historico preserva nota');

select lives_ok(format($sql$select public.upsert_travel_interest_v2('29000000-0000-0000-0000-000000000101','Porto de Galinhas',current_date+30,current_date+35,'Viagem em familia','completed','high',true,'Concluido','SEGREDO INTERNO',null,'29000000-0000-0000-0000-000000000001','Reserva concluida','%s')$sql$,(select id from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101')),'conclui interesse');
select ok((select completed_at is not null from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101'),'conclusao preenche completed_at');

select lives_ok(format($sql$select public.upsert_travel_interest_v2('29000000-0000-0000-0000-000000000101','Porto de Galinhas',current_date+30,current_date+35,'Viagem em familia','in_progress','high',true,'Reaberto','SEGREDO INTERNO',current_date+3,null,'Reabertura','%s')$sql$,(select id from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101')),'reabre interesse');
select ok((select completed_at is null from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101'),'reabertura limpa completed_at');
select is((public.get_client_travel_interests_admin('29000000-0000-0000-0000-000000000101')->'counts'->>'inProgress')::integer,1,'contador por cliente correto');
select throws_ok(format($sql$select public.upsert_travel_interest_v2('29000000-0000-0000-0000-000000000102','Destino trocado',null,null,'Tentativa indevida','waiting','normal',true,null,null,null,null,null,'%s')$sql$,(select id from public.travel_interests where client_id='29000000-0000-0000-0000-000000000101')),'P0002','Interesse nao pertence ao cliente informado','bloqueia troca de cliente');

reset role;
set local role service_role;
select ok((public.build_public_client_travel_interests('29000000-0000-0000-0000-000000000101')::text not like '%SEGREDO INTERNO%'),'nota interna nunca entra no payload publico');
select is(jsonb_array_length(public.build_public_client_travel_interests('29000000-0000-0000-0000-000000000102')),0,'cliente B nao recebe interesse do cliente A');
update public.travel_interests set public_visible=false where client_id='29000000-0000-0000-0000-000000000101';
select is(jsonb_array_length(public.build_public_client_travel_interests('29000000-0000-0000-0000-000000000101')),0,'public_visible false oculta item');
update public.travel_interests set public_visible=true,status='cancelled' where client_id='29000000-0000-0000-0000-000000000101';
select is(jsonb_array_length(public.build_public_client_travel_interests('29000000-0000-0000-0000-000000000101')),0,'cancelado fica oculto por padrao');
select ok(exists(select 1 from public.audit_logs where client_id='29000000-0000-0000-0000-000000000101' and table_name='travel_interests'),'writes ficam auditados');

select * from finish();
rollback;
