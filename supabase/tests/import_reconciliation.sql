begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000000','authenticated','authenticated','import-admin@example.invalid','',now(),'{}','{"full_name":"Import Admin"}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000000901','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,created_by) values('00000000-0000-0000-0000-000000000902','Cliente Importação','cliente','import-client@example.invalid','active','00000000-0000-0000-0000-000000000901');

insert into public.import_batches(id,status,original_filename,upload_size_bytes,mime_type,storage_path,checksum_sha256,created_by)
values('00000000-0000-0000-0000-000000000910','review','programas.csv',100,'text/csv','test/import-910.csv',repeat('a',64),'00000000-0000-0000-0000-000000000901');
insert into public.import_files(id,batch_id,logical_type,path,checksum_sha256,row_count,is_canonical)
values('00000000-0000-0000-0000-000000000911','00000000-0000-0000-0000-000000000910','program','Programas_all.csv',repeat('b',64),1,true);
insert into public.import_staging_rows(id,batch_id,file_id,row_number,entity_type,source_external_id,raw_payload,normalized_payload,validation_status,resolution_status,blocks_commit,suggested_action,chosen_action,row_hash)
values('00000000-0000-0000-0000-000000000912','00000000-0000-0000-0000-000000000910','00000000-0000-0000-0000-000000000911',2,'program','1234567890abcdef1234567890abcdef','{}','{"programName":"Smiles"}','valid','ready_create',false,'create_imported_initial_balance','create_imported_initial_balance',repeat('c',64));
insert into public.import_balance_reconciliations(batch_id,staging_row_id,client_id,program_id,current_points,imported_points,difference_points,cost_per_thousand,expiring_points,expires_on,reference_date,suggested_action,chosen_action,status)
values('00000000-0000-0000-0000-000000000910','00000000-0000-0000-0000-000000000912','00000000-0000-0000-0000-000000000902',(select id from public.loyalty_programs where slug='smiles'),0,20000,20000,10.77,5000,current_date+90,current_date,'create_imported_initial_balance','create_imported_initial_balance','ready');

select ok('initial_balance_import'=any(enum_range(null::public.point_entry_category)::text[]),'categoria contábil de importação existe');
select ok(not has_table_privilege('anon','public.import_balance_reconciliations','SELECT'),'staging de saldos não é exposto ao anônimo');
select ok(has_table_privilege('authenticated','public.import_balance_reconciliations','SELECT'),'staff autenticado recebe grant de leitura sujeito a RLS');
select is(public.import_idempotency_uuid('1234567890abcdef1234567890abcdef','fallback','initial_balance:2026-07-20:20000'),public.import_idempotency_uuid('1234567890abcdef1234567890abcdef','outro','initial_balance:2026-07-20:20000'),'Page ID produz chave idempotente estável');
select isnt(public.import_idempotency_uuid('1234567890abcdef1234567890abcdef','fallback','initial_balance:2026-07-20:20000'),public.import_idempotency_uuid('abcdef1234567890abcdef1234567890','fallback','initial_balance:2026-07-20:20000'),'fontes diferentes não colidem');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000901',true);
select is(jsonb_array_length(public.get_admin_import_batch('00000000-0000-0000-0000-000000000910')->'balances'),1,'prévia retorna uma reconciliação');
select is((public.admin_commit_import_batch('00000000-0000-0000-0000-000000000910')->>'importedPoints')::bigint,20000::bigint,'commit lança vinte mil pontos');
select is((select count(*) from public.point_transactions where source='notion_import' and points_delta=20000),1::bigint,'ledger recebe uma única movimentação');
select is((select entry_category::text from public.point_transactions where source='notion_import'),'initial_balance_import','movimento usa categoria canônica');
select is((select cash_total from public.point_transactions where source='notion_import'),215.40::numeric,'patrimônio é calculado no backend');
select is((select balance from public.balance_snapshots bs join public.program_accounts pa on pa.id=bs.account_id where pa.client_id='00000000-0000-0000-0000-000000000902' order by captured_at desc limit 1),20000::bigint,'snapshot oficial reflete o saldo importado');
select is((select count(*) from public.expiration_lots el join public.point_transactions pt on pt.id=el.source_transaction_id where pt.source='notion_import'),1::bigint,'vencimento fica vinculado à operação');
select is((public.admin_commit_import_batch('00000000-0000-0000-0000-000000000910')->>'idempotentReplay')::boolean,true,'repetir o commit retorna replay idempotente');
select is((select count(*) from public.point_transactions where source='notion_import' and points_delta=20000),1::bigint,'replay não duplica pontos');

reset role;
select is((public.build_public_client_dashboard_payload('00000000-0000-0000-0000-000000000902')->'summary'->>'totalPoints')::bigint,20000::bigint,'dashboard público usa o snapshot importado');
select ok(jsonb_array_length(public.build_public_client_dashboard_payload('00000000-0000-0000-0000-000000000902')->'monthlyMovements')>=1,'movimentação importada alimenta o gráfico mensal');

select * from finish();
rollback;
