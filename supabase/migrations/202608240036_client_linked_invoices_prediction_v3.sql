-- PATCH MRL 031 - Faturas vinculadas ao cliente e previsao por cartao.
-- Aditiva: preserva faturas e snapshots existentes. Legados sem origem
-- comprovavel permanecem em link_status='pending'.

create table if not exists public.financial_institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  logo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(normalized_name)
);

insert into public.financial_institutions(name, normalized_name)
select issuer, lower(regexp_replace(trim(issuer),'[^a-zA-Z0-9]+','','g'))
from (
  select distinct issuer from public.credit_cards where nullif(trim(issuer),'') is not null
  union
  select distinct issuer from public.card_catalog_versions where nullif(trim(issuer),'') is not null
) x
on conflict(normalized_name) do nothing;

alter table public.card_statements
  add column if not exists client_id uuid references public.clients(id) on delete restrict,
  add column if not exists financial_institution_id uuid references public.financial_institutions(id) on delete restrict,
  add column if not exists account_person_type text,
  add column if not exists domestic_amount numeric(16,2),
  add column if not exists international_amount numeric(16,2),
  add column if not exists predicted_points numeric(18,4),
  add column if not exists prediction_status text not null default 'pending_card',
  add column if not exists calculation_rule_id uuid references public.card_catalog_rules(id) on delete restrict,
  add column if not exists calculation_rule_snapshot jsonb,
  add column if not exists updated_by uuid references auth.users(id) on delete set null,
  add column if not exists link_status text not null default 'pending';

-- Somente vinculos comprovados pela FK historica cartao -> cliente sao migrados.
update public.card_statements s
set client_id=c.client_id,
    financial_institution_id=fi.id,
    predicted_points=coalesce(s.predicted_points,s.calculated_expected_points),
    prediction_status=case when coalesce(s.calculated_expected_points,s.expected_points) is null then 'pending_card' else 'calculated' end,
    calculation_rule_snapshot=coalesce(s.calculation_rule_snapshot,s.calculation_details,s.earning_rule_snapshot),
    updated_by=coalesce(s.updated_by,s.created_by),
    link_status=case when fi.id is null then 'pending' else 'linked' end
from public.credit_cards c
left join public.financial_institutions fi
  on fi.normalized_name=lower(regexp_replace(trim(c.issuer),'[^a-zA-Z0-9]+','','g'))
where s.card_id=c.id and s.client_id is null;

