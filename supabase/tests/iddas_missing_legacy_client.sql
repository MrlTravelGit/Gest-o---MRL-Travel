begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000930','00000000-0000-0000-0000-000000000000','authenticated','authenticated','legacy-admin@example.invalid','',now(),'{}','{"full_name":"Legacy Admin"}',now(),now());
insert into public.staff_members(user_id,role,active)
values('00000000-0000-0000-0000-000000000930','super_admin',true);

insert into public.import_batches(id,status,source_system,adapter_version,original_filename,upload_size_bytes,mime_type,storage_path,checksum_sha256,created_by)
values('00000000-0000-0000-0000-000000000931','review','notion','notion_mrl_v2','clientes.zip',100,'application/zip','test/clientes.zip',repeat('d',64),'00000000-0000-0000-0000-000000000930');
insert into public.import_files(id,batch_id,logical_type,path,checksum_sha256,row_count,is_canonical)
values('00000000-0000-0000-0000-000000000932','00000000-0000-0000-0000-000000000931','client','Clientes.csv',repeat('e',64),1,true);
insert into public.import_staging_rows(id,batch_id,file_id,row_number,entity_type,source_external_id,raw_payload,normalized_payload,validation_status,resolution_status,blocks_commit,suggested_action,chosen_action,row_hash)
values('00000000-0000-0000-0000-000000000933','00000000-0000-0000-0000-000000000931','00000000-0000-0000-0000-000000000932',18,'client','1234567890abcdef1234567890abcdef','{}','{"fullName":"Leonardo Lima"}','invalid','ready_create',true,'create_new_lead','ready_create',repeat('f',64));

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000930',true);

select is((public.admin_materialize_iddas_missing_legacy_client(9485,'iddas_html_saldos_20260721_v1')->>'created')::boolean,true,'cliente legado ausente é criado uma vez');
select is((select count(*) from public.clients where full_name='Leonardo Lima'),1::bigint,'recuperação cria exatamente um cliente');
select is((select status::text from public.clients where full_name='Leonardo Lima'),'lead','cliente recuperado permanece lead');
select ok((select legacy_contact_pending and email is null and phone_e164 is null from public.clients where full_name='Leonardo Lima'),'contato ausente é representado sem dado inventado');
select is((public.admin_materialize_iddas_missing_legacy_client(9485,'iddas_html_saldos_20260721_v1')->>'created')::boolean,false,'reexecução reutiliza o cliente existente');
select is((select count(*) from public.external_source_map where source_system='notion' and source_page_id='1234567890abcdef1234567890abcdef' and entity_type='client'),1::bigint,'identificador exato da fonte fica mapeado uma única vez');

select * from finish();
rollback;
