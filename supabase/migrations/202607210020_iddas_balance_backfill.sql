begin;

-- PATCH MRL 20260721-020
-- Lote contábil reproduzível para os saldos auditados no HTML do Iddas.
-- O lote usa o ledger oficial e nunca cria, renomeia ou altera o status de clientes.

alter table public.import_batches
  add column if not exists source_key text;

create unique index if not exists import_batches_source_key_unique
  on public.import_batches(source_key)
  where source_key is not null;

alter table public.import_balance_reconciliations
  add column if not exists source_book_value numeric(16,2);

alter table public.balance_snapshots
  add column if not exists source_book_value numeric(16,2),
  add constraint balance_snapshots_source_book_value_nonnegative check (source_book_value is null or source_book_value >= 0);

alter table public.balance_snapshots drop column estimated_value;
alter table public.balance_snapshots add column estimated_value numeric(16,2) generated always as (
  coalesce(source_book_value,round((balance::numeric / 1000) * value_per_thousand,2))
) stored;

comment on column public.balance_snapshots.source_book_value is
  'Valor patrimonial autoritativo da fonte quando a taxa por mil arredondada não reproduz os centavos; nunca representa economia.';

create table public.iddas_balance_source_rows (
  source_key text not null,
  legacy_person_id bigint not null,
  target_client_name text not null,
  legacy_full_name text not null,
  program_slug text not null,
  points bigint not null check (points > 0),
  cost_per_thousand numeric(14,4) not null check (cost_per_thousand >= 0),
  book_value numeric(16,2) not null check (book_value >= 0),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  primary key (source_key, legacy_person_id, program_slug),
  constraint iddas_source_key_valid check (source_key = 'iddas_html_saldos_20260721_v1'),
  constraint iddas_idempotency_key_valid check (
    idempotency_key = source_key || ':' || legacy_person_id::text || ':' || program_slug
  ),
  constraint iddas_program_slug_valid check (
    program_slug in ('livelo','esfera','smiles','latam_pass','azul_fidelidade','coopera')
  )
);

alter table public.iddas_balance_source_rows enable row level security;
revoke all on public.iddas_balance_source_rows from public, anon, authenticated;
grant all on public.iddas_balance_source_rows to service_role;

comment on table public.iddas_balance_source_rows is
  'Manifesto imutável das 44 contas autorizadas pelo PATCH MRL 020; não contém CPF, e-mail, telefone ou endereço.';

insert into public.loyalty_programs(slug,name,default_value_per_thousand,active)
values ('coopera','Coopera',35.00,true)
on conflict (slug) do update set
  name=excluded.name,
  active=true,
  updated_at=clock_timestamp();

