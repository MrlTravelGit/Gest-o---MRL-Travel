begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_table('public','expiration_alert_settings','configuracao de alertas existe');
select has_table('public','expiration_alerts','historico de alertas existe');
select has_function('public','get_expiration_alert_candidates_v1',array[]::text[],'busca canonica de candidatos existe');
select has_function('public','claim_expiration_alert_v1',array['text','uuid','text','bigint','date','smallint','text'],'claim transacional existe');

insert into public.clients(id,full_name,first_name_normalized,email,status) values
('10000000-0000-4000-8000-000000000001','Cliente Ativo','cliente','alerta-ativo@example.invalid','active'),
('10000000-0000-4000-8000-000000000002','Cliente Arquivado','cliente','alerta-arquivado@example.invalid','ended'),
('10000000-0000-4000-8000-000000000003','Cliente Distante','cliente','alerta-distante@example.invalid','active');

insert into public.program_accounts(id,client_id,program_id,active) values
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',(select id from public.loyalty_programs where slug='azul'),true),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',(select id from public.loyalty_programs where slug='azul'),true),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',(select id from public.loyalty_programs where slug='azul'),true);

insert into public.expiration_lots(account_id,expires_on,points_amount,points_used,status) values
('20000000-0000-4000-8000-000000000001',current_date+88,120000,0,'active'),
('20000000-0000-4000-8000-000000000001',current_date+30,50000,50000,'used'),
('20000000-0000-4000-8000-000000000001',current_date+15,25000,0,'cancelled'),
('20000000-0000-4000-8000-000000000002',current_date+30,80000,0,'active'),
('20000000-0000-4000-8000-000000000003',current_date+120,90000,0,'active');

insert into public.management_contracts(client_id,starts_on,ends_on,status) values
('10000000-0000-4000-8000-000000000001',current_date-200,current_date+60,'active'),
('10000000-0000-4000-8000-000000000002',current_date-200,current_date+30,'active'),
('10000000-0000-4000-8000-000000000003',current_date-200,current_date+20,'cancelled');

update public.expiration_alert_settings set threshold_days=array[90]::smallint[],points_enabled=true,management_enabled=true where id=true;

select is((select count(*) from public.get_expiration_alert_candidates_v1() where alert_type='points_expiration'),1::bigint,'somente lote ativo, positivo, proximo e de cliente ativo');
select is((select points_amount from public.get_expiration_alert_candidates_v1() where alert_type='points_expiration'),120000::bigint,'quantidade disponivel e preservada');
select is((select count(*) from public.get_expiration_alert_candidates_v1() where alert_type='management_expiration'),1::bigint,'somente gestao ativa de cliente ativo');
select is((select count(*) from public.get_expiration_alert_candidates_v1() where client_id='10000000-0000-4000-8000-000000000002'),0::bigint,'cliente arquivado ignorado');
select is((select count(*) from public.get_expiration_alert_candidates_v1() where client_id='10000000-0000-4000-8000-000000000003'),0::bigint,'lote distante e gestao cancelada ignorados');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select ok(public.claim_expiration_alert_v1('points_expiration','10000000-0000-4000-8000-000000000001','Azul Fidelidade',120000,current_date+88,90,'-1000') is not null,'primeiro claim reserva alerta');
select is(public.claim_expiration_alert_v1('points_expiration','10000000-0000-4000-8000-000000000001','Azul Fidelidade',120000,current_date+88,90,'-1000'),null::uuid,'reexecucao nao duplica alerta pendente');

reset role;
set local role anon;
select throws_ok($$select count(*) from public.expiration_alerts$$,'42501','permission denied for table expiration_alerts','anonimo nao le historico');

select * from finish();
rollback;
