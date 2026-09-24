begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select has_column('public', 'card_catalog_versions', 'display_name', 'catálogo possui nome de exibição');
select has_column('public', 'card_catalog_versions', 'account_type', 'catálogo possui tipo de conta');
select has_column('public', 'card_catalog_versions', 'earning_currency', 'catálogo possui moeda da regra');
select has_column('public', 'card_catalog_versions', 'notes', 'catálogo possui observação');
select ok(
  not has_function_privilege('anon', 'public.admin_upsert_card_catalog(uuid,text,text,text,text,numeric,text,text,text,boolean)', 'EXECUTE'),
  'visitante não pode alterar o catálogo'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('06400000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch064@example.invalid','',now(),'{}'::jsonb,'{"full_name":"Admin Patch 064"}'::jsonb,now(),now());
insert into public.staff_members(user_id,role,active)
values('06400000-0000-4000-8000-000000000001','super_admin',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','06400000-0000-4000-8000-000000000001',true);

create temporary table patch064_card as
select (public.admin_upsert_card_catalog(
  null,'Banco Teste 064','Infinite Teste','Banco Teste 064 Infinite Teste','Pessoa Física',
  2.4,'USD','Livelo','Criado pelo teste automatizado',true
)->>'catalogVersionId')::uuid id;

select is(
  (select display_name from public.card_catalog_versions where id=(select id from patch064_card)),
  'Banco Teste 064 Infinite Teste',
  'novo cartão é salvo no catálogo versionado'
);
select is(
  (select rate from public.card_catalog_rules where catalog_version_id=(select id from patch064_card) and rule_scope='default'),
  2.4::numeric,
  'regra padrão em dólar é criada'
);
select throws_ok(
  $$select public.admin_upsert_card_catalog(null,' Banco Teste 064 ',' Infinite Teste ','Duplicado','Pessoa Física',2.4,'USD','Livelo',null,true)$$,
  '23505','CARD_CATALOG_DUPLICATE','cadastro duplicado é recusado'
);

select public.admin_upsert_card_catalog(
  (select id from patch064_card),'Banco Teste 064','Infinite Teste','Banco Teste 064 Infinite Atualizado',
  'Pessoa Física',3.1,'USD','Livelo','Taxa atualizada pelo teste',false
);

select is(
  (select rate from public.card_catalog_rules where catalog_version_id=(select id from patch064_card) and rule_scope='default'),
  3.1::numeric,
  'edição atualiza a pontuação por dólar'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements((public.get_card_catalog(null,null,null,null,false))->'items') item
    where item->>'catalogVersionId'=(select id::text from patch064_card)
  ),
  'cartão inativo não aparece nas consultas operacionais'
);

select * from finish();
rollback;
