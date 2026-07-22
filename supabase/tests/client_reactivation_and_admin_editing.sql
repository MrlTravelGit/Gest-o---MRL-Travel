begin;

create extension if not exists pgtap with schema extensions;
select plan(56);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('21000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch21-admin@example.invalid','',now(),'{}','{"full_name":"Admin Patch 21"}',now(),now()),
('21000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch21-operator@example.invalid','',now(),'{}','{"full_name":"Operator Patch 21"}',now(),now());
insert into public.staff_members(user_id,role,active) values
('21000000-0000-0000-0000-000000000001','super_admin',true),
('21000000-0000-0000-0000-000000000002','operator',true);

insert into public.clients(id,full_name,first_name_normalized,email,status,archived_at,archive_reason,contract_review_status) values
('21000000-0000-0000-0000-000000000101','Cliente Contrato','cliente','contrato@example.invalid','ended',now()-interval '2 days','Pausa operacional','pending_review'),
('21000000-0000-0000-0000-000000000102','Cliente Sem Contrato','cliente','semcontrato@example.invalid','ended',null,null,'pending_review'),
('21000000-0000-0000-0000-000000000103','Leonardo Lima ainda aguarda revisão e ativação','leonardo','leonardo@example.invalid','ended',now()-interval '1 day',null,'pending_review'),
('21000000-0000-0000-0000-000000000104','Lead Pendente','lead','lead@example.invalid','lead',null,null,'pending_review'),
('21000000-0000-0000-0000-000000000105','Leandro Contato','leandro','legitimo@example.invalid','active',null,null,'complete');

insert into public.management_contracts(id,client_id,starts_on,ends_on,status,plan_name) values
('21000000-0000-0000-0000-000000000201','21000000-0000-0000-0000-000000000101',current_date-30,current_date+335,'ended','Plano preservado'),
('21000000-0000-0000-0000-000000000205','21000000-0000-0000-0000-000000000105',current_date-30,current_date+335,'active','Plano ativo');

insert into public.program_accounts(id,client_id,program_id,active) values
('21000000-0000-0000-0000-000000000301','21000000-0000-0000-0000-000000000101',(select id from public.loyalty_programs where slug='smiles'),true),
('21000000-0000-0000-0000-000000000302','21000000-0000-0000-0000-000000000102',(select id from public.loyalty_programs where slug='smiles'),true),
('21000000-0000-0000-0000-000000000303','21000000-0000-0000-0000-000000000103',(select id from public.loyalty_programs where slug='smiles'),true);
insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source) values
('21000000-0000-0000-0000-000000000301',now()-interval '3 minutes',10000,15,20,'test'),
('21000000-0000-0000-0000-000000000302',now()-interval '2 minutes',5000,15,20,'test'),
('21000000-0000-0000-0000-000000000303',now()-interval '1 minute',3000,15,20,'test');
insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,source) values
('21000000-0000-0000-0000-000000000301',now(),'credit',10000,'Saldo preservado','test'),
('21000000-0000-0000-0000-000000000302',now(),'credit',5000,'Saldo preservado','test'),
('21000000-0000-0000-0000-000000000303',now(),'credit',3000,'Saldo preservado','test');
insert into public.client_direct_access_links(id,client_id,token_hash,status,created_by) values
('21000000-0000-0000-0000-000000000401','21000000-0000-0000-0000-000000000101',repeat('a',64),'active','21000000-0000-0000-0000-000000000001');

select is(public.suggest_client_name_cleanup('Leonardo Lima ainda aguarda revisão e ativação')->>'suggestedName','Leonardo Lima','sugestão remove frase operacional no final');
select is(public.suggest_client_name_cleanup('Leandro Contato'),null::jsonb,'nome legítimo não recebe sugestão');

set local role authenticated;
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-000000000001',true);

select is(jsonb_array_length(public.get_client_reactivation_preview(null,'')->'items'),3,'prévia inclui somente os três arquivados');
select is((public.get_client_reactivation_preview(null,'')->'summary'->>'points')::bigint,18000::bigint,'prévia soma os pontos sem alterar o ledger');
select is((public.get_client_reactivation_preview(null,'')->'summary'->>'withContract')::integer,1,'prévia identifica o único contrato reutilizável');

select is(public.reactivate_client_admin('21000000-0000-0000-0000-000000000101','Retorno autorizado',1)->>'status','reactivated','reativação individual confirma sucesso');
select is((select status::text from public.clients where id='21000000-0000-0000-0000-000000000101'),'active','cliente arquivado fica ativo');
select is((select status::text from public.management_contracts where id='21000000-0000-0000-0000-000000000201'),'active','contrato válido existente é reativado sem duplicação');
select is((public.get_admin_client_management('21000000-0000-0000-0000-000000000101')->'financial'->>'points')::bigint,10000::bigint,'saldo permanece idêntico');
select is((select count(*) from public.program_accounts where client_id='21000000-0000-0000-0000-000000000101'),1::bigint,'conta de programa não duplica');
select is((select count(*) from public.point_transactions pt join public.program_accounts pa on pa.id=pt.account_id where pa.client_id='21000000-0000-0000-0000-000000000101'),1::bigint,'histórico não duplica');
select is((select status::text from public.client_direct_access_links where id='21000000-0000-0000-0000-000000000401'),'active','link público não é rotacionado nem revogado');
select ok(exists(select 1 from public.audit_logs where client_id='21000000-0000-0000-0000-000000000101' and action='reactivate_client'),'reativação registra auditoria');
select is(public.reactivate_client_admin('21000000-0000-0000-0000-000000000101','Replay',null)->>'status','already_active','reexecução é idempotente');
select is((select count(*) from public.audit_logs where client_id='21000000-0000-0000-0000-000000000101' and action='reactivate_client'),1::bigint,'replay não cria nova auditoria de mutação');

