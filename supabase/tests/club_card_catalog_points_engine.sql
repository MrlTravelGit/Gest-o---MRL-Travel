begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

select is((select monthly_points from public.loyalty_club_plans where slug='esfera-pro' and catalog_version=1),1000::bigint,'Esfera Pro preve 1.000 pontos mensais');
select is((select monthly_points from public.loyalty_club_plans where slug='esfera-master' and catalog_version=1),2500::bigint,'Esfera Master preve 2.500 pontos mensais');
select is((select monthly_points from public.loyalty_club_plans where slug='esfera-vip' and catalog_version=1),5000::bigint,'Esfera VIP preve 5.000 pontos mensais');
select is((select monthly_points from public.loyalty_club_plans where slug='esfera-exclusive' and catalog_version=1),20000::bigint,'Esfera Exclusive preve 20.000 pontos mensais');
select is((select joining_bonus_points from public.loyalty_club_plans where slug='smiles-mais-streaming-1000'),14500::bigint,'bonus de 14.500 fica separado do mensal');
select is((select count(*) from public.loyalty_club_plans where slug in ('esfera-pro','esfera-master','esfera-vip','esfera-exclusive','smiles-mais-streaming-1000')),5::bigint,'seed possui cinco clubes sem duplicidade');
select is((select count(*) from public.card_catalog_versions where version=1),56::bigint,'catalogo inicial possui 56 produtos');
select is((select count(*) from public.card_catalog_versions where source_quality='official_up_to' and calculation_enabled),0::bigint,'nenhum produto official_up_to calcula automaticamente');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000002500','00000000-0000-0000-0000-000000000000','authenticated','authenticated','patch025-admin@example.invalid','',now(),'{}','{"full_name":"Patch 025 Admin"}',now(),now());
insert into public.staff_members(user_id,role,active) values('00000000-0000-0000-0000-000000002500','super_admin',true);
insert into public.clients(id,full_name,first_name_normalized,email,status,created_by)
values('00000000-0000-0000-0000-000000002501','Cliente Patch 025','cliente','patch025-client@example.invalid','active','00000000-0000-0000-0000-000000002500');
insert into public.program_accounts(id,client_id,program_id,active,created_by)
select '00000000-0000-0000-0000-000000002502','00000000-0000-0000-0000-000000002501',id,true,'00000000-0000-0000-0000-000000002500'
from public.loyalty_programs where slug='smiles';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002500',true);

create temporary table patch025_subscription as
select public.upsert_client_club_subscription_v2(
  p_client_id=>'00000000-0000-0000-0000-000000002501',
  p_account_id=>'00000000-0000-0000-0000-000000002502',
  p_plan_id=>(select id from public.loyalty_club_plans where slug='smiles-mais-streaming-1000'),
  p_starts_on=>date '2026-08-01',p_next_competence=>date '2026-08-01',
  p_effective_price=>75.90,p_contracted_offer=>'Oferta Clube Mais Streaming 1.000',
  p_selected_streaming=>'Disney+',p_joining_bonus_eligible=>true,
  p_eligibility_confirmation=>'{"joinedOn":"2026-08-01","confirmedByReason":"Oferta contratada conferida pelo administrador"}'
) result;
select public.upsert_client_club_subscription_v2(
  p_subscription_id=>(select (result->>'subscriptionId')::uuid from patch025_subscription),
  p_client_id=>'00000000-0000-0000-0000-000000002501',
  p_account_id=>'00000000-0000-0000-0000-000000002502',
  p_plan_id=>(select id from public.loyalty_club_plans where slug='smiles-mais-streaming-1000'),
  p_starts_on=>date '2026-08-01',p_next_competence=>date '2026-09-01',
  p_effective_price=>75.90,p_contracted_offer=>'Oferta Clube Mais Streaming 1.000',
  p_selected_streaming=>'Disney+',p_joining_bonus_eligible=>true,
  p_eligibility_confirmation=>'{"joinedOn":"2026-08-01","confirmedByReason":"Oferta contratada conferida pelo administrador"}'
);
select is((select sum(expected_points) from public.scheduled_point_credits
  where subscription_id=(select (result->>'subscriptionId')::uuid from patch025_subscription)),2000::numeric,
  'Smiles + Streaming gera somente 1.000 mensais em duas competencias');