insert into public.iddas_balance_source_rows(
  source_key,legacy_person_id,target_client_name,legacy_full_name,program_slug,points,cost_per_thousand,book_value,idempotency_key
)
values
  ('iddas_html_saldos_20260721_v1',14829,'Amanda Araújo / Jhonnata','Amanda de Campos Araújo','livelo',153583,35.00,5375.40,'iddas_html_saldos_20260721_v1:14829:livelo'),
  ('iddas_html_saldos_20260721_v1',14829,'Amanda Araújo / Jhonnata','Amanda de Campos Araújo','smiles',128290,19.88,2549.80,'iddas_html_saldos_20260721_v1:14829:smiles'),
  ('iddas_html_saldos_20260721_v1',14829,'Amanda Araújo / Jhonnata','Amanda de Campos Araújo','coopera',114606,35.00,4011.20,'iddas_html_saldos_20260721_v1:14829:coopera'),
  ('iddas_html_saldos_20260721_v1',22287,'Uli Zarzana de Menezes','Uli Zarzana de Menezes','smiles',9196,20.00,183.92,'iddas_html_saldos_20260721_v1:22287:smiles'),
  ('iddas_html_saldos_20260721_v1',22287,'Uli Zarzana de Menezes','Uli Zarzana de Menezes','latam_pass',89961,26.78,2408.95,'iddas_html_saldos_20260721_v1:22287:latam_pass'),
  ('iddas_html_saldos_20260721_v1',22287,'Uli Zarzana de Menezes','Uli Zarzana de Menezes','azul_fidelidade',62610,20.00,1252.20,'iddas_html_saldos_20260721_v1:22287:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',22872,'Renata Martins Migotto','Renata Martins Migotto','smiles',167,17.01,2.84,'iddas_html_saldos_20260721_v1:22872:smiles'),
  ('iddas_html_saldos_20260721_v1',22872,'Renata Martins Migotto','Renata Martins Migotto','azul_fidelidade',84220,20.00,1684.40,'iddas_html_saldos_20260721_v1:22872:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',8250,'Fábio Izaías','Fábio Izaias Martins de lima','livelo',642,35.00,22.47,'iddas_html_saldos_20260721_v1:8250:livelo'),
  ('iddas_html_saldos_20260721_v1',8250,'Fábio Izaías','Fábio Izaias Martins de lima','latam_pass',89140,26.27,2341.90,'iddas_html_saldos_20260721_v1:8250:latam_pass'),
  ('iddas_html_saldos_20260721_v1',8250,'Fábio Izaías','Fábio Izaias Martins de lima','coopera',143699,30.00,4311.11,'iddas_html_saldos_20260721_v1:8250:coopera'),
  ('iddas_html_saldos_20260721_v1',22694,'Alessandra Martins','Alessandra Duarte Martins','livelo',26,20.37,0.53,'iddas_html_saldos_20260721_v1:22694:livelo'),
  ('iddas_html_saldos_20260721_v1',22694,'Alessandra Martins','Alessandra Duarte Martins','esfera',5307,35.00,185.75,'iddas_html_saldos_20260721_v1:22694:esfera'),
  ('iddas_html_saldos_20260721_v1',22694,'Alessandra Martins','Alessandra Duarte Martins','latam_pass',24597,27.00,664.12,'iddas_html_saldos_20260721_v1:22694:latam_pass'),
  ('iddas_html_saldos_20260721_v1',22694,'Alessandra Martins','Alessandra Duarte Martins','azul_fidelidade',382095,16.30,6229.28,'iddas_html_saldos_20260721_v1:22694:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',15744,'Beatriz Cordeiro','Beatriz Menezes Martins Cordeiro','livelo',16686,28.83,481.13,'iddas_html_saldos_20260721_v1:15744:livelo'),
  ('iddas_html_saldos_20260721_v1',15744,'Beatriz Cordeiro','Beatriz Menezes Martins Cordeiro','smiles',612454,2.91,1783.35,'iddas_html_saldos_20260721_v1:15744:smiles'),
  ('iddas_html_saldos_20260721_v1',15744,'Beatriz Cordeiro','Beatriz Menezes Martins Cordeiro','latam_pass',13710,27.00,370.17,'iddas_html_saldos_20260721_v1:15744:latam_pass'),
  ('iddas_html_saldos_20260721_v1',15744,'Beatriz Cordeiro','Beatriz Menezes Martins Cordeiro','azul_fidelidade',2745,17.00,46.66,'iddas_html_saldos_20260721_v1:15744:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',10868,'Sara Menezes Araujo Valadares','Sara Menezes Araujo Valadares','livelo',11068,35.00,387.39,'iddas_html_saldos_20260721_v1:10868:livelo'),
  ('iddas_html_saldos_20260721_v1',10868,'Sara Menezes Araujo Valadares','Sara Menezes Araujo Valadares','smiles',7400,1.89,14.00,'iddas_html_saldos_20260721_v1:10868:smiles'),
  ('iddas_html_saldos_20260721_v1',10868,'Sara Menezes Araujo Valadares','Sara Menezes Araujo Valadares','azul_fidelidade',215704,21.07,4543.89,'iddas_html_saldos_20260721_v1:10868:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',10868,'Sara Menezes Araujo Valadares','Sara Menezes Araujo Valadares','coopera',15776,35.00,552.15,'iddas_html_saldos_20260721_v1:10868:coopera'),
  ('iddas_html_saldos_20260721_v1',18179,'José Roberto da Silva','José Roberto da Silva','livelo',500,35.00,17.50,'iddas_html_saldos_20260721_v1:18179:livelo'),
  ('iddas_html_saldos_20260721_v1',18179,'José Roberto da Silva','José Roberto da Silva','smiles',95236,16.02,1525.60,'iddas_html_saldos_20260721_v1:18179:smiles'),
  ('iddas_html_saldos_20260721_v1',18179,'José Roberto da Silva','José Roberto da Silva','latam_pass',264883,26.19,6938.50,'iddas_html_saldos_20260721_v1:18179:latam_pass'),
  ('iddas_html_saldos_20260721_v1',18179,'José Roberto da Silva','José Roberto da Silva','azul_fidelidade',152749,18.29,2793.76,'iddas_html_saldos_20260721_v1:18179:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',13771,'Francelle Almeida Arêdes','Francelle Almeida Arêdes','livelo',48000,35.00,1680.00,'iddas_html_saldos_20260721_v1:13771:livelo'),
  ('iddas_html_saldos_20260721_v1',13771,'Francelle Almeida Arêdes','Francelle Almeida Arêdes','esfera',6,35.00,0.21,'iddas_html_saldos_20260721_v1:13771:esfera'),
  ('iddas_html_saldos_20260721_v1',13771,'Francelle Almeida Arêdes','Francelle Almeida Arêdes','latam_pass',3705,26.18,96.99,'iddas_html_saldos_20260721_v1:13771:latam_pass'),
  ('iddas_html_saldos_20260721_v1',12334,'Diego Souza Barbosa','Diego Souza Barbosa','livelo',12609,35.00,441.32,'iddas_html_saldos_20260721_v1:12334:livelo'),
  ('iddas_html_saldos_20260721_v1',12334,'Diego Souza Barbosa','Diego Souza Barbosa','esfera',4391,35.00,153.68,'iddas_html_saldos_20260721_v1:12334:esfera'),
  ('iddas_html_saldos_20260721_v1',12334,'Diego Souza Barbosa','Diego Souza Barbosa','smiles',145074,20.00,2901.48,'iddas_html_saldos_20260721_v1:12334:smiles'),
  ('iddas_html_saldos_20260721_v1',12334,'Diego Souza Barbosa','Diego Souza Barbosa','azul_fidelidade',64882,20.67,1341.00,'iddas_html_saldos_20260721_v1:12334:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',12334,'Diego Souza Barbosa','Diego Souza Barbosa','coopera',1079,35.00,37.76,'iddas_html_saldos_20260721_v1:12334:coopera'),
  ('iddas_html_saldos_20260721_v1',12122,'Jéssica Veloso','Jessica Veloso Machado','azul_fidelidade',442,20.49,9.06,'iddas_html_saldos_20260721_v1:12122:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',35301,'Mariana Cristina da Silva Brunelli','Mariana Cristina da Silva Brunelli','livelo',1131,35.00,39.59,'iddas_html_saldos_20260721_v1:35301:livelo'),
  ('iddas_html_saldos_20260721_v1',35301,'Mariana Cristina da Silva Brunelli','Mariana Cristina da Silva Brunelli','esfera',13521,35.00,473.24,'iddas_html_saldos_20260721_v1:35301:esfera'),
  ('iddas_html_saldos_20260721_v1',35301,'Mariana Cristina da Silva Brunelli','Mariana Cristina da Silva Brunelli','azul_fidelidade',1454,20.00,29.08,'iddas_html_saldos_20260721_v1:35301:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',9485,'Leonardo Lima','Leonardo José de Sousa Lima','livelo',1,30.00,0.03,'iddas_html_saldos_20260721_v1:9485:livelo'),
  ('iddas_html_saldos_20260721_v1',9485,'Leonardo Lima','Leonardo José de Sousa Lima','smiles',7786,20.00,155.72,'iddas_html_saldos_20260721_v1:9485:smiles'),
  ('iddas_html_saldos_20260721_v1',9485,'Leonardo Lima','Leonardo José de Sousa Lima','latam_pass',3574,27.00,96.49,'iddas_html_saldos_20260721_v1:9485:latam_pass'),
  ('iddas_html_saldos_20260721_v1',9485,'Leonardo Lima','Leonardo José de Sousa Lima','azul_fidelidade',39374,20.27,798.17,'iddas_html_saldos_20260721_v1:9485:azul_fidelidade'),
  ('iddas_html_saldos_20260721_v1',9485,'Leonardo Lima','Leonardo José de Sousa Lima','coopera',35941,35.00,1257.93,'iddas_html_saldos_20260721_v1:9485:coopera')
