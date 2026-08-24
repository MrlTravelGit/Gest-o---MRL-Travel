begin;

-- PATCH MRL 20260722-022
-- Importacao auditavel das economias legadas do Iddas na entidade financeira oficial.

alter table public.import_staging_rows drop constraint if exists staging_entity_valid;
alter table public.import_staging_rows add constraint staging_entity_valid
  check (entity_type in ('client','task','onboarding','program','passage','saving'));

alter table public.redemptions
  add column if not exists source_system text,
  add column if not exists source_batch_key text,
  add column if not exists source_external_key text,
  add column if not exists source_legacy_person_id bigint,
  add column if not exists source_payload_hash text,
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete restrict,
  add column if not exists imported_at timestamptz;

create unique index if not exists redemptions_source_external_key_unique
  on public.redemptions(source_system,source_external_key)
  where source_system is not null and source_external_key is not null;
create index if not exists redemptions_source_batch_idx
  on public.redemptions(source_batch_key,client_id,status);

comment on column public.redemptions.source_payload_hash is
  'Hash imutavel do payload legado. Edicoes administrativas posteriores nao alteram este valor.';

create or replace function public.normalize_iddas_savings_name(p_value text)
returns text language sql immutable set search_path=pg_catalog,public as $$
  select regexp_replace(
    translate(lower(trim(coalesce(p_value,''))),
      'áàâãäéèêëíìîïóòôõöúùûüçñýÿ',
      'aaaaaeeeeiiiiooooouuuucnyy'),
    '[^a-z0-9]+','','g');
$$;

create or replace function public.iddas_savings_operation_uuid(p_external_key text)
returns uuid language sql immutable set search_path=pg_catalog,public as $$
  select (substr(x,1,8)||'-'||substr(x,9,4)||'-'||substr(x,13,4)||'-'||substr(x,17,4)||'-'||substr(x,21,12))::uuid
  from (select md5('iddas:savings:'||p_external_key||':v1') x) s;
$$;

create or replace function public.iddas_savings_redemption_type(p_description text)
returns public.redemption_type language sql immutable set search_path=pg_catalog,public as $$
  select case
    when public.normalize_iddas_savings_name(p_description) ~ '(hotel|hospedagem)' then 'hotel'::public.redemption_type
    when public.normalize_iddas_savings_name(p_description) ~ '(passagem|emissao|viagem|upgrade|seguro)' then 'flight'::public.redemption_type
    else 'other'::public.redemption_type
  end;
$$;

create table public.iddas_savings_source_rows (
  row_number integer primary key check (row_number between 1 and 68),
  source_batch_key text not null default 'iddas_economias_20260722_v1',
  legacy_person_id bigint,
  legacy_name text not null,
  event_date date not null,
  description text not null,
  original_value_brl numeric(16,2) not null check (original_value_brl>=0),
  paid_value_brl numeric(16,2) not null check (paid_value_brl>=0),
  verified_savings_value_brl numeric(16,2) not null,
  legacy_sequence integer not null check (legacy_sequence>0),
  source_external_key text not null unique,
  source_payload_hash text not null,
  created_at timestamptz not null default now(),
  constraint iddas_savings_source_batch_valid check (source_batch_key='iddas_economias_20260722_v1'),
  constraint iddas_savings_formula_valid check (abs(round(original_value_brl-paid_value_brl,2)-verified_savings_value_brl)<=0.01)
);

alter table public.iddas_savings_source_rows enable row level security;
alter table public.iddas_savings_source_rows force row level security;
revoke all on public.iddas_savings_source_rows from public,anon,authenticated;
grant all on public.iddas_savings_source_rows to service_role;

insert into public.iddas_savings_source_rows(
  row_number,legacy_person_id,legacy_name,event_date,description,
  original_value_brl,paid_value_brl,verified_savings_value_brl,legacy_sequence,
  source_external_key,source_payload_hash
)
select v.row_number,v.legacy_person_id,v.legacy_name,v.event_date,v.description,
       v.original_value_brl,v.paid_value_brl,v.verified_savings_value_brl,v.legacy_sequence,
       'iddas_economias_20260722_v1:'||coalesce(v.legacy_person_id::text,public.normalize_iddas_savings_name(v.legacy_name))||':'||v.event_date::text||':'||v.legacy_sequence::text,
       md5(concat_ws('|',v.legacy_person_id::text,v.legacy_name,v.event_date::text,v.description,
         to_char(v.original_value_brl,'FM999999999999990.00'),to_char(v.paid_value_brl,'FM999999999999990.00'),
         to_char(v.verified_savings_value_brl,'FM999999999999990.00'),v.legacy_sequence::text))