do $$ begin
  alter table public.card_statements add constraint card_statement_person_type_valid
    check(account_person_type is null or account_person_type in ('PF','PJ'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.card_statements add constraint card_statement_prediction_status_valid
    check(prediction_status in ('pending_card','pending_breakdown','calculated','outdated','confirmed','not_applicable'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.card_statements add constraint card_statement_link_status_valid
    check(link_status in ('pending','linked'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.card_statements add constraint card_statement_linked_fields_required
    check(link_status='pending' or (client_id is not null and financial_institution_id is not null and account_person_type in ('PF','PJ')));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.card_statements add constraint card_statement_breakdown_nonnegative
    check(coalesce(domestic_amount,0)>=0 and coalesce(international_amount,0)>=0 and predicted_points>=0);
exception when duplicate_object then null; end $$;

alter table public.card_statements alter column card_id drop not null;
do $$ begin
  alter table public.card_statements drop constraint card_statements_card_id_fkey;
exception when undefined_object then null; end $$;
do $$ begin
  alter table public.card_statements add constraint card_statements_card_id_fkey
    foreign key(card_id) references public.credit_cards(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists card_statements_client_idx on public.card_statements(client_id);
create index if not exists card_statements_financial_institution_idx on public.card_statements(financial_institution_id);
create index if not exists card_statements_card_idx on public.card_statements(card_id);
create index if not exists card_statements_competence_idx on public.card_statements(statement_month desc);
create index if not exists card_statements_prediction_status_idx on public.card_statements(prediction_status);
create index if not exists card_statements_pending_link_idx on public.card_statements(link_status) where link_status='pending';

alter table public.financial_institutions enable row level security;
alter table public.financial_institutions force row level security;
drop policy if exists financial_institutions_staff_select on public.financial_institutions;
create policy financial_institutions_staff_select on public.financial_institutions for select to authenticated using(public.is_staff());
drop policy if exists financial_institutions_staff_write on public.financial_institutions;
create policy financial_institutions_staff_write on public.financial_institutions for all to authenticated
  using(public.can_write_client_data()) with check(public.can_write_client_data());
revoke all on public.financial_institutions from public,anon;
grant select,insert,update on public.financial_institutions to authenticated;

create or replace function public.get_card_statement_options_v3(p_client_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'clients',coalesce((select jsonb_agg(jsonb_build_object('clientId',id,'fullName',full_name) order by full_name)
      from public.clients where status in ('active','lead','ended')),'[]'::jsonb),
    'institutions',coalesce((select jsonb_agg(jsonb_build_object('institutionId',id,'name',name,'logoUrl',logo_url) order by name)
      from public.financial_institutions where active),'[]'::jsonb),
    'cards',coalesce((select jsonb_agg(jsonb_build_object(
      'cardId',cc.id,'clientId',cc.client_id,'institutionId',fi.id,'issuer',cc.issuer,
      'label',cc.issuer||' '||cc.product_name||coalesce(' '||cv.card_variant,'')||coalesce(' final '||cc.last_four,''),
      'basis',case when cc.custom_unit_type='points_per_usd' then 'usd' when cc.custom_unit_type is not null then 'brl'
        when exists(select 1 from public.card_catalog_rules r where r.catalog_version_id=cc.catalog_version_id and r.unit_type='points_per_usd') then 'usd' else 'brl' end,
      'pointsPerUnit',cc.custom_rate,'catalogVersionId',cc.catalog_version_id,'cardSlug',cv.card_slug,
      'calculationReady',coalesce(cv.calculation_enabled,false) or cc.custom_rate is not null,
      'requiresReview',coalesce(cv.requires_review,false) or (not coalesce(cv.calculation_enabled,false) and cc.custom_rate is null)
    ) order by cc.issuer,cc.product_name)
    from public.credit_cards cc
    left join public.card_catalog_versions cv on cv.id=cc.catalog_version_id
    left join public.financial_institutions fi on fi.normalized_name=lower(regexp_replace(trim(cc.issuer),'[^a-zA-Z0-9]+','','g'))
    where cc.active and (p_client_id is null or cc.client_id=p_client_id)),'[]'::jsonb)
  );
end $$;

create or replace function public.save_card_statement_v3(
  p_statement_id uuid default null,
  p_client_id uuid default null,
  p_financial_institution_id uuid default null,
  p_account_person_type text default null,
  p_card_id uuid default null,
  p_statement_month date default null,
  p_total_amount numeric default null,
  p_domestic_amount numeric default null,
  p_international_amount numeric default null,
  p_partner_amount numeric default null,
  p_partner_scope text default 'program_partner',
  p_partner_name text default null,
  p_points_received numeric default null,
  p_fx_rate numeric default null,
  p_fx_rate_date date default null,
  p_fx_source text default null,
  p_notes text default null,
  p_operation_id uuid default gen_random_uuid()
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  actor uuid:=auth.uid(); old_row public.card_statements%rowtype; saved public.card_statements%rowtype;
  card public.credit_cards%rowtype; institution public.financial_institutions%rowtype;
  calculation jsonb; segments jsonb:='[]'::jsonb; prediction text; predicted numeric; eligible numeric:=0;
  legacy_basis public.earning_basis:='brl'; legacy_rate numeric:=1; legacy_fx numeric; status_value public.statement_status:='draft';
  rule_id uuid; calculation_error text; has_split_rules boolean:=false; received numeric:=coalesce(p_points_received,0);
  app jsonb; segment_row public.card_statement_spend_segments%rowtype; segment_index integer:=0;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'Voce nao possui permissao para faturas.' using errcode='42501'; end if;
  if p_client_id is null or not exists(select 1 from public.clients where id=p_client_id) then raise exception 'Selecione um cliente valido.' using errcode='22023'; end if;
  select * into institution from public.financial_institutions where id=p_financial_institution_id and active;
  if institution.id is null then raise exception 'Selecione um banco ou instituicao financeira valida.' using errcode='22023'; end if;
  if p_account_person_type not in ('PF','PJ') then raise exception 'Selecione o tipo da conta: PF ou PJ.' using errcode='22023'; end if;
  if p_statement_month is null or p_total_amount is null or p_total_amount<0 then raise exception 'Informe competencia e valor total validos.' using errcode='22023'; end if;
  if coalesce(p_domestic_amount,0)<0 or coalesce(p_international_amount,0)<0 or coalesce(p_partner_amount,0)<0 or received<0 then raise exception 'Os valores da fatura nao podem ser negativos.' using errcode='22023'; end if;
  if coalesce(p_domestic_amount,0)+coalesce(p_international_amount,0)+coalesce(p_partner_amount,0)>p_total_amount then raise exception 'A soma das compras segmentadas supera o total da fatura.' using errcode='22023'; end if;

  if p_statement_id is not null then
    select * into old_row from public.card_statements where id=p_statement_id for update;
    if old_row.id is null then raise exception 'Fatura nao encontrada.' using errcode='P0002'; end if;
  elsif p_operation_id is not null then
    select * into saved from public.card_statements where operation_id=p_operation_id;
    if saved.id is not null then return jsonb_build_object('statementId',saved.id,'predictionStatus',saved.prediction_status,'predictedPoints',saved.predicted_points,'idempotentReplay',true); end if;
  end if;

  if p_card_id is null then
    prediction:='pending_card'; predicted:=null; eligible:=p_total_amount;
  else
    select * into card from public.credit_cards where id=p_card_id and active;
    if card.id is null then raise exception 'Cartao nao encontrado ou inativo.' using errcode='P0002'; end if;
    if card.client_id<>p_client_id then raise exception 'O cartao selecionado pertence a outro cliente.' using errcode='22023'; end if;
    if lower(regexp_replace(trim(card.issuer),'[^a-zA-Z0-9]+','','g'))<>institution.normalized_name then
      raise exception 'O cartao selecionado nao pertence ao banco informado.' using errcode='22023';
    end if;
    if coalesce(p_domestic_amount,0)>0 then segments:=segments||jsonb_build_array(jsonb_build_object('amountBrl',p_domestic_amount,'spendLocation','domestic','merchantScope','any')); end if;
    if coalesce(p_international_amount,0)>0 then segments:=segments||jsonb_build_array(jsonb_build_object('amountBrl',p_international_amount,'spendLocation','international','merchantScope','any')); end if;
    if coalesce(p_partner_amount,0)>0 then segments:=segments||jsonb_build_array(jsonb_build_object('amountBrl',p_partner_amount,'spendLocation','domestic','merchantScope',coalesce(nullif(p_partner_scope,''),'program_partner'),'merchantName',nullif(trim(coalesce(p_partner_name,'')),''))); end if;
    if jsonb_array_length(segments)=0 then
      select count(distinct r.spend_location)>1 into has_split_rules from public.card_catalog_rules r
      where r.catalog_version_id=card.catalog_version_id and r.calculation_enabled and r.spend_location in ('domestic','international');
      if has_split_rules then prediction:='pending_breakdown'; predicted:=null; eligible:=p_total_amount;
      else segments:=jsonb_build_array(jsonb_build_object('amountBrl',p_total_amount,'spendLocation','domestic','merchantScope','any')); end if;
    end if;
    if prediction is null then
      begin
        calculation:=public.calculate_client_card_points(p_card_id,p_statement_month,segments,p_fx_rate);
        predicted:=(calculation->>'expectedPoints')::numeric; eligible:=(calculation->>'eligibleSpend')::numeric;
        prediction:='calculated'; legacy_basis:=case when exists(select 1 from jsonb_array_elements(calculation->'applications') a where a->>'unitType'='points_per_usd') then 'usd' else 'brl' end;
        legacy_fx:=case when legacy_basis='usd' then p_fx_rate else null end;
        select nullif(a->>'ruleId','')::uuid into rule_id from jsonb_array_elements(calculation->'applications') a limit 1;
      exception when others then calculation_error:=sqlerrm; prediction:='pending_breakdown'; predicted:=null; eligible:=coalesce(p_domestic_amount,0)+coalesce(p_international_amount,0)+coalesce(p_partner_amount,0); calculation:=jsonb_build_object('error',calculation_error,'calculationVersion','card-points-v3-pending');
      end;
    end if;
  end if;
  if predicted is not null then status_value:=case when received=0 then 'calculated'::public.statement_status when round(received,4)=round(predicted,4) then 'reconciled'::public.statement_status else 'divergent'::public.statement_status end; end if;

  if old_row.id is null then
    insert into public.card_statements(card_id,client_id,financial_institution_id,account_person_type,statement_month,total_spend,domestic_amount,international_amount,eligible_spend,earning_basis,earning_rate,fx_rate,received_points,status,notes,created_by,updated_by,operation_id,calculated_expected_points,predicted_points,prediction_status,calculation_rule_id,calculation_details,calculation_rule_snapshot,earning_rule_snapshot,calculation_version,catalog_version_id,calculated_at,fx_rate_date,fx_source,link_status)
    values(p_card_id,p_client_id,p_financial_institution_id,p_account_person_type,public.first_day(p_statement_month),round(p_total_amount,2),p_domestic_amount,p_international_amount,round(eligible,2),legacy_basis,legacy_rate,legacy_fx,round(received,2),status_value,nullif(trim(coalesce(p_notes,'')),''),actor,actor,p_operation_id,predicted,predicted,prediction,rule_id,coalesce(calculation,'{}'::jsonb),calculation,coalesce(calculation,'{}'::jsonb),case when predicted is null then null else 'card-points-v3' end,card.catalog_version_id,case when predicted is null then null else now() end,p_fx_rate_date,nullif(trim(coalesce(p_fx_source,'')),''),'linked') returning * into saved;
  else
    update public.card_statements set card_id=p_card_id,client_id=p_client_id,financial_institution_id=p_financial_institution_id,account_person_type=p_account_person_type,statement_month=public.first_day(p_statement_month),total_spend=round(p_total_amount,2),domestic_amount=p_domestic_amount,international_amount=p_international_amount,eligible_spend=round(eligible,2),earning_basis=legacy_basis,earning_rate=legacy_rate,fx_rate=legacy_fx,received_points=round(received,2),status=status_value,notes=nullif(trim(coalesce(p_notes,'')),''),updated_by=actor,updated_at=now(),calculated_expected_points=predicted,predicted_points=predicted,prediction_status=prediction,calculation_rule_id=rule_id,calculation_details=coalesce(calculation,'{}'::jsonb),calculation_rule_snapshot=calculation,earning_rule_snapshot=coalesce(calculation,'{}'::jsonb),calculation_version=case when predicted is null then calculation_version else 'card-points-v3' end,catalog_version_id=card.catalog_version_id,calculated_at=case when predicted is null then calculated_at else now() end,fx_rate_date=p_fx_rate_date,fx_source=nullif(trim(coalesce(p_fx_source,'')),''),link_status='linked'
    where id=old_row.id returning * into saved;
  end if;
  delete from public.card_statement_rule_applications where statement_id=saved.id;
  delete from public.card_statement_spend_segments where statement_id=saved.id;
  if calculation ? 'applications' then
    for app in select value from jsonb_array_elements(calculation->'applications') loop
      segment_index:=segment_index+1;
      insert into public.card_statement_spend_segments(statement_id,segment_order,amount_brl,spend_location,merchant_scope,merchant_name)
      values(saved.id,segment_index,(app->>'eligibleAmountBrl')::numeric,coalesce(app#>>'{segment,spendLocation}','domestic'),coalesce(app#>>'{segment,merchantScope}','any'),nullif(app#>>'{segment,merchantName}','')) returning * into segment_row;
      insert into public.card_statement_rule_applications(statement_id,segment_id,rule_id,rule_snapshot,eligible_amount_brl,fx_rate,calculated_points)
      values(saved.id,segment_row.id,nullif(app->>'ruleId','')::uuid,app,(app->>'eligibleAmountBrl')::numeric,nullif(app->>'fxRate','')::numeric,(app->>'calculatedPoints')::numeric);
    end loop;
  end if;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,p_client_id,case when old_row.id is null then 'create_card_statement_v3' else 'update_card_statement_v3' end,'card_statements',saved.id::text,case when old_row.id is null then null else to_jsonb(old_row) end,to_jsonb(saved));
  return jsonb_build_object('statementId',saved.id,'predictionStatus',prediction,'predictedPoints',predicted,'calculation',calculation,'warning',calculation_error,'idempotentReplay',false);
end $$;

create or replace function public.recalculate_card_statement_v3(p_statement_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.card_statements%rowtype; partner numeric; partner_scope text; partner_name text;
begin
  select * into s from public.card_statements where id=p_statement_id;
  if s.id is null then raise exception 'Fatura nao encontrada.' using errcode='P0002'; end if;
  select coalesce(sum(amount_brl),0),max(merchant_scope),max(merchant_name) into partner,partner_scope,partner_name from public.card_statement_spend_segments where statement_id=s.id and merchant_scope<>'any';
  return public.save_card_statement_v3(s.id,s.client_id,s.financial_institution_id,s.account_person_type,s.card_id,s.statement_month,s.total_spend,s.domestic_amount,s.international_amount,partner,partner_scope,partner_name,s.received_points,s.fx_rate,s.fx_rate_date,s.fx_source,s.notes,gen_random_uuid());
end $$;

create or replace function public.get_card_statements_v3(
  p_client_id uuid default null,p_financial_institution_id uuid default null,p_account_person_type text default null,
  p_card_id uuid default null,p_prediction_status text default 'all',p_start_month date default null,p_end_month date default null,
  p_limit integer default 50,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100); safe_offset integer:=greatest(coalesce(p_offset,0),0); normalized_prediction text:=nullif(lower(trim(coalesce(p_prediction_status,'all'))),'all');
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return (with filtered as materialized(
    select s.*,c.full_name,fi.name institution_name,cc.issuer,cc.product_name,cc.last_four,cv.card_slug,cv.version catalog_version
    from public.card_statements s left join public.clients c on c.id=s.client_id
    left join public.financial_institutions fi on fi.id=s.financial_institution_id
    left join public.credit_cards cc on cc.id=s.card_id left join public.card_catalog_versions cv on cv.id=s.catalog_version_id
    where (p_client_id is null or s.client_id=p_client_id) and (p_financial_institution_id is null or s.financial_institution_id=p_financial_institution_id)
      and (p_account_person_type is null or s.account_person_type=p_account_person_type) and (p_card_id is null or s.card_id=p_card_id)
      and (normalized_prediction is null or s.prediction_status=normalized_prediction)
      and (p_start_month is null or s.statement_month>=public.first_day(p_start_month)) and (p_end_month is null or s.statement_month<=public.first_day(p_end_month))
  ),paged as(select * from filtered order by statement_month desc,full_name nulls last limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'statementId',p.id,'clientId',p.client_id,'clientName',coalesce(p.full_name,'Vinculo pendente'),'institutionId',p.financial_institution_id,'institutionName',p.institution_name,
    'accountPersonType',p.account_person_type,'cardId',p.card_id,'cardLabel',case when p.card_id is null then null else p.issuer||' '||p.product_name||coalesce(' final '||p.last_four,'') end,
    'statementMonth',p.statement_month,'totalSpend',p.total_spend,'domesticAmount',p.domestic_amount,'internationalAmount',p.international_amount,'eligibleSpend',p.eligible_spend,
    'earningBasis',p.earning_basis,'earningRate',p.earning_rate,'fxRate',p.fx_rate,'fxRateDate',p.fx_rate_date,'fxSource',p.fx_source,
    'predictedPoints',p.predicted_points,'expectedPoints',p.predicted_points,'receivedPoints',p.received_points,'difference',case when p.predicted_points is null then null else p.received_points-p.predicted_points end,
    'predictionStatus',p.prediction_status,'status',p.prediction_status,'notes',p.notes,'ruleSnapshot',coalesce(p.calculation_rule_snapshot,'{}'::jsonb),
    'calculationDetails',coalesce(p.calculation_details,'{}'::jsonb),'calculationVersion',p.calculation_version,'calculatedAt',p.calculated_at,'calculationRuleId',p.calculation_rule_id,
    'cardSlug',p.card_slug,'catalogVersion',p.catalog_version,'linkStatus',p.link_status
  ) order by p.statement_month desc,p.full_name nulls last) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset));
end $$;

revoke all on function public.get_card_statement_options_v3(uuid),public.save_card_statement_v3(uuid,uuid,uuid,text,uuid,date,numeric,numeric,numeric,numeric,text,text,numeric,numeric,date,text,text,uuid),public.recalculate_card_statement_v3(uuid),public.get_card_statements_v3(uuid,uuid,text,uuid,text,date,date,integer,integer) from public,anon;
grant execute on function public.get_card_statement_options_v3(uuid),public.save_card_statement_v3(uuid,uuid,uuid,text,uuid,date,numeric,numeric,numeric,numeric,text,text,numeric,numeric,date,text,text,uuid),public.recalculate_card_statement_v3(uuid),public.get_card_statements_v3(uuid,uuid,text,uuid,text,date,date,integer,integer) to authenticated;
