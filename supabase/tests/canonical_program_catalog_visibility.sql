begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000151','00000000-0000-0000-0000-000000000000','authenticated','authenticated','catalog-admin@example.invalid','',now(),'{}'::jsonb,'{"full_name":"Admin Catálogo"}'::jsonb,now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000000151','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,created_by)
values('00000000-0000-0000-0000-000000000251','Cliente Catálogo','cliente','catalog-client@example.invalid','active','00000000-0000-0000-0000-000000000151');

set local role authenticated;
select set_config('request.jwt.claim.aal','aal2',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000151',true);

select is((
  select count(*)
  from public.loyalty_programs
  where slug = any(array[
    'nubank-croma','nubank-ultravioleta','picpay','revolut','btg-pactual','livelo','itau','esfera',
    'astropay','bradesco-cartoes','banco-do-brasil','uau-caixa','coopera','sicredi','banriclube',
    'banco-do-nordeste','banpara','banco-pan','sisprime','credicard','banestes','porto-bank',
    'brb-card','banco-mercantil','unicred','credicoamo'
  ]) and category='bancos' and active
),26::bigint,'os 26 programas financeiros solicitados estão ativos');
select is((
  select count(distinct slug)
  from public.loyalty_programs
  where slug = any(array[
    'nubank-croma','nubank-ultravioleta','picpay','revolut','btg-pactual','livelo','itau','esfera',
    'astropay','bradesco-cartoes','banco-do-brasil','uau-caixa','coopera','sicredi','banriclube',
    'banco-do-nordeste','banpara','banco-pan','sisprime','credicard','banestes','porto-bank',
    'brb-card','banco-mercantil','unicred','credicoamo'
  ])
),26::bigint,'os slugs solicitados são canônicos e únicos');
select ok((
  select bool_and(supports_points_launch and supports_bonus_transfer)
  from public.loyalty_programs
  where slug = any(array[
    'nubank-croma','nubank-ultravioleta','picpay','revolut','btg-pactual','livelo','itau','esfera',
    'astropay','bradesco-cartoes','banco-do-brasil','uau-caixa','coopera','sicredi','banriclube',
    'banco-do-nordeste','banpara','banco-pan','sisprime','credicard','banestes','porto-bank',
    'brb-card','banco-mercantil','unicred','credicoamo'
  ])
),'todos os programas solicitados suportam lançamento e campanha');
select ok(exists(select 1 from public.loyalty_programs where slug='nubank-croma' and name='Nubank Croma'),'slug canônico do Nubank Croma existe');
select is((select count(*) from public.program_accounts where client_id='00000000-0000-0000-0000-000000000251'),0::bigint,'cliente inicia sem contas de programa');
select ok(exists(select 1 from jsonb_array_elements(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000251')->'programs') p where p->>'slug'='nubank-croma' and (p->>'balance')::bigint=0 and p->>'accountId' is null),'catálogo administrativo inclui banco sem conta e saldo zero');
select is(jsonb_array_length(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000251')->'walletPrograms'),0,'carteira administrativa oculta programa sem relação');
select is(jsonb_array_length(public.get_admin_client_dashboard_preview('00000000-0000-0000-0000-000000000251')->'programs'),0,'painel público oculta programa sem relação');
select is((public.record_point_entry('00000000-0000-0000-0000-000000000251',(select id from public.loyalty_programs where slug='nubank-croma'),'points_purchase',current_date,1000,'total_value',10,null,'Teste catálogo','00000000-0000-0000-0000-000000000351')->>'newBalance')::bigint,1000::bigint,'lançamento em banco novo atualiza saldo');
select ok(exists(select 1 from jsonb_array_elements(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000251')->'walletPrograms') p where p->>'slug'='nubank-croma'),'programa passa a aparecer na carteira após lançamento');
select is((select count(*) from public.program_accounts pa join public.loyalty_programs lp on lp.id=pa.program_id where pa.client_id='00000000-0000-0000-0000-000000000251' and lp.slug='nubank-croma'),1::bigint,'lançamento cria uma única conta canônica');
select is((public.record_manual_exit('00000000-0000-0000-0000-000000000251',(select pa.id from public.program_accounts pa join public.loyalty_programs lp on lp.id=pa.program_id where pa.client_id='00000000-0000-0000-0000-000000000251' and lp.slug='nubank-croma'),current_date,1000,'Zerar saldo para teste','00000000-0000-0000-0000-000000000352')->>'newBalance')::bigint,0::bigint,'saída zera o saldo do programa');
select is(jsonb_array_length(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000251')->'walletPrograms'),0,'programa sem clube desaparece quando o saldo volta a zero');
select is((public.set_program_club_status('00000000-0000-0000-0000-000000000251',(select id from public.loyalty_programs where slug='nubank-croma'),true)->>'clubActive')::boolean,true,'clube pode ser ativado com saldo zero');
select ok(exists(select 1 from jsonb_array_elements(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000251')->'walletPrograms') p where p->>'slug'='nubank-croma'),'clube ativo mantém o programa na carteira');
select is((public.set_program_club_status('00000000-0000-0000-0000-000000000251',(select id from public.loyalty_programs where slug='nubank-croma'),false)->>'clubActive')::boolean,false,'clube pode ser desativado');
select is(jsonb_array_length(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000251')->'walletPrograms'),0,'programa zerado desaparece após desativar o clube');
update public.program_accounts set membership_number_masked='*** 1234' where client_id='00000000-0000-0000-0000-000000000251' and program_id=(select id from public.loyalty_programs where slug='nubank-croma');
select ok(exists(select 1 from jsonb_array_elements(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000251')->'walletPrograms') p where p->>'slug'='nubank-croma' and (p->>'linkedAccount')::boolean),'conta explicitamente vinculada aparece com saldo zero');
select ok(exists(select 1 from jsonb_array_elements(public.get_admin_client_points_detail('00000000-0000-0000-0000-000000000251')->'programs') p where p->>'slug'='credicoamo'),'select de lançamento preserva todo o catálogo ativo');
select ok(exists(select 1 from jsonb_array_elements(public.get_bonus_transfer_admin()->'programs') p where p->>'slug'='nubank-croma' and (p->>'isTransferSource')::boolean),'banco novo aparece como origem de transferência bonificada');

select * from finish();
rollback;