from (values
  (1,35188,'Cristiane Suelen de Campos Cordeiro','2026-06-02'::date,'Emissão de Passagem Aérea (CNF - CGH) - 14 a 15/06',2323.00,1600.00,723.00,1),
  (2,35188,'Cristiane Suelen de Campos Cordeiro','2026-05-20'::date,'Emissão de Passagem Aérea (CNF - CGH) - 20 a 22/05',4657.50,3200.00,1457.50,1),
  (3,12122,'Jessica Veloso Machado','2026-01-28'::date,'Emissão de Passagem Aérea - CNF a CGH | 08 a 11/03',695.40,655.64,39.76,1),
  (4,12122,'Jessica Veloso Machado','2025-12-28'::date,'Reserva de Hotel - São Paulo | 08 a 11/03/26',1254.60,1145.16,109.44,1),
  (5,22872,'Renata Martins Migotto','2025-11-26'::date,'Emissão de Passagem Aérea (VCP - FLL) - Salete',2223.96,1822.40,401.56,1),
  (6,22872,'Renata Martins Migotto','2025-11-25'::date,'Emissão de Passagem Aérea (VCP - FLL) - Tereza',2223.46,1401.01,822.45,1),
  (7,22872,'Renata Martins Migotto','2025-11-25'::date,'Emissão de Passagem Aérea (VCP - FLL) - Rafael',5113.60,3479.44,1634.16,2),
  (8,12334,'Diego Souza Barbosa','2025-11-19'::date,'SEGURO DE VIAGEM | ASSIST CARD PLANO 250 INTER | 24 a 07/08/26 - LISBOA',2397.02,0.00,2397.02,1),
  (9,12122,'Jessica Veloso Machado','2025-11-03'::date,'Reserva de Hotel - Arraial D''Ajuda | 13 a 20/03/26',4197.00,3892.00,305.00,1),
  (10,12122,'Jessica Veloso Machado','2025-11-03'::date,'Reserva de Translado/Transfer - BPS a Arraial d''Ajuda | 13 a 20/03/26',553.84,0.00,553.84,2),
  (11,12122,'Jessica Veloso Machado','2025-10-31'::date,'Emissão de Passagem Aérea - CNF a BPS | 13 a 20/03',2935.06,130.58,2804.48,1),
  (12,23532,'Fernando Sodré Schreurs','2025-09-30'::date,'COMPRA DE PASSAGEM PARA O JAPÃO EM DEZEMBRO',85659.74,50322.86,35336.88,1),
  (13,22287,'Uli Zarzana de Menezes','2025-09-10'::date,'REFERENTE À PASSAGEM OPERADA PELA COPA, QUE FOI EMITIDA DIRETAMENTE PELA GOL (VIAGEM DE FIM DE ANO)',11695.18,8824.08,2871.10,1),
  (14,8250,'Fábio Izaias Martins de lima','2025-09-04'::date,'Emissão de Passagem Aérea (CNF - GRU) - Fábio e Janice',798.00,134.40,663.60,1),
  (15,22872,'Renata Martins Migotto','2025-09-03'::date,'REFERENTE À UPGRADE EM TRECHO DE SÃO PAULO À LISBOA VIA TAP',23684.24,4288.00,19396.24,1),
  (16,22872,'Renata Martins Migotto','2025-08-28'::date,'REFERENTE À PASSAGEM CANCELADA VIA CONSUMIDOR.GOV OBTENDO O VALOR TOTAL DO REEMBOLSO. (RESERVA-LWFQXN)',2821.40,0.00,2821.40,1),
  (17,22287,'Uli Zarzana de Menezes','2025-08-04'::date,'Ingressos para o Universal Orlando Resort - 17 a 23/08',8234.18,7534.61,699.57,1),
  (18,13771,'Francelle Almeida Arêdes','2025-07-30'::date,'Hotel Mercure São Paulo',1450.00,1050.00,400.00,1),
  (19,22287,'Uli Zarzana de Menezes','2025-07-29'::date,'Emissão de Passagem Aérea - CGH - JOI - 19/09',995.15,725.00,270.15,1),
  (20,22287,'Uli Zarzana de Menezes','2025-07-28'::date,'Emissão de Passagem Aérea - CGH - JOI',1326.16,1206.13,120.03,1),
  (21,13771,'Francelle Almeida Arêdes','2025-07-23'::date,'Emissão de Passagem Aérea - CNF - CGH (08.08 - 10.08)',1203.98,274.52,929.46,1),
  (22,8250,'Fábio Izaias Martins de lima','2025-07-19'::date,'Emissão de Passagem Aérea (CNF-BPS) - Janice e Mirléia',2542.18,1500.00,1042.18,1),
  (23,22694,'Alessandra Duarte Martins','2025-07-18'::date,'Emissão de Passagem Aérea - CNF - VIX',2723.32,1029.32,1694.00,1),
  (24,13771,'Francelle Almeida Arêdes','2025-06-13'::date,'Hotel Transamerica Berrini',900.00,600.00,300.00,1),
  (25,15744,'Beatriz Menezes Martins Cordeiro','2025-05-21'::date,'Emissão de Passagem Aérea, GIG - CNF - Luiza (26/05/2025)',891.00,750.00,141.00,1),
  (26,13771,'Francelle Almeida Arêdes','2025-05-13'::date,'Emissão de Passagem Aérea (CNF - CGH) - 14/06',467.98,94.18,373.80,1),
  (27,12460,'Juliana cordeirio verissimo','2025-05-08'::date,'REFERENTE À COMPRA DE MALA COM PONTOS QUE IAM EXPIRAR',0.00,0.00,0.00,1),
  (28,13771,'Francelle Almeida Arêdes','2025-04-26'::date,'Hotel Brasília Tower',1100.00,750.00,350.00,1),
  (29,13771,'Francelle Almeida Arêdes','2025-04-22'::date,'Emissão de Passagem Aérea (BSB - CNF) 09/05/25',760.85,30.95,729.90,1),
  (30,15744,'Beatriz Menezes Martins Cordeiro','2025-04-17'::date,'Emissão de Passagem Aérea - Geraldo Otacilio (CGH - 24/04)',1464.00,1400.00,64.00,1),
  (31,13771,'Francelle Almeida Arêdes','2025-04-08'::date,'Emissão de Passagem Aérea - CNF - BSB',194.59,31.69,162.90,1),
  (32,15744,'Beatriz Menezes Martins Cordeiro','2025-04-07'::date,'Passagem Aérea, Geraldo Otacilio (SDU - 10/04)',6492.00,4400.00,2092.00,1),
  (33,15744,'Beatriz Menezes Martins Cordeiro','2025-04-01'::date,'Emissão de Passagem Aérea - CNF - CGH',5012.22,2600.00,2412.22,1),
  (34,10178,'Alessandra (Antigo)','2025-03-27'::date,'VIAGEM PARA ORLANDO 4 PESSOAS',13900.00,1066.70,12833.30,1),
  (35,18179,'José Roberto da Silva','2025-03-26'::date,'VIAGEM IDA E VOLTA PARA NOVA YORK',12692.88,6800.00,5892.88,1),
  (36,13771,'Francelle Almeida Arêdes','2025-03-21'::date,'Emissão de Passagem Aérea - CNF - BSB',1292.44,62.64,1229.80,1),
  (37,18179,'José Roberto da Silva','2025-03-19'::date,'EMISSÃO DE PASSAGEM AÉREA DE BH A GUARULHOS (Milhas Próprias)',0.00,0.00,0.00,1),
  (38,8250,'Fábio Izaias Martins de lima','2024-12-28'::date,'Passagem de Ida CNF - REC 10/04/2025',1967.18,1355.00,612.18,1),
  (39,8250,'Fábio Izaias Martins de lima','2024-12-28'::date,'Passagem de Volta Recife 14/04/2025',1577.78,117.78,1460.00,2),
  (40,9485,'Leonardo José de Sousa Lima','2024-12-16'::date,'Ferro de Passar Roupa',179.76,0.00,179.76,1),
  (41,8250,'Fábio Izaias Martins de lima','2024-12-13'::date,'Passagem aérea (SP-CNF) IDA E VOLTA',641.11,92.31,548.80,1),
  (42,12334,'Diego Souza Barbosa','2024-12-13'::date,'Cupom desconto Mercado Livre',25.00,0.00,25.00,1),
  (43,13940,'Igor Luis Sousa Santos','2024-12-05'::date,'Hospedagem São Paulo (16-22/01/2025)',2500.00,1760.00,740.00,1),
  (44,12334,'Diego Souza Barbosa','2024-11-26'::date,'Cashback produtos Natura',41.22,0.00,41.22,1),
  (45,13940,'Igor Luis Sousa Santos','2024-11-20'::date,'Passagem aérea de Belo Horizonte a São Paulo',4096.08,0.00,4096.08,1),
  (46,12334,'Diego Souza Barbosa','2024-11-14'::date,'Cupom desconto Mercado Livre',25.00,0.00,25.00,1),
  (47,10868,'Sara Menezes Araujo Valadares','2024-11-12'::date,'Passagem GIG-CNF (Dia 27 de abril 2025)',1312.00,128.40,1183.60,1),
  (48,12334,'Diego Souza Barbosa','2024-11-11'::date,'Cupom desconto Mercado Livre',30.00,0.00,30.00,1),
  (49,12334,'Diego Souza Barbosa','2024-11-01'::date,'Cupom desconto Mercado Livre',40.00,0.00,40.00,1),
  (50,13771,'Francelle Almeida Arêdes','2024-10-30'::date,'Emissão de Passagem aérea CNF - SP',1988.54,1434.48,554.06,1),
  (51,null,'Hamilton Antônio Figueiredo','2024-10-23'::date,'HOSPEDAGEM HOTEL OFT TAMANDARE PLAZE',855.19,0.00,855.19,1),
  (52,8250,'Fábio Izaias Martins de lima','2024-10-22'::date,'Hospedagem Gramado',456.00,0.00,456.00,1),
  (53,9483,'Guilherme de Campos Barcelos','2024-10-20'::date,'Hospedagem em Rio de Janeiro',240.89,0.00,240.89,1),
  (54,9483,'Guilherme de Campos Barcelos','2024-10-20'::date,'Passagem CNF-GIG',1600.00,0.00,1600.00,2),
  (55,12460,'Juliana cordeirio verissimo','2024-10-15'::date,'PASSAGEM (CNF - FLN)',730.43,0.00,730.43,1),
  (56,12122,'Jessica Veloso Machado','2024-10-14'::date,'Passagem Aérea Rio de Janeiro - 11 de fevereiro - Amanda, Josiana, Felipe',2636.93,2000.00,636.93,1),
  (57,12122,'Jessica Veloso Machado','2024-10-14'::date,'Emissão de Passagem aérea Azul - 11 de Fevereiro (Emitido com suas milhas)',878.97,0.00,878.97,2),
  (58,12122,'Jessica Veloso Machado','2024-10-14'::date,'Hospedagem Rio de Janeiro - Ibis Rio de Janeiro Nova América (Amanda, Felipe, Jéssica e Josiana)',1118.00,953.00,165.00,3),
  (59,12460,'Juliana cordeirio verissimo','2024-10-13'::date,'ALUGUEL DE VEÍCULO',180.00,0.00,180.00,1),
  (60,12460,'Juliana cordeirio verissimo','2024-10-13'::date,'PASSAGEM (CNF - FOR)',1620.12,0.00,1620.12,2),
  (61,12334,'Diego Souza Barbosa','2024-09-16'::date,'Cupom desconto Mercado Livre',30.00,0.00,30.00,1),
  (62,4482,'Michael','2024-08-20'::date,'teste',1000.00,300.00,700.00,1),
  (63,8250,'Fábio Izaias Martins de lima','2024-06-28'::date,'Passagem aérea (CNF-SP) VOLTA',193.00,0.00,193.00,1),
  (64,8250,'Fábio Izaias Martins de lima','2024-06-28'::date,'Passagem aérea (CNF-SP) IDA',697.00,0.00,697.00,2),
  (65,8250,'Fábio Izaias Martins de lima','2024-06-14'::date,'ALUGUEL CARRO',248.00,0.00,248.00,1),
  (66,8250,'Fábio Izaias Martins de lima','2024-06-14'::date,'Passagem aérea (CNF-POA)',1784.00,0.00,1784.00,2),
  (67,9933,'CLEITON NOGUEIRA FELIZARDO','2024-06-08'::date,'Hotel Caldas Novas (Rio Quente)',4900.00,0.00,4900.00,1),
  (68,8250,'Fábio Izaias Martins de lima','2024-04-04'::date,'Passagem aérea (CNF-SP)',879.00,0.00,879.00,1)
) as v(row_number,legacy_person_id,legacy_name,event_date,description,original_value_brl,paid_value_brl,verified_savings_value_brl,legacy_sequence);