on conflict do nothing;

do $$
declare
  v_clients integer;
  v_accounts integer;
  v_points bigint;
  v_value numeric(16,2);
begin
  select count(distinct legacy_person_id),count(*),sum(points),sum(book_value)
    into v_clients,v_accounts,v_points,v_value
  from public.iddas_balance_source_rows
  where source_key='iddas_html_saldos_20260721_v1';

  if (v_clients,v_accounts,v_points,v_value) is distinct from (13,44,3080020::bigint,60189.72::numeric) then
    raise exception 'IDDAS_SOURCE_TOTAL_MISMATCH clients=% accounts=% points=% value=%',v_clients,v_accounts,v_points,v_value;
  end if;
end $$;

create or replace function public.iddas_operation_uuid(p_idempotency_key text, p_suffix text default 'initial')
returns uuid
language sql
immutable
set search_path = pg_catalog
as $$
  select (substr(x,1,8)||'-'||substr(x,9,4)||'-'||substr(x,13,4)||'-'||substr(x,17,4)||'-'||substr(x,21,12))::uuid
  from (select md5('mrl:iddas:v1:'||p_idempotency_key||':'||p_suffix) x) s;
$$;

create or replace function public.iddas_balance_preview_payload(p_batch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with source_rows as (
    select
      s.*,
      lp.id as program_id,
      lp.name as program_name,
      matches.client_id,
      matches.client_name,
      matches.client_status,
      matches.match_count,
      pa.id as account_id,
      coalesce(latest.balance,0) as current_points,
      public.iddas_operation_uuid(s.idempotency_key,'initial') as operation_id,
      exists(
        select 1 from public.point_transactions pt
        where pt.operation_id=public.iddas_operation_uuid(s.idempotency_key,'initial')
      ) as source_transaction_exists
    from public.iddas_balance_source_rows s
    left join public.loyalty_programs lp on lp.slug=s.program_slug
    left join lateral (
      select count(*)::integer match_count,(array_agg(c.id order by c.id))[1] client_id,min(c.full_name) client_name,min(c.status::text) client_status
      from public.clients c
      where lower(trim(c.full_name))=lower(trim(s.target_client_name))
    ) matches on true
    left join public.program_accounts pa on pa.client_id=matches.client_id and pa.program_id=lp.id
    left join lateral (
      select bs.balance from public.balance_snapshots bs
      where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1
    ) latest on true
    where s.source_key='iddas_html_saldos_20260721_v1'
  ), classified as (
    select *,case
      when match_count=0 then 'client_not_found'
      when match_count>1 then 'ambiguous_client'
      when program_id is null then 'program_not_found'
      when source_transaction_exists or current_points=points then 'already_conciliated'
      when current_points=0 then 'insert'
      else 'conflict'
    end action
    from source_rows
  ), client_rollup as (
    select legacy_person_id,target_client_name,client_id,client_name,client_status,
      count(*) accounts,sum(points) points,sum(book_value) book_value,
      bool_or(action in ('client_not_found','ambiguous_client','program_not_found','conflict')) has_blocker
    from classified
    group by legacy_person_id,target_client_name,client_id,client_name,client_status
  ), program_rollup as (
    select program_slug,min(program_name) program_name,count(*) accounts,sum(points) points,sum(book_value) book_value
    from classified group by program_slug
  )
  select jsonb_build_object(
    'sourceKey','iddas_html_saldos_20260721_v1',
    'batchId',p_batch_id,
    'status',(select b.status from public.import_batches b where b.id=p_batch_id),
    'canCommit',not exists(select 1 from classified where action in ('client_not_found','ambiguous_client','program_not_found','conflict')),
    'canRollback',(select b.status='committed' from public.import_batches b where b.id=p_batch_id),
    'summary',jsonb_build_object(
      'expectedClients',13,'matchedClients',(select count(*) from client_rollup where client_id is not null),
      'expectedAccounts',44,'accounts',(select count(*) from classified),
      'points',(select sum(points) from classified),'bookValue',(select sum(book_value) from classified),
      'toInsert',(select count(*) from classified where action='insert'),
      'alreadyConciliated',(select count(*) from classified where action='already_conciliated'),
      'conflicts',(select count(*) from classified where action='conflict'),
      'notFound',(select count(*) from classified where action in ('client_not_found','ambiguous_client','program_not_found')),
      'currentPoints',(select sum(current_points) from classified)
    ),
    'clients',coalesce((select jsonb_agg(jsonb_build_object(
      'legacyPersonId',legacy_person_id,'targetName',target_client_name,'clientId',client_id,
      'systemName',client_name,'status',client_status,'accounts',accounts,'points',points,
      'bookValue',book_value,'hasBlocker',has_blocker
    ) order by target_client_name) from client_rollup),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'idempotencyKey',idempotency_key,'legacyPersonId',legacy_person_id,
      'targetName',target_client_name,'legacyName',legacy_full_name,
      'clientId',client_id,'systemName',client_name,'clientStatus',client_status,
      'programSlug',program_slug,'programName',program_name,'accountId',account_id,
      'currentPoints',current_points,'sourcePoints',points,'costPerThousand',cost_per_thousand,
      'bookValue',book_value,'action',action
    ) order by target_client_name,program_name) from classified),'[]'::jsonb),
    'expectedByProgram',(select jsonb_agg(jsonb_build_object(
      'programSlug',program_slug,'programName',program_name,'accounts',accounts,
      'points',points,'bookValue',book_value
    ) order by program_slug) from program_rollup)
  );