select is((select count(*) from public.club_joining_bonus_credits
  where subscription_id=(select (result->>'subscriptionId')::uuid from patch025_subscription)),1::bigint,
  'bonus de adesao de 14.500 nao se repete no segundo mes');

create temporary table patch025_cards(slug text primary key,card_id uuid);

insert into patch025_cards
select 'c6-carbon-mastercard-black',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-07-24',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Teste de calculo por dolar',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='c6-carbon-mastercard-black' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='c6-carbon-mastercard-black'),date '2026-08-01',
  '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any"}]',5
)->>'expectedPoints')::numeric,2500.0000::numeric,'2,5 pontos por dolar: R$ 5.000 / 5 gera 2.500');

insert into patch025_cards
select 'c6-basico',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-07-25',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Teste de calculo por real',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='c6-basico' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='c6-basico'),date '2026-08-01',
  '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any"}]',null
)->>'expectedPoints')::numeric,250.0000::numeric,'C6 basico gera 250 pontos');

insert into patch025_cards
select 'inter-platinum',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-07-26',null,'holder','points',
  null,null,null,false,true,null,null,null,null,'Debito automatico confirmado',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='inter-platinum' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='inter-platinum'),date '2026-08-01',
  '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any"}]',null
)->>'expectedPoints')::numeric,1000.0000::numeric,'Inter Platinum gera 1.000 pontos');

insert into patch025_cards
select 'inter-win',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-07-27',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Teste Inter Win',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='inter-win' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='inter-win'),date '2026-08-01',
  '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any"}]',null
)->>'expectedPoints')::numeric,2500.0000::numeric,'Inter Win gera 2.500 pontos');

insert into patch025_cards
select 'itau-azul-platinum',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-07-28',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Parceiro Azul',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='itau-azul-platinum' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='itau-azul-platinum'),date '2026-08-01',
  '[{"amountBrl":1000,"spendLocation":"domestic","merchantScope":"any"},{"amountBrl":1000,"spendLocation":"domestic","merchantScope":"airline","merchantName":"Azul"}]',5
)->>'expectedPoints')::numeric,960.0000::numeric,'Azul Platinum aplica 2,2 comum e 2,6 na Azul');

insert into patch025_cards
select 'santander-gol-smiles-platinum',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-07-29',null,'holder','points',
  null,'clube_smiles',null,false,false,null,null,null,null,'Clube Smiles confirmado',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='santander-gol-smiles-platinum' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='santander-gol-smiles-platinum'),date '2026-08-01',
  '[{"amountBrl":1000,"spendLocation":"domestic","merchantScope":"any"}]',5
)->>'expectedPoints')::numeric,700.0000::numeric,'GOL Platinum substitui taxa comum pela taxa Clube Smiles');

insert into patch025_cards
select 'itau-pao-de-acucar-visa-platinum-pontos',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-07-30',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Parceiro Pao de Acucar',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='itau-pao-de-acucar-visa-platinum-pontos' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='itau-pao-de-acucar-visa-platinum-pontos'),date '2026-08-01',
  '[{"amountBrl":1000,"spendLocation":"domestic","merchantScope":"program_partner","merchantName":"Pao de Acucar"}]',5
)->>'expectedPoints')::numeric,1000.0000::numeric,'Pao de Acucar aplica 5 sem somar taxa nacional');

insert into patch025_cards
select 'sicredi-mastercard-black',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-07-31',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Faixa Sicredi',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='sicredi-mastercard-black' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='sicredi-mastercard-black'),date '2026-08-01',
  '[{"amountBrl":15000,"spendLocation":"domestic","merchantScope":"any"}]',5
)->>'expectedPoints')::numeric,6900.0000::numeric,'Sicredi Black escolhe faixa intermediaria');