create or replace function public.prevent_iddas_savings_source_mutation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception 'IDDAS_SAVINGS_SOURCE_IMMUTABLE' using errcode='55000';
end; $$;
create trigger iddas_savings_source_immutable
  before update or delete on public.iddas_savings_source_rows
  for each row execute function public.prevent_iddas_savings_source_mutation();

create table public.iddas_savings_reconciliations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  staging_row_id uuid not null unique references public.import_staging_rows(id) on delete cascade,
  source_external_key text not null unique,
  client_id uuid references public.clients(id) on delete restrict,
  redemption_id uuid unique references public.redemptions(id) on delete restrict,
  match_method text,
  status text not null default 'pending',
  issue_code text,
  safe_reason text,
  decision_reason text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iddas_savings_match_method_valid check (match_method is null or match_method in ('legacy_id','approved_alias','exact_unique_name','admin_confirmation','existing_import')),
  constraint iddas_savings_reconciliation_status_valid check (status in ('pending','ready','committed','conflict'))
);
create index iddas_savings_reconciliation_batch_idx on public.iddas_savings_reconciliations(batch_id,status);
alter table public.iddas_savings_reconciliations enable row level security;
alter table public.iddas_savings_reconciliations force row level security;
revoke all on public.iddas_savings_reconciliations from public,anon,authenticated;
grant all on public.iddas_savings_reconciliations to service_role;

