begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000920','00000000-0000-0000-0000-000000000000','authenticated','authenticated','iddas-admin@example.invalid','',now(),'{}','{"full_name":"Iddas Admin"}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000000920','super_admin',true);

insert into public.clients(full_name,first_name_normalized,email,status,created_by) values
('Amanda Araújo / Jhonnata','amanda','iddas-14829@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('Uli Zarzana de Menezes','uli','iddas-22287@example.invalid','paused','00000000-0000-0000-0000-000000000920'),
('Renata Martins Migotto','renata','iddas-22872@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('Fábio Izaías','fabio','iddas-8250@example.invalid','lead','00000000-0000-0000-0000-000000000920'),
('Alessandra Martins','alessandra','iddas-22694@example.invalid','ended','00000000-0000-0000-0000-000000000920'),
('Beatriz Cordeiro','beatriz','iddas-15744@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('Sara Menezes Araujo Valadares','sara','iddas-10868@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('José Roberto da Silva','jose','iddas-18179@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('Francelle Almeida Arêdes','francelle','iddas-13771@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('Diego Souza Barbosa','diego','iddas-12334@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('Jéssica Veloso','jessica','iddas-12122@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('Mariana Cristina da Silva Brunelli','mariana','iddas-35301@example.invalid','active','00000000-0000-0000-0000-000000000920'),
('Leonardo Lima','leonardo','iddas-9485@example.invalid','active','00000000-0000-0000-0000-000000000920');

create temporary table expected_iddas_status as
select id,status from public.clients where email::text like 'iddas-%@example.invalid';
grant select on expected_iddas_status to authenticated;

-- Cria uma divergência em Amanda para provar que o cliente inteiro é revertido,
-- enquanto os demais clientes continuam no primeiro processamento.
insert into public.program_accounts(client_id,program_id,created_by)
select c.id,lp.id,'00000000-0000-0000-0000-000000000920'
from public.clients c cross join public.loyalty_programs lp
where c.full_name='Amanda Araújo / Jhonnata' and lp.slug='smiles';
insert into public.balance_snapshots(account_id,captured_at,balance,source,created_by)
select pa.id,timestamptz '2026-07-20 12:00:00+00',123,'test_conflict','00000000-0000-0000-0000-000000000920'
from public.program_accounts pa join public.clients c on c.id=pa.client_id join public.loyalty_programs lp on lp.id=pa.program_id
where c.full_name='Amanda Araújo / Jhonnata' and lp.slug='smiles';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000920',true);

select is((public.admin_preview_iddas_balance_backfill()->'summary'->>'expectedClients')::integer,13,'manifesto contém 13 clientes');
select is((public.admin_preview_iddas_balance_backfill()->'summary'->>'accounts')::integer,44,'prévia contém 44 contas');
select is((public.admin_preview_iddas_balance_backfill()->'summary'->>'points')::bigint,3080020::bigint,'prévia confere 3.080.020 pontos');
select is((public.admin_preview_iddas_balance_backfill()->'summary'->>'bookValue')::numeric,60189.72::numeric,'prévia confere o patrimônio oficial');
select is((public.admin_preview_iddas_balance_backfill()->'summary'->>'conflicts')::integer,1,'saldo divergente é classificado como conflito');

select is((public.admin_commit_iddas_balance_backfill((select id from public.import_batches where source_key='iddas_html_saldos_20260721_v1'),'iddas_html_saldos_20260721_v1')->>'failedClients')::integer,1,'falha fica isolada em um cliente');
select is((select count(*) from public.point_transactions pt join public.program_accounts pa on pa.id=pt.account_id join public.clients c on c.id=pa.client_id where pt.source='iddas_balance_backfill' and c.full_name='Amanda Araújo / Jhonnata'),0::bigint,'nenhuma conta de Amanda fica parcialmente importada');
select is((select count(*) from public.point_transactions where source='iddas_balance_backfill'),41::bigint,'outros doze clientes continuam atomicamente');

reset role;
update public.import_balance_reconciliations br set account_id=null
from public.program_accounts pa,public.clients c,public.loyalty_programs lp
where br.account_id=pa.id and pa.client_id=c.id and pa.program_id=lp.id and c.full_name='Amanda Araújo / Jhonnata' and lp.slug='smiles';
delete from public.program_accounts pa using public.clients c,public.loyalty_programs lp
where pa.client_id=c.id and pa.program_id=lp.id and c.full_name='Amanda Araújo / Jhonnata' and lp.slug='smiles' and not exists(select 1 from public.point_transactions pt where pt.account_id=pa.id);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000920',true);
select is((public.admin_commit_iddas_balance_backfill((select id from public.import_batches where source_key='iddas_html_saldos_20260721_v1'),'iddas_html_saldos_20260721_v1')->>'newTransactions')::integer,3,'nova tentativa completa somente as três contas antes bloqueadas');
select is((select count(*) from public.point_transactions where source='iddas_balance_backfill'),44::bigint,'ledger contém exatamente 44 lançamentos do lote');
select is((select count(distinct operation_id) from public.point_transactions where source='iddas_balance_backfill'),44::bigint,'todas as operações do lote são únicas');
select is((select count(*) from public.program_accounts pa join public.clients c on c.id=pa.client_id where c.email::text like 'iddas-%@example.invalid'),44::bigint,'existem exatamente 44 vínculos de programa');
select is((select sum(latest.balance) from public.program_accounts pa join public.clients c on c.id=pa.client_id cross join lateral(select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1) latest where c.email::text like 'iddas-%@example.invalid'),3080020::numeric,'snapshots oficiais somam 3.080.020 pontos');
select is((select sum(latest.estimated_value) from public.program_accounts pa join public.clients c on c.id=pa.client_id cross join lateral(select bs.estimated_value from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1) latest where c.email::text like 'iddas-%@example.invalid'),60189.72::numeric,'snapshots preservam R$ 60.189,72');
select is((select count(*) from public.clients c join expected_iddas_status e on e.id=c.id where c.status=e.status),13::bigint,'status dos 13 clientes é preservado');
select is((select count(*) from public.clients where email::text like 'iddas-%@example.invalid'),13::bigint,'nenhum cliente é duplicado');
select is((public.admin_commit_iddas_balance_backfill((select id from public.import_batches where source_key='iddas_html_saldos_20260721_v1'),'iddas_html_saldos_20260721_v1')->>'newTransactions')::integer,0,'reexecução cria zero lançamentos');
select is((select count(*) from public.point_transactions where source='iddas_balance_backfill'),44::bigint,'reexecução mantém 44 lançamentos');

select is((public.get_admin_client_points_detail((select id from public.clients where full_name='Amanda Araújo / Jhonnata'))->'client'->>'totalPoints')::bigint,396479::bigint,'cadastro administrativo exibe o total de Amanda');
select is((public.get_admin_client_points_detail((select id from public.clients where full_name='Amanda Araújo / Jhonnata'))->'client'->>'estimatedValue')::numeric,11936.40::numeric,'cadastro administrativo exibe o patrimônio de Amanda');

reset role;
select is((public.build_public_client_dashboard_payload((select id from public.clients where full_name='Amanda Araújo / Jhonnata'))->'summary'->>'totalPoints')::bigint,396479::bigint,'painel público coincide com o admin');
select is(jsonb_array_length(public.build_public_client_dashboard_payload((select id from public.clients where full_name='Amanda Araújo / Jhonnata'))->'programs'),3,'painel público recebe os três programas de Amanda');

select * from finish();
rollback;