$$;

create or replace function public.admin_preview_iddas_balance_backfill()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid:=auth.uid();
  v_batch_id uuid;
  v_file_id uuid;
  r record;
  v_row_id uuid;
  v_client_id uuid;
  v_client_count integer;
  v_program_id uuid;
  v_account_id uuid;
  v_current bigint;
  v_operation_exists boolean;
  v_action text;
  v_resolution text;
begin
  if actor is null or not public.has_staff_role(array['super_admin'::public.app_role]) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  if (select count(*) from public.iddas_balance_source_rows where source_key='iddas_html_saldos_20260721_v1')<>44
     or (select count(distinct legacy_person_id) from public.iddas_balance_source_rows where source_key='iddas_html_saldos_20260721_v1')<>13
     or (select sum(points) from public.iddas_balance_source_rows where source_key='iddas_html_saldos_20260721_v1')<>3080020
     or (select sum(book_value) from public.iddas_balance_source_rows where source_key='iddas_html_saldos_20260721_v1')<>60189.72 then
    raise exception 'IDDAS_SOURCE_TOTAL_MISMATCH' using errcode='22000';
  end if;

  insert into public.import_batches(
    status,source_system,adapter_version,original_filename,upload_size_bytes,mime_type,
    storage_path,checksum_sha256,created_by,started_at,uploaded_at,source_key,dry_run_summary
  ) values (
    'review','iddas_html','iddas_html_v1','Iddas Milhas - Saldo.html',549310,'text/html',
    'builtin/iddas_html_saldos_20260721_v1/Iddas Milhas - Saldo.html',
    'e53c31f3a46302566d207cf6c4842a272c837764769f4fb0c7360cf71ae208c1',actor,clock_timestamp(),clock_timestamp(),
    'iddas_html_saldos_20260721_v1',
    jsonb_build_object('adapterVersion','iddas_html_v1','files',1,'canonical',jsonb_build_object('clients',13,'tasks',0,'programs',6,'onboardings',0,'passages',0),'taskRelations',jsonb_build_object('linked',0,'needsDecision',0),'conflicts',0,'invalid',0,'ignoredFilteredFiles',0,'officialBalancesCreatedByDefault',0)
  ) on conflict (source_key) where source_key is not null do update set source_key=excluded.source_key
  returning id into v_batch_id;

  insert into public.import_files(batch_id,logical_type,path,checksum_sha256,row_count,detected_encoding,is_canonical)
  values(v_batch_id,'iddas_balances','Iddas Milhas - Saldo.html','e53c31f3a46302566d207cf6c4842a272c837764769f4fb0c7360cf71ae208c1',44,'utf-8',true)
  on conflict(batch_id,path) do update set row_count=excluded.row_count,checksum_sha256=excluded.checksum_sha256,is_canonical=true
  returning id into v_file_id;

  for r in
    select s.*,row_number() over(order by s.legacy_person_id,s.program_slug)::integer row_number
    from public.iddas_balance_source_rows s
    where s.source_key='iddas_html_saldos_20260721_v1'
    order by s.legacy_person_id,s.program_slug
  loop
    select count(*)::integer,(array_agg(c.id order by c.id))[1] into v_client_count,v_client_id
    from public.clients c where lower(trim(c.full_name))=lower(trim(r.target_client_name));
    select lp.id into v_program_id from public.loyalty_programs lp where lp.slug=r.program_slug;
    v_account_id:=null; v_current:=0;
    if v_client_count=1 and v_program_id is not null then
      select pa.id into v_account_id from public.program_accounts pa where pa.client_id=v_client_id and pa.program_id=v_program_id;
      if v_account_id is not null then
        select coalesce((select bs.balance from public.balance_snapshots bs where bs.account_id=v_account_id order by bs.captured_at desc,bs.id desc limit 1),0) into v_current;
      end if;
    end if;
    select exists(select 1 from public.point_transactions pt where pt.operation_id=public.iddas_operation_uuid(r.idempotency_key,'initial')) into v_operation_exists;
    v_action:=case
      when v_client_count=0 then 'client_not_found'
      when v_client_count>1 then 'ambiguous_client'
      when v_program_id is null then 'program_not_found'
      when v_operation_exists or v_current=r.points then 'already_conciliated'
      when v_current=0 then 'insert'
      else 'conflict' end;
    v_resolution:=case when v_action='insert' then 'ready_create' when v_action='already_conciliated' then 'ready_unchanged' else 'pending_decision' end;

    insert into public.import_staging_rows(
      batch_id,file_id,row_number,entity_type,source_external_id,raw_payload,normalized_payload,
      validation_status,resolution_status,target_id,row_hash,blocks_commit,suggested_action,before_payload,resolution_reason
    ) values (
      v_batch_id,v_file_id,r.row_number,'program',md5(r.idempotency_key),
      jsonb_build_object('legacyPersonId',r.legacy_person_id,'legacyName',r.legacy_full_name,'programSlug',r.program_slug,'points',r.points,'costPerThousand',r.cost_per_thousand,'bookValue',r.book_value),
      jsonb_build_object('targetName',r.target_client_name,'legacyName',r.legacy_full_name,'programName',(select name from public.loyalty_programs where id=v_program_id),'idempotencyKey',r.idempotency_key),
      case when v_action in ('insert','already_conciliated') then 'valid' else 'invalid' end,
      v_resolution,case when v_client_count=1 then v_client_id else null end,md5(r.idempotency_key||':'||r.points::text||':'||r.book_value::text),
      v_action not in ('insert','already_conciliated'),
      case when v_action='insert' then 'create_imported_initial_balance' when v_action='already_conciliated' then 'link_as_unchanged' else 'keep_current' end,
      jsonb_build_object('currentPoints',v_current),v_action
    ) on conflict(batch_id,file_id,row_number) do update set
      target_id=excluded.target_id,raw_payload=excluded.raw_payload,normalized_payload=excluded.normalized_payload,
      validation_status=excluded.validation_status,
      resolution_status=case when public.import_staging_rows.resolution_status='committed' then 'committed' else excluded.resolution_status end,
      row_hash=excluded.row_hash,blocks_commit=case when public.import_staging_rows.resolution_status='committed' then false else excluded.blocks_commit end,
      suggested_action=excluded.suggested_action,before_payload=excluded.before_payload,resolution_reason=excluded.resolution_reason
    returning id into v_row_id;

    insert into public.import_balance_reconciliations(
      batch_id,staging_row_id,client_id,client_source_page_id,program_id,account_id,current_points,
      imported_points,difference_points,cost_per_thousand,source_book_value,reference_date,suggested_action,status
    ) values (
      v_batch_id,v_row_id,case when v_client_count=1 then v_client_id else null end,md5('iddas-person:'||r.legacy_person_id::text),
      v_program_id,v_account_id,v_current,r.points,r.points-v_current,r.cost_per_thousand,r.book_value,date '2026-07-21',
      case when v_action='insert' then 'create_imported_initial_balance' when v_action='already_conciliated' then 'link_as_unchanged' else 'keep_current' end,
      case when v_action='already_conciliated' then 'committed' when v_action='insert' then 'ready' else 'review' end
    ) on conflict(staging_row_id) do update set
      client_id=excluded.client_id,program_id=excluded.program_id,account_id=excluded.account_id,
      current_points=excluded.current_points,imported_points=excluded.imported_points,difference_points=excluded.difference_points,
      cost_per_thousand=excluded.cost_per_thousand,source_book_value=excluded.source_book_value,
      suggested_action=excluded.suggested_action,
      status=case when public.import_balance_reconciliations.status in ('committed','reversed') then public.import_balance_reconciliations.status else excluded.status end,
      updated_at=clock_timestamp();
  end loop;

  update public.import_batches b set dry_run_summary=b.dry_run_summary||jsonb_build_object(
    'blockingRows',(select count(*) from public.import_staging_rows where batch_id=v_batch_id and blocks_commit),
    'conflicts',(select count(*) from public.import_staging_rows where batch_id=v_batch_id and resolution_reason='conflict'),
    'invalid',(select count(*) from public.import_staging_rows where batch_id=v_batch_id and validation_status='invalid'),
    'balancePreview',jsonb_build_object(
      'initialBalances',(select count(*) from public.import_staging_rows where batch_id=v_batch_id and resolution_reason='insert'),
      'equalBalances',(select count(*) from public.import_staging_rows where batch_id=v_batch_id and resolution_reason='already_conciliated'),
      'divergences',(select count(*) from public.import_staging_rows where batch_id=v_batch_id and resolution_reason='conflict'),
      'zeroWallets',0,'ledgerPoints',3080020,'patrimony',60189.72
    )
  ) where b.id=v_batch_id;

  return public.iddas_balance_preview_payload(v_batch_id);