create or replace function public.require_iddas_savings_super_admin()
returns uuid language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not exists(
    select 1 from public.staff_members sm
    where sm.user_id=actor and sm.active and sm.role='super_admin'
  ) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  return actor;
end; $$;

create or replace function public.resolve_iddas_savings_client(p_legacy_person_id bigint,p_legacy_name text)
returns table(resolved_client_id uuid,resolved_match_method text,resolved_issue_code text,resolved_reason text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare candidate uuid; candidate_count integer; alias_target text;
begin
  if p_legacy_person_id=10178 then
    return query select null::uuid,null::text,'SPECIAL_ALESSANDRA_ANTIGO'::text,'Alessandra (Antigo) exige seleção administrativa explícita.'::text;
    return;
  end if;
  if public.normalize_iddas_savings_name(p_legacy_name)=public.normalize_iddas_savings_name('Hamilton Antônio Figueiredo') then
    return query select null::uuid,null::text,'SPECIAL_HAMILTON'::text,'Hamilton não possui identificador legado comprovado.'::text;
    return;
  end if;
  if public.normalize_iddas_savings_name(p_legacy_name)='michael' then
    return query select null::uuid,null::text,'SPECIAL_MICHAEL'::text,'Michael exige confirmação administrativa explícita; o usuário administrador nunca é inferido.'::text;
    return;
  end if;

  if p_legacy_person_id is not null then
    select count(distinct esm.local_entity_id),min(esm.local_entity_id)
      into candidate_count,candidate
      from public.external_source_map esm
     where esm.source_system='iddas_html'
       and esm.source_database_id='iddas_html_saldos_20260721_v1'
       and esm.source_page_id=md5('iddas-person:'||p_legacy_person_id::text)
       and esm.entity_type='client';
    if candidate_count=1 then
      return query select candidate,'legacy_id'::text,null::text,null::text;
      return;
    elsif candidate_count>1 then
      return query select null::uuid,null::text,'AMBIGUOUS_LEGACY_ID'::text,'O ID legado possui mais de um vínculo e exige revisão.'::text;
      return;
    end if;
  end if;

  alias_target:=case public.normalize_iddas_savings_name(p_legacy_name)
    when public.normalize_iddas_savings_name('Alessandra Duarte Martins') then 'Alessandra Martins'
    when public.normalize_iddas_savings_name('Beatriz Menezes Martins Cordeiro') then 'Beatriz Cordeiro'
    when public.normalize_iddas_savings_name('Fábio Izaias Martins de lima') then 'Fábio Izaías'
    when public.normalize_iddas_savings_name('Jessica Veloso Machado') then 'Jéssica Veloso'
    when public.normalize_iddas_savings_name('Leonardo José de Sousa Lima') then 'Leonardo Lima'
    else null end;
  if alias_target is not null then
    select count(*),min(c.id) into candidate_count,candidate
      from public.clients c
     where public.normalize_iddas_savings_name(c.full_name)=public.normalize_iddas_savings_name(alias_target);
    if candidate_count=1 then
      return query select candidate,'approved_alias'::text,null::text,null::text;
      return;
    end if;
    return query select null::uuid,null::text,'ALIAS_TARGET_NOT_UNIQUE'::text,'O alias aprovado não encontrou um único cadastro atual.'::text;
    return;
  end if;

  select count(*),min(c.id) into candidate_count,candidate
    from public.clients c
   where public.normalize_iddas_savings_name(c.full_name)=public.normalize_iddas_savings_name(p_legacy_name);
  if candidate_count=1 then
    return query select candidate,'exact_unique_name'::text,null::text,null::text;
  elsif candidate_count>1 then
    return query select null::uuid,null::text,'AMBIGUOUS_EXACT_NAME'::text,'Mais de um cadastro possui o mesmo nome completo normalizado.'::text;
  else
    return query select null::uuid,null::text,'UNRESOLVED_CLIENT'::text,'Nenhum cadastro possui ID legado ou nome completo exato e único.'::text;
  end if;
end; $$;

create or replace function public.get_admin_iddas_savings_import()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare batch_row public.import_batches%rowtype;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into batch_row from public.import_batches where source_key='iddas_economias_20260722_v1';
  return jsonb_build_object(
    'batch',case when batch_row.id is null then null else jsonb_build_object('batchId',batch_row.id,'status',batch_row.status,'createdAt',batch_row.created_at,'finishedAt',batch_row.finished_at,'summary',batch_row.dry_run_summary) end,
    'sourceSummary',jsonb_build_object(
      'rows',(select count(*) from public.iddas_savings_source_rows),
      'people',(select count(distinct coalesce(legacy_person_id::text,public.normalize_iddas_savings_name(legacy_name))) from public.iddas_savings_source_rows),
      'originalValue',(select coalesce(sum(original_value_brl),0) from public.iddas_savings_source_rows),
      'paidValue',(select coalesce(sum(paid_value_brl),0) from public.iddas_savings_source_rows),
      'savingsValue',(select coalesce(sum(verified_savings_value_brl),0) from public.iddas_savings_source_rows),
      'zeroSavings',(select count(*) from public.iddas_savings_source_rows where verified_savings_value_brl=0)
    ),
    'counts',jsonb_build_object(
      'ready',(select count(*) from public.iddas_savings_reconciliations where batch_id=batch_row.id and status='ready'),
      'committed',(select count(*) from public.iddas_savings_reconciliations where batch_id=batch_row.id and status='committed'),
      'pending',(select count(*) from public.iddas_savings_reconciliations where batch_id=batch_row.id and status='pending'),
      'conflict',(select count(*) from public.iddas_savings_reconciliations where batch_id=batch_row.id and status='conflict')
    ),
    'appliedSummary',coalesce((
      select jsonb_build_object('rows',count(*),'originalValue',coalesce(sum(s.original_value_brl),0),'paidValue',coalesce(sum(s.paid_value_brl),0),'savingsValue',coalesce(sum(r.savings_amount),0))
      from public.iddas_savings_reconciliations ir
      join public.iddas_savings_source_rows s on s.source_external_key=ir.source_external_key
      join public.redemptions r on r.id=ir.redemption_id and r.status='confirmed'
      where ir.batch_id=batch_row.id and ir.status='committed'
    ),jsonb_build_object('rows',0,'originalValue',0,'paidValue',0,'savingsValue',0)),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'rowId',sr.id,'sourceRowNumber',s.row_number,'legacyPersonId',s.legacy_person_id,'legacyName',s.legacy_name,
        'eventDate',s.event_date,'description',s.description,'originalValue',s.original_value_brl,'paidValue',s.paid_value_brl,
        'savingsValue',s.verified_savings_value_brl,'externalKey',s.source_external_key,
        'clientId',ir.client_id,'clientName',c.full_name,'clientStatus',c.status,'matchMethod',ir.match_method,
        'status',ir.status,'issueCode',ir.issue_code,'reason',ir.safe_reason,'decisionReason',ir.decision_reason,
        'redemptionId',ir.redemption_id,'migrated',ir.status='committed'
      ) order by s.row_number)
      from public.iddas_savings_source_rows s
      left join public.iddas_savings_reconciliations ir on ir.source_external_key=s.source_external_key and ir.batch_id=batch_row.id
      left join public.import_staging_rows sr on sr.id=ir.staging_row_id
      left join public.clients c on c.id=ir.client_id
    ),'[]'::jsonb),
    'clientOptions',coalesce((select jsonb_agg(jsonb_build_object('clientId',c.id,'fullName',c.full_name,'status',c.status) order by c.full_name,c.id) from public.clients c),'[]'::jsonb),
    'canManage',exists(select 1 from public.staff_members sm where sm.user_id=auth.uid() and sm.active and sm.role='super_admin')
  );
