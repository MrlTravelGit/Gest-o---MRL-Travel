begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select has_column('public', 'contract_signature_requests', 'production_month_key', 'guarda o mês de produção');
select has_column('public', 'contract_signature_requests', 'approved_at', 'guarda a aprovação terminal');
select has_column('public', 'contract_signature_requests', 'customer_notified_at', 'guarda o envio único da mensagem');
select has_column('public', 'contract_signature_requests', 'customer_notification_status', 'guarda o status da mensagem');
select has_column('public', 'contract_signature_requests', 'customer_notification_error', 'guarda falha de notificação');
select has_column('public', 'contract_signature_requests', 'quota_override', 'guarda override auditável da cota');
select has_function('public', 'reserve_autentique_production_slot', array['uuid','integer','boolean'], 'reserva de cota existe');
select function_returns('public', 'reserve_autentique_production_slot', array['uuid','integer','boolean'], 'jsonb', 'reserva retorna contexto da cota');
select ok(not has_function_privilege('authenticated', 'public.reserve_autentique_production_slot(uuid,integer,boolean)', 'EXECUTE'), 'usuário autenticado não burla cota');
select ok(has_function_privilege('service_role', 'public.reserve_autentique_production_slot(uuid,integer,boolean)', 'EXECUTE'), 'backend pode reservar cota');
select has_index('public', 'contract_signature_requests_production_month_idx', 'índice da cota mensal existe');
select has_index('public', 'notifications_contract_approved_dedupe_key', 'notificação de aprovação é idempotente');

select * from finish();
rollback;