insert into patch025_cards
select 'bb-altus-liv-visa-infinite',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-08-01',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Faixa Altus',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='bb-altus-liv-visa-infinite' and version=1;
select is((public.calculate_client_card_points(
  (select card_id from patch025_cards where slug='bb-altus-liv-visa-infinite'),date '2026-08-01',
  '[{"amountBrl":30000,"spendLocation":"domestic","merchantScope":"any"}]',5
)->>'expectedPoints')::numeric,24000.0000::numeric,'Altus Liv escolhe faixa superior');

insert into patch025_cards
select 'c6-mastercard-black',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-08-02',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Taxa ate pendente',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='c6-mastercard-black' and version=1;
select throws_ok(
  format('select public.calculate_client_card_points(%L,date %L,%L::jsonb,5)',
    (select card_id from patch025_cards where slug='c6-mastercard-black'),'2026-09-01',
    '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any"}]'),
  '22023','A fonte informa ate/a partir de. Confirme a taxa contratual real do cliente antes de calcular.',
  'official_up_to nao calcula sem taxa real');

select throws_ok(
  format('select public.associate_catalog_card(%L,%L,date %L,null,%L,%L,null,null,null,false,false,2.2,%L,%L,%L,%L,null)',
    '00000000-0000-0000-0000-000000002501',
    (select id from public.card_catalog_versions where card_slug='porto-bank-platinum' and version=1),
    '2026-08-03','holder','points','points_per_usd','curta','site','Teste'),
  '22023','Taxa personalizada exige unidade, justificativa e fonte.',
  'taxa personalizada sem justificativa suficiente e rejeitada');

insert into patch025_cards
select 'caixa-icone-visa',(public.associate_catalog_card(
  '00000000-0000-0000-0000-000000002501',id,date '2026-08-04',null,'holder','points',
  null,null,null,false,false,null,null,null,null,'Regra temporaria CAIXA',null
)->>'cardId')::uuid from public.card_catalog_versions where card_slug='caixa-icone-visa' and version=1;
select throws_ok(
  format('select public.calculate_client_card_points(%L,date %L,%L::jsonb,5)',
    (select card_id from patch025_cards where slug='caixa-icone-visa'),'2027-01-01',
    '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any"}]'),
  '22023','A versao do cartao nao esta vigente para esta fatura.',
  'regra fora da vigencia do catalogo nao e usada');

select is((public.record_catalog_card_statement(
  (select card_id from patch025_cards where slug='c6-basico'),date '2026-09-01',
  '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any","rate":999}]',
  5000,0,null,null,null,'Frontend tentou enviar rate livre','00000000-0000-0000-0000-000000002599'
)->>'expectedPoints')::numeric,250.0000::numeric,'backend ignora taxa livre enviada no segmento');
select is((select calculation_version from public.card_statements where operation_id='00000000-0000-0000-0000-000000002599'),'card-points-v2','fatura registra a versao do calculo');
select ok((select calculation_details ? 'applications' from public.card_statements where operation_id='00000000-0000-0000-0000-000000002599'),'fatura preserva memoria de regras');
select is((select count(*) from public.card_statement_rule_applications a join public.card_statements s on s.id=a.statement_id where s.operation_id='00000000-0000-0000-0000-000000002599'),1::bigint,'aplicacao de regra e auditavel');

select ok((public.duplicate_card_catalog_version(
  (select id from public.card_catalog_versions where card_slug='c6-basico' and version=1),
  'Teste de preservacao da versao anterior'
)->>'version')::integer=2,'duplica como nova versao');
select is((select catalog_version_id from public.credit_cards where id=(select card_id from patch025_cards where slug='c6-basico')),
  (select id from public.card_catalog_versions where card_slug='c6-basico' and version=1),
  'nova versao nao altera o vinculo e a fatura antiga');
select ok(not has_function_privilege('anon','public.get_card_catalog(text,text,text,text,boolean)','EXECUTE'),'anon nao executa catalogo administrativo');
select ok((select count(*)>0 from public.audit_logs where action='associate_catalog_card' and client_id='00000000-0000-0000-0000-000000002501'),'associacao gera auditoria');

reset role;
select * from finish();
rollback;