end; $$;

create or replace function public.admin_prepare_iddas_savings_import()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.require_iddas_savings_super_admin(); batch_row public.import_batches%rowtype; file_id uuid; src public.iddas_savings_source_rows%rowtype;
  staging_id uuid; resolved_client uuid; match_method text; issue_code text; safe_reason text; rec_status text; stage_status text; validation text;
  existing_redemption uuid; existing_client uuid; existing_hash text;
begin
  if (select count(*) from public.iddas_savings_source_rows)<>68
     or (select sum(original_value_brl) from public.iddas_savings_source_rows)<>251347.13
     or (select sum(paid_value_brl) from public.iddas_savings_source_rows)<>120942.28
     or (select sum(verified_savings_value_brl) from public.iddas_savings_source_rows)<>130404.85
     or exists(select 1 from public.iddas_savings_source_rows where abs(round(original_value_brl-paid_value_brl,2)-verified_savings_value_brl)>0.01) then
    raise exception 'SOURCE_MANIFEST_INVALID' using errcode='23514';
  end if;

  insert into public.import_batches(status,source_system,adapter_version,original_filename,upload_size_bytes,mime_type,storage_path,checksum_sha256,created_by,started_at,uploaded_at,source_key,dry_run_summary)
  values('review','iddas','iddas_savings_v1','IDDAS_ECONOMIAS_LEGADO_20260722.csv',7539,'text/csv','canonical/iddas_economias_20260722_v1.csv','b411c41d11437e579fbc2b97c6e5ffdfd29c753d93e8a5823e14c4a76b3b56f2',actor,clock_timestamp(),clock_timestamp(),'iddas_economias_20260722_v1','{}'::jsonb)
  on conflict(source_key) where source_key is not null do update set source_key=excluded.source_key
  returning * into batch_row;

  insert into public.import_files(batch_id,logical_type,path,checksum_sha256,row_count,detected_encoding,delimiter,is_canonical)
  values(batch_row.id,'saving','IDDAS_ECONOMIAS_LEGADO_20260722.csv','b411c41d11437e579fbc2b97c6e5ffdfd29c753d93e8a5823e14c4a76b3b56f2',68,'utf-8',';',true)
  on conflict(batch_id,path) do update set row_count=excluded.row_count
  returning id into file_id;

  for src in select * from public.iddas_savings_source_rows order by row_number loop
    resolved_client:=null;match_method:=null;issue_code:=null;safe_reason:=null;existing_redemption:=null;existing_client:=null;existing_hash:=null;
    select r.id,r.client_id,r.source_payload_hash into existing_redemption,existing_client,existing_hash
      from public.redemptions r where r.source_system='iddas' and r.source_external_key=src.source_external_key;
    if existing_redemption is not null then
      resolved_client:=existing_client;match_method:='existing_import';
      if existing_hash=src.source_payload_hash then rec_status:='committed';stage_status:='committed';validation:='valid';
      else rec_status:='conflict';stage_status:='blocked_invalid';validation:='invalid';issue_code:='SOURCE_HASH_CONFLICT';safe_reason:='A chave externa já existe com hash diferente; nenhuma edição foi sobrescrita.'; end if;
    else
      select x.resolved_client_id,x.resolved_match_method,x.resolved_issue_code,x.resolved_reason
        into resolved_client,match_method,issue_code,safe_reason
        from public.resolve_iddas_savings_client(src.legacy_person_id,src.legacy_name) x;
      if resolved_client is null then rec_status:='pending';stage_status:='pending_decision';validation:='warning';
      else rec_status:='ready';stage_status:='ready_create';validation:='valid'; end if;
    end if;

    insert into public.import_staging_rows(batch_id,file_id,row_number,entity_type,source_external_id,raw_payload,normalized_payload,validation_status,resolution_status,target_id,row_hash,blocks_commit,suggested_action)
    values(batch_row.id,file_id,src.row_number,'saving',src.source_external_key,
      jsonb_build_object('legacyPersonId',src.legacy_person_id,'legacyName',src.legacy_name,'eventDate',src.event_date,'description',src.description,'originalValue',src.original_value_brl,'paidValue',src.paid_value_brl,'savingsValue',src.verified_savings_value_brl,'legacySequence',src.legacy_sequence),
      jsonb_build_object('clientId',resolved_client,'eventDate',src.event_date,'description',src.description,'originalValue',src.original_value_brl,'paidValue',src.paid_value_brl,'savingsValue',src.verified_savings_value_brl),
      validation,stage_status,case when existing_redemption is not null then existing_redemption else resolved_client end,src.source_payload_hash,false,
      case rec_status when 'ready' then 'import_saving' when 'committed' then 'already_imported' when 'conflict' then 'review_conflict' else 'select_client' end)
    on conflict(batch_id,file_id,row_number) do update set row_hash=public.import_staging_rows.row_hash
    returning id into staging_id;

    insert into public.iddas_savings_reconciliations(batch_id,staging_row_id,source_external_key,client_id,redemption_id,match_method,status,issue_code,safe_reason,committed_at)
    values(batch_row.id,staging_id,src.source_external_key,resolved_client,existing_redemption,match_method,rec_status,issue_code,safe_reason,case when rec_status='committed' then clock_timestamp() else null end)
    on conflict(staging_row_id) do nothing;
    if issue_code is not null and not exists(select 1 from public.import_row_issues i where i.staging_row_id=staging_id and i.stable_code=issue_code) then
      insert into public.import_row_issues(staging_row_id,severity,stable_code,safe_message,resolution)
      values(staging_id,case when rec_status='conflict' then 'error' else 'warning' end,issue_code,safe_reason,jsonb_build_object('action',case when rec_status='conflict' then 'inspect_source_hash' else 'select_client' end));
    end if;
  end loop;

  update public.import_batches b set dry_run_summary=b.dry_run_summary||jsonb_build_object('source',jsonb_build_object('rows',68,'originalValue',251347.13,'paidValue',120942.28,'savingsValue',130404.85),'preparedAt',clock_timestamp()) where b.id=batch_row.id;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data)
  values(actor,'prepare_iddas_savings_import','import_batches',batch_row.id::text,jsonb_build_object('sourceKey','iddas_economias_20260722_v1','rows',68));
  return jsonb_build_object('batchId',batch_row.id,'prepared',true,'preview',public.get_admin_iddas_savings_import());