end;
$$;

create or replace function public.admin_commit_iddas_balance_backfill(p_batch_id uuid,p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid:=auth.uid();
  b public.import_batches%rowtype;
  client_group record;
  r record;
  v_client_id uuid;
  v_client_count integer;
  v_status_before public.client_status;
  v_status_after public.client_status;
  v_program_id uuid;
  v_account_id uuid;
  v_current bigint;
  v_tx_id uuid;
  v_operation_id uuid;
  v_created_for_client integer;
  v_new_transactions integer:=0;
  v_succeeded integer:=0;
  v_failed integer:=0;
  v_failures jsonb:='[]'::jsonb;
  v_result jsonb;
begin
  if actor is null or not public.has_staff_role(array['super_admin'::public.app_role]) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_confirmation is distinct from 'iddas_html_saldos_20260721_v1' then raise exception 'CONFIRMATION_REQUIRED' using errcode='22023'; end if;

  perform public.admin_preview_iddas_balance_backfill();
  select * into b from public.import_batches where id=p_batch_id and source_key='iddas_html_saldos_20260721_v1' for update;
  if not found then raise exception 'BATCH_NOT_FOUND' using errcode='P0002'; end if;
  if b.status='committed' then
    return public.iddas_balance_preview_payload(p_batch_id)||jsonb_build_object('idempotentReplay',true,'newTransactions',0,'succeededClients',13,'failedClients',0);
  end if;
  if b.status not in ('review','failed') then raise exception 'BATCH_NOT_REVIEWABLE' using errcode='55000'; end if;
  update public.import_batches set status='committing',confirmed_at=clock_timestamp(),confirmed_by=actor,error_code=null where id=p_batch_id;

  for client_group in
    select distinct legacy_person_id,target_client_name
    from public.iddas_balance_source_rows where source_key='iddas_html_saldos_20260721_v1'
    order by legacy_person_id
  loop
    begin
      v_created_for_client:=0;
      select count(*)::integer,(array_agg(c.id order by c.id))[1],(array_agg(c.status order by c.id))[1] into v_client_count,v_client_id,v_status_before
      from public.clients c where lower(trim(c.full_name))=lower(trim(client_group.target_client_name));
      if v_client_count=0 then raise exception 'CLIENT_NOT_FOUND'; end if;
      if v_client_count>1 then raise exception 'AMBIGUOUS_CLIENT'; end if;

      -- Toda a validação do cliente ocorre antes do primeiro lançamento.
      for r in select * from public.iddas_balance_source_rows s where s.source_key='iddas_html_saldos_20260721_v1' and s.legacy_person_id=client_group.legacy_person_id order by s.program_slug loop
        select id into v_program_id from public.loyalty_programs where slug=r.program_slug;
        if v_program_id is null then raise exception 'PROGRAM_NOT_FOUND'; end if;
        select id into v_account_id from public.program_accounts where client_id=v_client_id and program_id=v_program_id;
        v_current:=0;
        if v_account_id is not null then
          perform 1 from public.program_accounts where id=v_account_id for update;
          select coalesce((select bs.balance from public.balance_snapshots bs where bs.account_id=v_account_id order by bs.captured_at desc,bs.id desc limit 1),0) into v_current;
        end if;
        v_operation_id:=public.iddas_operation_uuid(r.idempotency_key,'initial');
        if not exists(select 1 from public.point_transactions where operation_id=v_operation_id) and v_current<>0 and v_current<>r.points then
          raise exception 'BALANCE_CONFLICT:%:%:%',r.program_slug,v_current,r.points;
        end if;
      end loop;

      for r in select * from public.iddas_balance_source_rows s where s.source_key='iddas_html_saldos_20260721_v1' and s.legacy_person_id=client_group.legacy_person_id order by s.program_slug loop
        select id into v_program_id from public.loyalty_programs where slug=r.program_slug;
        insert into public.program_accounts(client_id,program_id,active,created_by)
        values(v_client_id,v_program_id,true,actor)
        on conflict(client_id,program_id) do update set active=true,updated_at=clock_timestamp()
        returning id into v_account_id;
        perform 1 from public.program_accounts where id=v_account_id for update;
        select coalesce((select bs.balance from public.balance_snapshots bs where bs.account_id=v_account_id order by bs.captured_at desc,bs.id desc limit 1),0) into v_current;
        v_operation_id:=public.iddas_operation_uuid(r.idempotency_key,'initial');

        if exists(select 1 from public.point_transactions where operation_id=v_operation_id) or v_current=r.points then
          select id into v_tx_id from public.point_transactions where operation_id=v_operation_id;
        elsif v_current=0 then
          insert into public.point_transactions(
            account_id,occurred_at,transaction_type,points_delta,description,external_reference,source,metadata,
            created_by,entry_category,entry_date,valuation_mode,cash_total,cost_per_thousand,operation_id
          ) values (
            v_account_id,timestamptz '2026-07-21 12:00:00+00','adjustment',r.points,'Saldo inicial importado do Iddas',
            r.idempotency_key,'iddas_balance_backfill',jsonb_build_object('batchId',p_batch_id,'sourceKey',r.source_key,'legacyPersonId',r.legacy_person_id,'bookValue',r.book_value),
            actor,'initial_balance_import',date '2026-07-21','total_value',r.book_value,r.cost_per_thousand,v_operation_id
          ) returning id into v_tx_id;
          insert into public.balance_snapshots(
            account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source_book_value,source,notes,created_by
          ) values (
            v_account_id,timestamptz '2026-07-21 12:00:00+00',r.points,r.cost_per_thousand,
            round((r.book_value*1000)/r.points,4),r.book_value,'iddas_balance_backfill','Saldo inicial auditado — PATCH MRL 020',actor
          );
          v_created_for_client:=v_created_for_client+1;
          v_new_transactions:=v_new_transactions+1;
        else
          raise exception 'BALANCE_CHANGED_DURING_COMMIT';
        end if;

        update public.import_balance_reconciliations br set
          account_id=v_account_id,current_points=r.points,difference_points=0,operation_id=v_operation_id,
          transaction_id=v_tx_id,status='committed',committed_at=clock_timestamp(),updated_at=clock_timestamp()
        from public.import_staging_rows sr
        where br.staging_row_id=sr.id and br.batch_id=p_batch_id and sr.source_external_id=md5(r.idempotency_key);
        update public.import_staging_rows set resolution_status='committed',blocks_commit=false,committed_at=clock_timestamp(),commit_error_code=null
        where batch_id=p_batch_id and source_external_id=md5(r.idempotency_key);

        insert into public.external_source_map(source_system,source_database_id,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id)
        values('iddas_html','iddas_html_saldos_20260721_v1',md5(r.idempotency_key),'program_account',v_account_id,p_batch_id,p_batch_id)
        on conflict(source_system,source_database_id,source_page_id,entity_type) do update set local_entity_id=excluded.local_entity_id,last_import_batch_id=excluded.last_import_batch_id,updated_at=clock_timestamp();
      end loop;

      insert into public.external_source_map(source_system,source_database_id,source_page_id,entity_type,local_entity_id,first_import_batch_id,last_import_batch_id)
      values('iddas_html','iddas_html_saldos_20260721_v1',md5('iddas-person:'||client_group.legacy_person_id::text),'client',v_client_id,p_batch_id,p_batch_id)
      on conflict(source_system,source_database_id,source_page_id,entity_type) do update set local_entity_id=excluded.local_entity_id,last_import_batch_id=excluded.last_import_batch_id,updated_at=clock_timestamp();

      select status into v_status_after from public.clients where id=v_client_id;
      if v_status_after is distinct from v_status_before then raise exception 'CLIENT_STATUS_CHANGED'; end if;
      insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data)
      values(actor,v_client_id,'commit_iddas_balance_backfill','import_batches',p_batch_id::text,jsonb_build_object(
        'sourceKey','iddas_html_saldos_20260721_v1','legacyPersonId',client_group.legacy_person_id,
        'accounts',(select count(*) from public.iddas_balance_source_rows where source_key='iddas_html_saldos_20260721_v1' and legacy_person_id=client_group.legacy_person_id),
        'points',(select sum(points) from public.iddas_balance_source_rows where source_key='iddas_html_saldos_20260721_v1' and legacy_person_id=client_group.legacy_person_id),
        'bookValue',(select sum(book_value) from public.iddas_balance_source_rows where source_key='iddas_html_saldos_20260721_v1' and legacy_person_id=client_group.legacy_person_id),
        'newTransactions',v_created_for_client,'statusPreserved',true));
      v_succeeded:=v_succeeded+1;
    exception when others then
      v_failed:=v_failed+1;
      v_failures:=v_failures||jsonb_build_array(jsonb_build_object('legacyPersonId',client_group.legacy_person_id,'code',split_part(sqlerrm,':',1)));
      update public.import_staging_rows sr set resolution_status='failed_commit',blocks_commit=true,commit_error_code=split_part(sqlerrm,':',1)
      where sr.batch_id=p_batch_id and sr.source_external_id in (
        select md5(s.idempotency_key) from public.iddas_balance_source_rows s where s.source_key='iddas_html_saldos_20260721_v1' and s.legacy_person_id=client_group.legacy_person_id
      );
      update public.import_balance_reconciliations br set status='failed',updated_at=clock_timestamp()
      from public.import_staging_rows sr where br.staging_row_id=sr.id and br.batch_id=p_batch_id and sr.commit_error_code is not null;
    end;
  end loop;

  update public.import_batches set
    status=case when v_failed=0 then 'committed' else 'failed' end,
    finished_at=clock_timestamp(),error_code=case when v_failed=0 then null else 'COMMIT_PARTIALLY_COMPLETED' end,
    dry_run_summary=dry_run_summary||jsonb_build_object('committed',jsonb_build_object(
      'createdClients',0,'createdTasks',0,'walletsReconciled',44-v_failed,'ledgerEntries',v_new_transactions,
      'importedPoints',(select coalesce(sum(points),0) from public.iddas_balance_source_rows s where s.source_key='iddas_html_saldos_20260721_v1' and not exists(select 1 from jsonb_array_elements(v_failures) f where (f->>'legacyPersonId')::bigint=s.legacy_person_id)),
      'importedPatrimony',(select coalesce(sum(book_value),0) from public.iddas_balance_source_rows s where s.source_key='iddas_html_saldos_20260721_v1' and not exists(select 1 from jsonb_array_elements(v_failures) f where (f->>'legacyPersonId')::bigint=s.legacy_person_id)),
      'succeededClients',v_succeeded,'failedClients',v_failed,'failures',v_failures
    ))
  where id=p_batch_id;

  v_result:=public.iddas_balance_preview_payload(p_batch_id);
  return v_result||jsonb_build_object('idempotentReplay',false,'newTransactions',v_new_transactions,'succeededClients',v_succeeded,'failedClients',v_failed,'failures',v_failures);