select is(public.reactivate_client_admin('21000000-0000-0000-0000-000000000102','Sem vigência confiável',1)->>'status','reactivated','cliente sem contrato também é reativado');
select is((select contract_review_status from public.clients where id='21000000-0000-0000-0000-000000000102'),'pending_review','cliente sem vigência fica pendente de revisão');
select is((select count(*) from public.management_contracts where client_id='21000000-0000-0000-0000-000000000102'),0::bigint,'reativação não inventa contrato nem datas');
select is((public.get_admin_client_management('21000000-0000-0000-0000-000000000102')->'financial'->>'points')::bigint,5000::bigint,'reativação sem contrato preserva pontos');

select is((public.bulk_reactivate_clients_admin(array['21000000-0000-0000-0000-000000000103','21000000-0000-0000-0000-000000000104','21000000-0000-0000-0000-000000000101']::uuid[],'Lote de teste')->>'requested')::integer,3,'lote registra três solicitações distintas');
reset role;
select is((select reactivated_count from public.client_reactivation_batches order by created_at desc limit 1),1,'lote reativa somente o arquivado');
select is((select already_active_count from public.client_reactivation_batches order by created_at desc limit 1),1,'lote relata cliente já ativo');
select is((select blocked_count from public.client_reactivation_batches order by created_at desc limit 1),1,'lote relata lead bloqueado sem abortar os demais');
select is((select status::text from public.clients where id='21000000-0000-0000-0000-000000000103'),'active','registro arquivado do lote fica ativo');
select is((select status::text from public.clients where id='21000000-0000-0000-0000-000000000104'),'lead','lead não é ativado pelo lote');
select is((select sum((public.get_admin_client_management(id)->'financial'->>'points')::bigint) from public.clients where id in ('21000000-0000-0000-0000-000000000101','21000000-0000-0000-0000-000000000102','21000000-0000-0000-0000-000000000103')),18000::numeric,'total agregado de pontos permanece idêntico');
select is((select count(*) from public.point_transactions pt join public.program_accounts pa on pa.id=pt.account_id where pa.client_id in ('21000000-0000-0000-0000-000000000101','21000000-0000-0000-0000-000000000102','21000000-0000-0000-0000-000000000103')),3::bigint,'lote não cria movimentações');
select is((select count(*) from public.program_accounts where client_id in ('21000000-0000-0000-0000-000000000101','21000000-0000-0000-0000-000000000102','21000000-0000-0000-0000-000000000103')),3::bigint,'lote não cria contas adicionais');

set local role authenticated;
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-000000000001',true);
select is(jsonb_array_length(public.preview_client_name_cleanup_admin()->'items'),1,'prévia lista somente o nome contaminado');
select ok(not exists(select 1 from jsonb_array_elements(public.preview_client_name_cleanup_admin()->'items') item where item->>'clientId'='21000000-0000-0000-0000-000000000105'),'nome legítimo é excluído da limpeza');
select is(public.apply_client_name_cleanup_admin('21000000-0000-0000-0000-000000000103','Leonardo Lima','Revisão manual',(select row_version from public.clients where id='21000000-0000-0000-0000-000000000103'))->>'status','applied','limpeza aprovada é aplicada');
select is((select full_name from public.clients where id='21000000-0000-0000-0000-000000000103'),'Leonardo Lima','nome passa a conter somente a identidade');
select is(jsonb_array_length(public.get_client_name_cleanup_history_admin('21000000-0000-0000-0000-000000000103')->'items'),1,'ação de limpeza fica registrada');
select is(public.apply_client_name_cleanup_admin('21000000-0000-0000-0000-000000000103','Leonardo Lima',null,null)->>'status','already_clean','reexecução da limpeza é idempotente');
select is(public.revert_client_name_cleanup_admin((public.get_client_name_cleanup_history_admin('21000000-0000-0000-0000-000000000103')->'items'->0->>'actionId')::uuid, 'Correção desfeita',(select row_version from public.clients where id='21000000-0000-0000-0000-000000000103'))->>'status','reverted','limpeza pode ser desfeita');
select is((select full_name from public.clients where id='21000000-0000-0000-0000-000000000103'),'Leonardo Lima ainda aguarda revisão e ativação','desfazer restaura o nome anterior');