end; $$;

create or replace function public.admin_resolve_iddas_savings_row(p_row_id uuid,p_client_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.require_iddas_savings_super_admin(); rec public.iddas_savings_reconciliations%rowtype;
begin
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'DECISION_REASON_REQUIRED' using errcode='22023'; end if;
  if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  select ir.* into rec from public.iddas_savings_reconciliations ir where ir.staging_row_id=p_row_id for update;
  if rec.id is null then raise exception 'ROW_NOT_FOUND' using errcode='P0002'; end if;
  if rec.status<>'pending' then raise exception 'ROW_NOT_PENDING' using errcode='55000'; end if;
  update public.iddas_savings_reconciliations set client_id=p_client_id,match_method='admin_confirmation',status='ready',issue_code=null,safe_reason=null,decision_reason=trim(p_reason),resolved_by=actor,resolved_at=clock_timestamp(),updated_at=clock_timestamp() where id=rec.id;
  update public.import_staging_rows set target_id=p_client_id,resolution_status='ready_create',validation_status='valid',suggested_action='import_saving',chosen_action='admin_confirmation',resolution_reason=trim(p_reason),blocks_commit=false where id=p_row_id;
  update public.import_row_issues
     set resolution=jsonb_build_object('resolved',true,'clientId',p_client_id,'resolvedAt',clock_timestamp())
   where staging_row_id=p_row_id
     and (stable_code like 'SPECIAL_%' or stable_code in ('UNRESOLVED_CLIENT','AMBIGUOUS_EXACT_NAME','ALIAS_TARGET_NOT_UNIQUE','AMBIGUOUS_LEGACY_ID'));
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data) values(actor,p_client_id,'resolve_iddas_saving_client','iddas_savings_reconciliations',rec.id::text,jsonb_build_object('rowId',p_row_id,'reasonProvided',true));
  return jsonb_build_object('rowId',p_row_id,'clientId',p_client_id,'status','ready');
end; $$;

