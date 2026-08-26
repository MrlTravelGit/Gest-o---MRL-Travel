begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_table('public','vault_provisioning_outbox','outbox local existe');
select columns_are('public','vault_provisioning_outbox',array['event_id','client_id','display_name','contract_start_date','contract_end_date','event_type','occurred_at','processing_status'],'outbox contem somente o contrato minimo');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='vault_provisioning_outbox' and column_name ~* '(cpf|email|phone|login|password|secret|token|document|address|note)'),0::bigint,'outbox nao possui coluna sensivel');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.vault_provisioning_outbox'::regclass),'RLS da outbox e forcada');
select has_function('public','get_client_management_terms_v1',array['numeric','numeric','text','date','date','boolean','boolean','integer','integer','numeric','numeric','text','text','text','date','date','text'],'RPC de vigencias existe com assinatura canonica');
select has_function('public','claim_vault_provisioning_events_v1',array['integer'],'claim da identidade tecnica existe');
select has_function('public','acknowledge_vault_provisioning_event_v1',array['uuid','boolean'],'ack idempotente existe');
select throws_ok($$select public.claim_vault_provisioning_events_v1(1)$$,'42501','FORBIDDEN','usuario anonimo nao consome a outbox');
select throws_ok($$select public.get_client_management_terms_v1(p_term_status=>'invalido')$$,'42501','FORBIDDEN','usuario anonimo nao consulta vigencias');
select is((select count(*) from information_schema.role_routine_grants where routine_schema='public' and routine_name='claim_vault_provisioning_events_v1' and grantee='anon'),0::bigint,'anon nao executa claim');

select * from finish();
rollback;