end;
$$;

create or replace function public.admin_rollback_iddas_balance_backfill(p_batch_id uuid,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid:=auth.uid();
  b public.import_batches%rowtype;
  client_group record;
  r record;
  v_original public.point_transactions%rowtype;
  v_account_id uuid;
  v_current bigint;
  v_status_before public.client_status;
  v_status_after public.client_status;
  v_reversed integer:=0;
  v_failed integer:=0;
  v_failures jsonb:='[]'::jsonb;
begin
  if actor is null or not public.has_staff_role(array['super_admin'::public.app_role]) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<8 then raise exception 'ROLLBACK_REASON_REQUIRED' using errcode='22023'; end if;
  select * into b from public.import_batches where id=p_batch_id and source_key='iddas_html_saldos_20260721_v1' for update;
  if not found then raise exception 'BATCH_NOT_FOUND' using errcode='P0002'; end if;
  if b.status='rolled_back' then return jsonb_build_object('batchId',p_batch_id,'idempotentReplay',true,'reversedTransactions',0,'failedClients',0); end if;
  if b.status<>'committed' then raise exception 'BATCH_NOT_COMMITTED' using errcode='55000'; end if;
  update public.import_batches set rollback_status='processing',rolled_back_by=actor where id=p_batch_id;

  for client_group in
    select distinct s.legacy_person_id,pa.client_id
    from public.iddas_balance_source_rows s
    join public.point_transactions pt on pt.operation_id=public.iddas_operation_uuid(s.idempotency_key,'initial')
    join public.program_accounts pa on pa.id=pt.account_id
    where s.source_key='iddas_html_saldos_20260721_v1'
    order by s.legacy_person_id
  loop
    begin
      select status into v_status_before from public.clients where id=client_group.client_id for update;
      for r in select * from public.iddas_balance_source_rows s where s.source_key='iddas_html_saldos_20260721_v1' and s.legacy_person_id=client_group.legacy_person_id order by s.program_slug loop
        select * into v_original from public.point_transactions where operation_id=public.iddas_operation_uuid(r.idempotency_key,'initial');
        if not found then continue; end if;
        if exists(select 1 from public.point_transactions pt where pt.account_id=v_original.account_id and pt.created_at>v_original.created_at and pt.operation_id<>public.iddas_operation_uuid(r.idempotency_key,'rollback')) then
          raise exception 'ROLLBACK_CONFLICT_LATER_TRANSACTION';
        end if;
      end loop;

      for r in select * from public.iddas_balance_source_rows s where s.source_key='iddas_html_saldos_20260721_v1' and s.legacy_person_id=client_group.legacy_person_id order by s.program_slug loop
        select * into v_original from public.point_transactions where operation_id=public.iddas_operation_uuid(r.idempotency_key,'initial');
        if not found or exists(select 1 from public.point_transactions where operation_id=public.iddas_operation_uuid(r.idempotency_key,'rollback')) then continue; end if;
        v_account_id:=v_original.account_id;
        perform 1 from public.program_accounts where id=v_account_id for update;
        select coalesce((select bs.balance from public.balance_snapshots bs where bs.account_id=v_account_id order by bs.captured_at desc,bs.id desc limit 1),0) into v_current;
        if v_current<r.points then raise exception 'ROLLBACK_CONFLICT_BALANCE'; end if;
        insert into public.point_transactions(account_id,occurred_at,transaction_type,points_delta,description,external_reference,source,metadata,created_by,entry_category,entry_date,valuation_mode,cash_total,cost_per_thousand,operation_id)
        values(v_account_id,clock_timestamp(),'adjustment',-r.points,'Estorno do saldo inicial Iddas',r.idempotency_key||':rollback','iddas_balance_backfill_rollback',jsonb_build_object('batchId',p_batch_id,'reversesTransactionId',v_original.id,'reason',left(trim(p_reason),240)),actor,'other',current_date,'per_thousand',0,r.cost_per_thousand,public.iddas_operation_uuid(r.idempotency_key,'rollback'));
        insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source_book_value,source,notes,created_by)
        values(v_account_id,clock_timestamp(),v_current-r.points,case when v_current=r.points then 0 else r.cost_per_thousand end,case when v_current=r.points then 0 else round((r.book_value*1000)/r.points,4) end,case when v_current=r.points then 0 else null end,'iddas_balance_backfill_rollback','Estorno auditado — PATCH MRL 020',actor);
        update public.import_balance_reconciliations br set status='reversed',updated_at=clock_timestamp()
        from public.import_staging_rows sr where br.staging_row_id=sr.id and br.batch_id=p_batch_id and sr.source_external_id=md5(r.idempotency_key);
        v_reversed:=v_reversed+1;
      end loop;
      select status into v_status_after from public.clients where id=client_group.client_id;
      if v_status_after is distinct from v_status_before then raise exception 'CLIENT_STATUS_CHANGED'; end if;
      insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,new_data)
      values(actor,client_group.client_id,'rollback_iddas_balance_backfill','import_batches',p_batch_id::text,jsonb_build_object('sourceKey','iddas_html_saldos_20260721_v1','legacyPersonId',client_group.legacy_person_id,'reasonProvided',true,'statusPreserved',true));
    exception when others then
      v_failed:=v_failed+1;
      v_failures:=v_failures||jsonb_build_array(jsonb_build_object('legacyPersonId',client_group.legacy_person_id,'code',split_part(sqlerrm,':',1)));
    end;
  end loop;

  update public.import_batches set
    status=case when v_failed=0 then 'rolled_back' else 'rollback_conflict' end,
    rollback_status=case when v_failed=0 then 'completed' else 'conflict' end,
    rolled_back_at=case when v_failed=0 then clock_timestamp() else null end,
    error_code=case when v_failed=0 then null else 'ROLLBACK_CONFLICT' end
  where id=p_batch_id;
  return jsonb_build_object('batchId',p_batch_id,'idempotentReplay',false,'reversedTransactions',v_reversed,'failedClients',v_failed,'failures',v_failures);
end;
$$;

revoke all on function public.iddas_operation_uuid(text,text) from public,anon,authenticated;
revoke all on function public.iddas_balance_preview_payload(uuid) from public,anon,authenticated;
revoke all on function public.admin_preview_iddas_balance_backfill() from public,anon;
revoke all on function public.admin_commit_iddas_balance_backfill(uuid,text) from public,anon;
revoke all on function public.admin_rollback_iddas_balance_backfill(uuid,text) from public,anon;
grant execute on function public.admin_preview_iddas_balance_backfill() to authenticated;
grant execute on function public.admin_commit_iddas_balance_backfill(uuid,text) to authenticated;
grant execute on function public.admin_rollback_iddas_balance_backfill(uuid,text) to authenticated;

commit;