create or replace function public.admin_commit_iddas_savings_import(p_batch_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.require_iddas_savings_super_admin(); batch_row public.import_batches%rowtype; rec record; source_row public.iddas_savings_source_rows%rowtype;
  existing_id uuid; existing_hash text; inserted_id uuid; new_records integer:=0; row_conflicts integer:=0;
  applied_count integer; pending_count integer; conflict_count integer; applied_original numeric; applied_paid numeric; applied_savings numeric;
begin
  if p_confirmation<>'iddas_economias_20260722_v1' then raise exception 'CONFIRMATION_REQUIRED' using errcode='22023'; end if;
  select * into batch_row from public.import_batches where id=p_batch_id and source_key='iddas_economias_20260722_v1' for update;
  if batch_row.id is null then raise exception 'BATCH_NOT_FOUND' using errcode='P0002'; end if;

  for rec in
    select ir.*,sr.id as source_staging_id
      from public.iddas_savings_reconciliations ir
      join public.import_staging_rows sr on sr.id=ir.staging_row_id
     where ir.batch_id=p_batch_id and ir.status='ready'
     order by sr.row_number for update of ir
  loop
    begin
      select * into source_row from public.iddas_savings_source_rows where source_external_key=rec.source_external_key;
      if source_row.row_number is null or abs(round(source_row.original_value_brl-source_row.paid_value_brl,2)-source_row.verified_savings_value_brl)>0.01 then
        raise exception 'SOURCE_FORMULA_MISMATCH' using errcode='23514';
      end if;
      if rec.client_id is null or not exists(select 1 from public.clients where id=rec.client_id) then
        raise exception 'CLIENT_NOT_FOUND' using errcode='P0002';
      end if;

      existing_id:=null;existing_hash:=null;
      select r.id,r.source_payload_hash into existing_id,existing_hash
        from public.redemptions r where r.source_system='iddas' and r.source_external_key=source_row.source_external_key;
      if existing_id is not null then
        if existing_hash<>source_row.source_payload_hash then raise exception 'SOURCE_HASH_CONFLICT' using errcode='23505'; end if;
        inserted_id:=existing_id;
      else
        insert into public.redemptions(
          client_id,redemption_type,description,issued_at,cash_reference_total,taxes_paid,additional_cash_paid,attributed_points_cost,
          formula_version,reference_captured_at,status,notes,created_by,payment_mode,launched_on,operation_id,
          source_system,source_batch_key,source_external_key,source_legacy_person_id,source_payload_hash,import_batch_id,imported_at
        ) values(
          rec.client_id,public.iddas_savings_redemption_type(source_row.description),source_row.description,
          (source_row.event_date::timestamp+time '12:00') at time zone 'America/Sao_Paulo',source_row.original_value_brl,0,source_row.paid_value_brl,0,
          'legacy-iddas-direct-cost-v1',(source_row.event_date::timestamp+time '12:00') at time zone 'America/Sao_Paulo','confirmed',
          'Registro migrado do histórico de economias do Iddas.',actor,'cash',source_row.event_date,public.iddas_savings_operation_uuid(source_row.source_external_key),
          'iddas','iddas_economias_20260722_v1',source_row.source_external_key,source_row.legacy_person_id,source_row.source_payload_hash,p_batch_id,clock_timestamp()
        ) returning id into inserted_id;
        new_records:=new_records+1;
      end if;
      update public.iddas_savings_reconciliations set redemption_id=inserted_id,status='committed',committed_at=coalesce(committed_at,clock_timestamp()),updated_at=clock_timestamp() where id=rec.id;
      update public.import_staging_rows set target_id=inserted_id,resolution_status='committed',committed_at=coalesce(committed_at,clock_timestamp()),commit_error_code=null where id=rec.staging_row_id;
    exception when others then
      row_conflicts:=row_conflicts+1;
      update public.iddas_savings_reconciliations set status='conflict',issue_code=case when sqlerrm like '%SOURCE_HASH_CONFLICT%' then 'SOURCE_HASH_CONFLICT' else 'COMMIT_ROW_FAILED' end,safe_reason=case when sqlerrm like '%SOURCE_HASH_CONFLICT%' then 'A chave externa já existe com hash diferente; nenhuma edição foi sobrescrita.' else 'A linha falhou isoladamente e exige revisão administrativa.' end,updated_at=clock_timestamp() where id=rec.id;
      update public.import_staging_rows set validation_status='invalid',resolution_status='failed_commit',commit_error_code=case when sqlerrm like '%SOURCE_HASH_CONFLICT%' then 'SOURCE_HASH_CONFLICT' else 'COMMIT_ROW_FAILED' end,blocks_commit=false where id=rec.staging_row_id;
    end;
  end loop;

  select count(*) filter(where status='committed'),count(*) filter(where status='pending'),count(*) filter(where status='conflict')
    into applied_count,pending_count,conflict_count from public.iddas_savings_reconciliations where batch_id=p_batch_id;
  select coalesce(sum(s.original_value_brl),0),coalesce(sum(s.paid_value_brl),0),coalesce(sum(s.verified_savings_value_brl),0)
    into applied_original,applied_paid,applied_savings
    from public.iddas_savings_reconciliations ir join public.iddas_savings_source_rows s on s.source_external_key=ir.source_external_key
   where ir.batch_id=p_batch_id and ir.status='committed';

  update public.import_batches b set
    status=case when pending_count=0 and conflict_count=0 then 'committed' else 'review' end,
    confirmed_at=coalesce(confirmed_at,clock_timestamp()),confirmed_by=actor,
    finished_at=case when pending_count=0 and conflict_count=0 then coalesce(finished_at,clock_timestamp()) else null end,
    dry_run_summary=b.dry_run_summary||jsonb_build_object('committed',jsonb_build_object('applied',applied_count,'newRecords',new_records,'alreadyExisting',applied_count-new_records,'pending',pending_count,'conflicts',conflict_count,'originalValue',applied_original,'paidValue',applied_paid,'savingsValue',applied_savings,'lastRunAt',clock_timestamp()))
  where b.id=p_batch_id;
  insert into public.audit_logs(actor_user_id,action,table_name,record_id,new_data)
  values(actor,'commit_iddas_savings_import','import_batches',p_batch_id::text,jsonb_build_object('newRecords',new_records,'alreadyExisting',applied_count-new_records,'pending',pending_count,'conflicts',conflict_count,'sourceRows',68));
  return jsonb_build_object('batchId',p_batch_id,'applied',applied_count,'newRecords',new_records,'alreadyExisting',applied_count-new_records,'pending',pending_count,'conflicts',conflict_count,'rowConflictsThisRun',row_conflicts,'totals',jsonb_build_object('originalValue',applied_original,'paidValue',applied_paid,'savingsValue',applied_savings));
end; $$;

create or replace function public.admin_update_travel_saving(
  p_redemption_id uuid,p_launched_on date,p_travel_type public.redemption_type,p_details text,
  p_original_value numeric,p_paid_value numeric,p_reason text,p_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); before_row public.redemptions%rowtype; after_row public.redemptions%rowtype;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_launched_on is null or p_launched_on>current_date then raise exception 'INVALID_DATE' using errcode='22007'; end if;
  if length(trim(coalesce(p_details,'')))<3 then raise exception 'DETAILS_REQUIRED' using errcode='22023'; end if;
  if p_original_value<0 or p_paid_value<0 then raise exception 'INVALID_VALUES' using errcode='22003'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'CHANGE_REASON_REQUIRED' using errcode='22023'; end if;
  select * into before_row from public.redemptions where id=p_redemption_id for update;
  if before_row.id is null or before_row.payment_mode<>'cash' or before_row.travel_points_used is not null then raise exception 'SAVING_NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_updated_at is not null and before_row.updated_at<>p_expected_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
  update public.redemptions set redemption_type=p_travel_type,description=trim(p_details),issued_at=(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo',launched_on=p_launched_on,cash_reference_total=round(p_original_value,2),taxes_paid=0,additional_cash_paid=round(p_paid_value,2),attributed_points_cost=0,reference_captured_at=(p_launched_on::timestamp+time '12:00') at time zone 'America/Sao_Paulo',updated_at=clock_timestamp() where id=p_redemption_id returning * into after_row;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,after_row.client_id,'update_travel_saving','redemptions',after_row.id::text,
    jsonb_build_object('launchedOn',before_row.launched_on,'travelType',before_row.redemption_type,'details',before_row.description,'originalValue',before_row.cash_reference_total,'paidValue',before_row.effective_cost,'savingsValue',before_row.savings_amount),
    jsonb_build_object('launchedOn',after_row.launched_on,'travelType',after_row.redemption_type,'details',after_row.description,'originalValue',after_row.cash_reference_total,'paidValue',after_row.effective_cost,'savingsValue',after_row.savings_amount,'reason',trim(p_reason),'sourceMetadataPreserved',before_row.source_external_key is not null));
  return jsonb_build_object('redemptionId',after_row.id,'savingsAmount',after_row.savings_amount,'updatedAt',after_row.updated_at);
end; $$;

create or replace function public.admin_cancel_travel_saving(p_redemption_id uuid,p_reason text,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); before_row public.redemptions%rowtype; after_row public.redemptions%rowtype;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'CANCEL_REASON_REQUIRED' using errcode='22023'; end if;
  select * into before_row from public.redemptions where id=p_redemption_id for update;
  if before_row.id is null or before_row.payment_mode<>'cash' or before_row.travel_points_used is not null then raise exception 'SAVING_NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_updated_at is not null and before_row.updated_at<>p_expected_updated_at then raise exception 'CONCURRENT_EDIT' using errcode='40001'; end if;
  if before_row.status='cancelled' then return jsonb_build_object('redemptionId',before_row.id,'status','cancelled','idempotentReplay',true); end if;
  update public.redemptions set status='cancelled',updated_at=clock_timestamp(),notes=concat_ws(E'\n',notes,'Cancelado administrativamente: '||trim(p_reason)) where id=p_redemption_id returning * into after_row;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,after_row.client_id,'cancel_travel_saving','redemptions',after_row.id::text,jsonb_build_object('status',before_row.status,'savingsValue',before_row.savings_amount),jsonb_build_object('status','cancelled','reason',trim(p_reason),'sourceMetadataPreserved',before_row.source_external_key is not null));
  return jsonb_build_object('redemptionId',after_row.id,'status','cancelled','idempotentReplay',false);