select ok((public.update_client_contract_admin('21000000-0000-0000-0000-000000000102',null,current_date,null,'Plano indeterminado',199.90,'active',true,'Contrato criado após revisão','Criação revisada',(select row_version from public.clients where id='21000000-0000-0000-0000-000000000102'),null)->>'created')::boolean,'administrador cria contrato por prazo indeterminado');
select is((select ends_on from public.management_contracts where client_id='21000000-0000-0000-0000-000000000102'),null::date,'contrato sem término é preservado como indeterminado');
select is((select contract_review_status from public.clients where id='21000000-0000-0000-0000-000000000102'),'complete','contrato revisado conclui pendência');
select throws_ok($$select public.update_client_contract_admin('21000000-0000-0000-0000-000000000102',(select id from public.management_contracts where client_id='21000000-0000-0000-0000-000000000102'),current_date,current_date-1,'Plano',100,'active',false,null,'Motivo válido',(select row_version from public.clients where id='21000000-0000-0000-0000-000000000102'),null)$$,'22007','INVALID_CONTRACT_DATES','término anterior ao início é bloqueado');
select throws_ok($$select public.update_client_contract_admin('21000000-0000-0000-0000-000000000102',(select id from public.management_contracts where client_id='21000000-0000-0000-0000-000000000102'),current_date-1,null,'Plano',100,'active',false,null,null,(select row_version from public.clients where id='21000000-0000-0000-0000-000000000102'),null)$$,'22023','CHANGE_REASON_REQUIRED','mudança de vigência exige motivo');
select ok((public.update_client_contract_admin('21000000-0000-0000-0000-000000000102',(select id from public.management_contracts where client_id='21000000-0000-0000-0000-000000000102'),current_date-1,null,'Plano indeterminado',199.90,'active',true,'Revisado','Correção da data inicial',(select row_version from public.clients where id='21000000-0000-0000-0000-000000000102'),null)->>'created')::boolean=false,'vigência existente é atualizada sem novo contrato');
select ok(exists(select 1 from public.audit_logs where client_id='21000000-0000-0000-0000-000000000102' and action='update_client_contract_admin'),'alteração contratual fica auditada');
select throws_ok($$select public.update_client_contract_admin('21000000-0000-0000-0000-000000000102',(select id from public.management_contracts where client_id='21000000-0000-0000-0000-000000000102'),current_date-1,null,'Plano',100,'active',false,null,'Nova correção',(select row_version from public.clients where id='21000000-0000-0000-0000-000000000102'),now()-interval '1 day')$$,'40001','CONCURRENT_EDIT','edição concorrente do contrato é bloqueada');

select set_config('test.client_row_version',(select row_version::text from public.clients where id='21000000-0000-0000-0000-000000000102'),true);
set local role service_role;
select ok((public.update_client_profile_admin('21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000102',current_setting('test.client_row_version')::bigint,'Cliente Sem Contrato Editado','Cliente Editado','1990-05-10','novo@example.invalid','+5537999999999','+5537988888888','Nota privada',null,jsonb_build_object('ciphertext','protegido','hash',repeat('b',64),'last4','1234','kind','cpf'))->>'clientId') is not null,'perfil protegido é atualizado pelo backend de serviço');
set local role authenticated;
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-000000000001',true);
select is((select full_name from public.clients where id='21000000-0000-0000-0000-000000000102'),'Cliente Sem Contrato Editado','nome editado atualiza cadastro canônico');
select is((select email::text from public.clients where id='21000000-0000-0000-0000-000000000102'),'novo@example.invalid','e-mail validado é atualizado');
select ok((select row_version>1 from public.clients where id='21000000-0000-0000-0000-000000000102'),'versão de concorrência avança');
select ok((select not (new_data ? 'email') and (new_data->>'sensitiveValuesProtected')::boolean from public.audit_logs where client_id='21000000-0000-0000-0000-000000000102' and action='update_client_profile_admin' order by created_at desc limit 1),'auditoria não registra valor sensível');
set local role service_role;
select throws_ok($$select public.update_client_profile_admin('21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000102',1,'Nome Concorrente',null,null,'outro@example.invalid',null,null,null,null,null)$$,'40001','CONCURRENT_EDIT','edição concorrente de perfil é bloqueada');

set local role authenticated;
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.reactivate_client_admin('21000000-0000-0000-0000-000000000105',null,null)$$,'42501','FORBIDDEN','operador não reativa clientes');
select set_config('request.jwt.claim.sub','21000000-0000-0000-0000-000000000001',true);
select is((public.get_admin_clients(100,0,'','all')->'counts'->>'active')::integer,4,'contadores refletem os quatro clientes ativos');
select ok(exists(select 1 from public.audit_logs where client_id='21000000-0000-0000-0000-000000000103' and action='revert_client_name_cleanup_admin'),'reversão de nome também fica auditada');
reset role;
select is((select count(*) from public.client_reactivation_batches),1::bigint,'lote de reativação não é duplicado');
select is((select count(*) from public.client_reactivation_batch_items),3::bigint,'relatório persiste um resultado por cliente solicitado');
select is((select count(*) from public.clients where id::text like '21000000-0000-0000-0000-00000000010%'),5::bigint,'nenhum cliente é duplicado durante as operações');

select * from finish();
rollback;
