begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_table('public', 'contract_signature_requests', 'tabela de envios para assinatura existe');
select has_table('public', 'contract_signature_signers', 'tabela de signatários existe');
select has_table('public', 'autentique_webhook_events', 'tabela idempotente de webhooks existe');
select has_column('public', 'contract_signature_requests', 'provider_document_id', 'envio guarda documento externo');
select has_column('public', 'contract_signature_requests', 'signed_pdf_url', 'envio guarda PDF assinado');
select has_column('public', 'contract_signature_requests', 'last_webhook_payload', 'envio guarda último webhook');
select has_column('public', 'contract_signature_signers', 'signature_link', 'signatário guarda link de assinatura');
select has_column('public', 'contract_signature_signers', 'signed_at', 'signatário guarda data de assinatura');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.contract_signature_requests'::regclass), 'RLS protege solicitações');
select ok(not has_table_privilege('anon', 'public.contract_signature_requests', 'SELECT'), 'visitante não consulta links de assinatura');

select * from finish();
rollback;