end; $$;

create or replace function public.get_travel_sales(p_client_id uuid default null,p_start_date date default null,p_end_date date default null,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if p_end_date is not null and p_start_date is not null and p_end_date<p_start_date then raise exception 'Período inválido' using errcode='22007'; end if;
  return (with filtered as materialized(
    select r.*,c.full_name,lp.name program_name from public.redemptions r join public.clients c on c.id=r.client_id
    left join public.program_accounts pa on pa.id=r.travel_account_id left join public.loyalty_programs lp on lp.id=pa.program_id
    where r.payment_mode is not null and r.status='confirmed' and (p_client_id is null or r.client_id=p_client_id)
      and (p_start_date is null or r.launched_on>=p_start_date) and (p_end_date is null or r.launched_on<=p_end_date)
  ),paged as(select * from filtered order by launched_on desc,created_at desc limit safe_limit offset safe_offset),ranking as(
    select client_id,full_name,sum(savings_amount) total_savings,count(*) records,row_number() over(order by sum(savings_amount) desc,full_name,client_id) position
    from filtered group by client_id,full_name
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'clientId',p.client_id,'clientName',p.full_name,'launchedOn',p.launched_on,'paymentMode',p.payment_mode,'travelType',p.redemption_type,'details',p.description,'originalValue',p.cash_reference_total,'paidValue',p.effective_cost,'savingsAmount',p.savings_amount,'programName',p.program_name,'pointsUsed',p.travel_points_used,'sourceSystem',p.source_system,'sourceBatchKey',p.source_batch_key,'migrated',p.source_system='iddas','updatedAt',p.updated_at) order by p.launched_on desc,p.created_at desc) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered),'totalSavings',coalesce((select sum(savings_amount) from filtered),0),'limit',safe_limit,'offset',safe_offset,
    'ranking',coalesce((select jsonb_agg(jsonb_build_object('position',r.position,'clientId',r.client_id,'clientName',r.full_name,'totalSavings',r.total_savings,'records',r.records) order by r.position) from ranking r),'[]'::jsonb),
    'pendingReconciliation',(select count(*) from public.iddas_savings_reconciliations where status in ('pending','conflict')),
    'canWrite',public.can_write_client_data()
  ));
end; $$;

create or replace function public.build_public_client_savings_history(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'date',r.launched_on,'description',r.description,'originalValue',r.cash_reference_total,'paidValue',r.effective_cost,'savingsValue',r.savings_amount,'travelType',r.redemption_type,'migrated',r.source_system='iddas') order by r.launched_on desc,r.created_at desc),'[]'::jsonb)
  from public.redemptions r join public.clients c on c.id=r.client_id
  where r.client_id=p_client_id and c.status='active' and r.status='confirmed';
$$;

create or replace function public.get_admin_client_dashboard_preview(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return public.build_public_client_dashboard_payload(p_client_id)||jsonb_build_object('savingsHistory',public.build_public_client_savings_history(p_client_id));
end; $$;

revoke all on function public.require_iddas_savings_super_admin(),public.resolve_iddas_savings_client(bigint,text),public.get_admin_iddas_savings_import(),public.admin_prepare_iddas_savings_import(),public.admin_resolve_iddas_savings_row(uuid,uuid,text),public.admin_commit_iddas_savings_import(uuid,text),public.admin_update_travel_saving(uuid,date,public.redemption_type,text,numeric,numeric,text,timestamptz),public.admin_cancel_travel_saving(uuid,text,timestamptz),public.build_public_client_savings_history(uuid) from public,anon;
grant execute on function public.get_admin_iddas_savings_import(),public.admin_prepare_iddas_savings_import(),public.admin_resolve_iddas_savings_row(uuid,uuid,text),public.admin_commit_iddas_savings_import(uuid,text),public.admin_update_travel_saving(uuid,date,public.redemption_type,text,numeric,numeric,text,timestamptz),public.admin_cancel_travel_saving(uuid,text,timestamptz) to authenticated;
grant execute on function public.build_public_client_savings_history(uuid) to service_role;

notify pgrst,'reload schema';
commit;
