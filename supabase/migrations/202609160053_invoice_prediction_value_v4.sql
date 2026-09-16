begin;

alter table public.card_statements
  add column if not exists loyalty_program_id uuid references public.loyalty_programs(id) on delete set null,
  add column if not exists partner_type text,
  add column if not exists partner_name text,
  add column if not exists estimated_points_value numeric(16,2),
  add column if not exists points_difference numeric(18,2),
  add column if not exists calculation_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists actual_points_confirmed boolean not null default false,
  add column if not exists archived_at timestamptz;

alter table public.card_statements drop constraint if exists card_statement_prediction_status_valid;
alter table public.card_statements add constraint card_statement_prediction_status_valid
  check(prediction_status in ('pending_card','pending_breakdown','missing_fx','calculated','outdated','confirmed','divergent','not_applicable'));

create index if not exists card_statements_client_competency_idx on public.card_statements(client_id,statement_month desc) where archived_at is null;
create index if not exists card_statements_card_active_idx on public.card_statements(card_id) where archived_at is null;

create or replace function public.get_card_statement_options_v4(p_client_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'clients',coalesce((select jsonb_agg(jsonb_build_object('clientId',id,'fullName',full_name) order by full_name) from public.clients where status in ('active','lead','ended')),'[]'::jsonb),
    'institutions',coalesce((select jsonb_agg(jsonb_build_object('institutionId',id,'name',name,'logoUrl',logo_url) order by name) from public.financial_institutions where active),'[]'::jsonb),
    'programs',coalesce((select jsonb_agg(jsonb_build_object('programId',id,'name',name,'mileValue',default_value_per_thousand) order by name) from public.loyalty_programs where active),'[]'::jsonb),
    'cards',coalesce((select jsonb_agg(jsonb_build_object(
      'cardId',cc.id,'clientId',cc.client_id,'institutionId',fi.id,'issuer',cc.issuer,
      'label',cc.issuer||' '||cc.product_name||coalesce(' '||cv.card_variant,'')||coalesce(' final '||cc.last_four,''),
      'earningType',case when coalesce(cc.custom_unit_type,rule.unit_type)='points_per_usd' then 'usd' else 'brl' end,
      'basis',case when coalesce(cc.custom_unit_type,rule.unit_type)='points_per_usd' then 'usd' else 'brl' end,
      'pointsPerUsd',case when coalesce(cc.custom_unit_type,rule.unit_type)='points_per_usd' then coalesce(cc.custom_rate,rule.rate) end,
      'pointsPerBrl',case when coalesce(cc.custom_unit_type,rule.unit_type)='points_per_brl' then coalesce(cc.custom_rate,rule.rate) when coalesce(cc.custom_unit_type,rule.unit_type)='one_point_per_brl_amount' then 1/nullif(coalesce(cc.custom_rate,rule.denominator),0) end,
      'pointsPerUnit',coalesce(cc.custom_rate,rule.rate,case when rule.denominator>0 then 1/rule.denominator end),
      'ruleDescription',coalesce(cc.custom_rate_justification,rule.rule_scope),
      'loyaltyProgramId',lp.id,'programName',coalesce(lp.name,cv.rewards_program),'mileValue',lp.default_value_per_thousand,
      'catalogVersionId',cc.catalog_version_id,'cardSlug',cv.card_slug,
      'calculationReady',coalesce(cc.custom_rate,rule.rate,rule.denominator) is not null,
      'requiresReview',coalesce(cv.requires_review,false) or coalesce(rule.requires_review,false)
    ) order by cc.issuer,cc.product_name)
    from public.credit_cards cc
    left join public.card_catalog_versions cv on cv.id=cc.catalog_version_id
    left join public.financial_institutions fi on fi.normalized_name=lower(regexp_replace(trim(cc.issuer),'[^a-zA-Z0-9]+','','g'))
    left join lateral(select r.* from public.card_catalog_rules r where r.catalog_version_id=cc.catalog_version_id and r.calculation_enabled and r.valid_from<=current_date and (r.valid_until is null or r.valid_until>=current_date) order by (r.merchant_scope='any') desc,(r.spend_location='any') desc,r.priority desc limit 1) rule on true
    left join public.loyalty_programs lp on lp.id=cc.linked_program_id
    where cc.active and (p_client_id is null or cc.client_id=p_client_id)),'[]'::jsonb)
  );
end $$;

create or replace function public.save_card_statement_v4(
  p_statement_id uuid default null,p_client_id uuid default null,p_financial_institution_id uuid default null,p_account_person_type text default null,
  p_card_id uuid default null,p_statement_month date default null,p_total_amount numeric default null,p_domestic_amount numeric default null,
  p_international_amount numeric default null,p_partner_amount numeric default null,p_partner_scope text default 'program_partner',p_partner_name text default null,
  p_loyalty_program_id uuid default null,p_points_received numeric default null,p_fx_rate numeric default null,p_fx_rate_date date default null,
  p_fx_source text default null,p_notes text default null,p_operation_id uuid default gen_random_uuid()
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare base jsonb; sid uuid; s public.card_statements%rowtype; card_name text; unit_type text; rate_value numeric; converted numeric; points_value numeric; mile_value numeric; program_name text; snapshot jsonb; final_status text;
begin
  -- O total e a base principal nesta versao; o detalhamento fica preservado para regras futuras.
  base:=public.save_card_statement_v3(p_statement_id,p_client_id,p_financial_institution_id,p_account_person_type,p_card_id,p_statement_month,p_total_amount,
    case when p_card_id is not null then p_total_amount else p_domestic_amount end,null,null,p_partner_scope,p_partner_name,p_points_received,p_fx_rate,p_fx_rate_date,p_fx_source,p_notes,p_operation_id);
  sid:=(base->>'statementId')::uuid;
  select * into s from public.card_statements where id=sid for update;
  if p_card_id is not null then
    select cc.issuer||' '||cc.product_name||coalesce(' final '||cc.last_four,''),coalesce(cc.custom_unit_type,r.unit_type),
      coalesce(cc.custom_rate,r.rate,case when r.denominator>0 then 1/r.denominator end),coalesce(p_loyalty_program_id,cc.linked_program_id)
      into card_name,unit_type,rate_value,p_loyalty_program_id
    from public.credit_cards cc left join lateral(select x.* from public.card_catalog_rules x where x.catalog_version_id=cc.catalog_version_id and x.calculation_enabled and x.valid_from<=p_statement_month and (x.valid_until is null or x.valid_until>=p_statement_month) order by (x.merchant_scope='any') desc,(x.spend_location='any') desc,x.priority desc limit 1) r on true where cc.id=p_card_id;
  end if;
  select name,default_value_per_thousand into program_name,mile_value from public.loyalty_programs where id=p_loyalty_program_id;
  if unit_type='points_per_usd' and coalesce(p_fx_rate,0)>0 and rate_value>0 then converted:=round(p_total_amount/p_fx_rate,2); s.predicted_points:=round((p_total_amount/p_fx_rate)*rate_value); final_status:='calculated';
  elsif unit_type in ('points_per_brl','one_point_per_brl_amount') and rate_value>0 then s.predicted_points:=round(p_total_amount*rate_value); final_status:='calculated';
  elsif unit_type='points_per_usd' then s.predicted_points:=null; final_status:='missing_fx';
  elsif p_card_id is null then s.predicted_points:=null; final_status:='pending_card';
  else s.predicted_points:=null; final_status:='pending_breakdown'; end if;
  points_value:=case when s.predicted_points is not null and mile_value is not null then round(s.predicted_points/1000*mile_value,2) end;
  if p_points_received is not null and s.predicted_points is not null then final_status:=case when round(p_points_received)=round(s.predicted_points) then 'confirmed' else 'divergent' end; end if;
  snapshot:=jsonb_build_object('card_name',card_name,'earning_type',case when unit_type='points_per_usd' then 'usd' when unit_type is null then null else 'brl' end,
    'points_per_usd',case when unit_type='points_per_usd' then rate_value end,'points_per_brl',case when unit_type<>'points_per_usd' then rate_value end,
    'invoice_total',round(p_total_amount,2),'exchange_rate',p_fx_rate,'converted_usd',converted,'estimated_points',s.predicted_points,
    'program_name',program_name,'mile_value',mile_value,'estimated_points_value',points_value);
  update public.card_statements set domestic_amount=p_domestic_amount,international_amount=p_international_amount,loyalty_program_id=p_loyalty_program_id,partner_type=nullif(p_partner_scope,''),partner_name=nullif(trim(coalesce(p_partner_name,'')),''),
    predicted_points=s.predicted_points,calculated_expected_points=s.predicted_points,estimated_points_value=points_value,
    actual_points_confirmed=p_points_received is not null,points_difference=case when p_points_received is not null and s.predicted_points is not null then round(p_points_received-s.predicted_points,2) end,
    prediction_status=final_status,calculation_snapshot=snapshot,calculation_rule_snapshot=snapshot,calculation_version='invoice-points-v4',updated_at=now() where id=sid;
  return jsonb_build_object('statementId',sid,'predictionStatus',final_status,'predictedPoints',s.predicted_points,'estimatedPointsValue',points_value,'pointsDifference',case when p_points_received is not null and s.predicted_points is not null then round(p_points_received-s.predicted_points,2) end);
end $$;

create or replace function public.get_card_statements_v4(p_client_id uuid default null,p_card_id uuid default null,p_prediction_status text default 'all',p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
 return (with f as materialized(select s.*,c.full_name,fi.name institution_name,cc.issuer,cc.product_name,cc.last_four,lp.name program_name,lp.default_value_per_thousand mile_value from public.card_statements s left join public.clients c on c.id=s.client_id left join public.financial_institutions fi on fi.id=s.financial_institution_id left join public.credit_cards cc on cc.id=s.card_id left join public.loyalty_programs lp on lp.id=s.loyalty_program_id where s.archived_at is null and (p_client_id is null or s.client_id=p_client_id) and (p_card_id is null or s.card_id=p_card_id) and (coalesce(p_prediction_status,'all')='all' or s.prediction_status=p_prediction_status)),p as(select * from f order by statement_month desc limit least(greatest(p_limit,1),200) offset greatest(p_offset,0))
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('statementId',id,'clientId',client_id,'clientName',coalesce(full_name,'Vinculo pendente'),'institutionId',financial_institution_id,'institutionName',institution_name,'accountPersonType',account_person_type,'cardId',card_id,'cardLabel',case when card_id is null then null else issuer||' '||product_name||coalesce(' final '||last_four,'') end,'statementMonth',statement_month,'totalSpend',total_spend,'eligibleSpend',eligible_spend,'domesticAmount',domestic_amount,'internationalAmount',international_amount,'earningBasis',earning_basis,'earningRate',earning_rate,'fxRate',fx_rate,'fxRateDate',fx_rate_date,'fxSource',fx_source,'predictedPoints',predicted_points,'expectedPoints',predicted_points,'receivedPoints',case when actual_points_confirmed then received_points end,'difference',points_difference,'predictionStatus',prediction_status,'status',prediction_status,'notes',notes,'ruleSnapshot',calculation_snapshot,'calculationVersion',calculation_version,'loyaltyProgramId',loyalty_program_id,'programName',program_name,'mileValue',mile_value,'estimatedPointsValue',estimated_points_value,'actualPointsConfirmed',actual_points_confirmed,'partnerType',partner_type,'partnerName',partner_name) order by statement_month desc) from p),'[]'::jsonb),'total',(select count(*) from f),'limit',least(greatest(p_limit,1),200),'offset',greatest(p_offset,0)));
end $$;

create or replace function public.build_public_client_invoice_payload(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 with rows as(select s.*,fi.name institution_name,cc.issuer||' '||cc.product_name||coalesce(' final '||cc.last_four,'') card_name from public.card_statements s left join public.financial_institutions fi on fi.id=s.financial_institution_id left join public.credit_cards cc on cc.id=s.card_id where s.client_id=p_client_id and s.archived_at is null), annual as(select * from rows where extract(year from statement_month)=extract(year from current_date))
 select jsonb_build_object('cardStatements',coalesce((select jsonb_agg(jsonb_build_object('month',statement_month,'cardName',coalesce(card_name,'Cartao nao associado'),'institutionName',institution_name,'totalSpend',total_spend,'exchangeRate',fx_rate,'estimatedPoints',predicted_points,'estimatedPointsValue',estimated_points_value,'receivedPoints',case when actual_points_confirmed then received_points end,'difference',points_difference,'status',case when prediction_status='missing_fx' then 'missing_fx' when actual_points_confirmed and coalesce(points_difference,0)<>0 then 'divergent' when actual_points_confirmed then 'received' else 'predicted' end) order by statement_month desc) from rows),'[]'::jsonb),
 'invoiceSummary',jsonb_build_object('year',extract(year from current_date)::int,'invoiceCount',(select count(*) from annual),'totalInvoiced',coalesce((select sum(total_spend) from annual),0),'estimatedPoints',coalesce((select sum(predicted_points) from annual),0),'estimatedPointsValue',coalesce((select sum(estimated_points_value) from annual),0),'receivedPoints',coalesce((select sum(received_points) from annual where actual_points_confirmed),0),'accumulatedDifference',coalesce((select sum(points_difference) from annual where actual_points_confirmed),0)));
$$;

do $$ begin if to_regprocedure('public.build_public_client_dashboard_payload_pre_invoice_v4(uuid)') is null then alter function public.build_public_client_dashboard_payload(uuid) rename to build_public_client_dashboard_payload_pre_invoice_v4; end if; end $$;
create or replace function public.build_public_client_dashboard_payload(p_client_id uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$ select public.build_public_client_dashboard_payload_pre_invoice_v4(p_client_id)||public.build_public_client_invoice_payload(p_client_id); $$;

revoke all on function public.get_card_statement_options_v4(uuid),public.save_card_statement_v4(uuid,uuid,uuid,text,uuid,date,numeric,numeric,numeric,numeric,text,text,uuid,numeric,numeric,date,text,text,uuid),public.get_card_statements_v4(uuid,uuid,text,integer,integer) from public,anon;
grant execute on function public.get_card_statement_options_v4(uuid),public.save_card_statement_v4(uuid,uuid,uuid,text,uuid,date,numeric,numeric,numeric,numeric,text,text,uuid,numeric,numeric,date,text,text,uuid),public.get_card_statements_v4(uuid,uuid,text,integer,integer) to authenticated;
revoke all on function public.build_public_client_invoice_payload(uuid),public.build_public_client_dashboard_payload_pre_invoice_v4(uuid),public.build_public_client_dashboard_payload(uuid) from public,anon,authenticated;
grant execute on function public.build_public_client_invoice_payload(uuid),public.build_public_client_dashboard_payload_pre_invoice_v4(uuid),public.build_public_client_dashboard_payload(uuid) to service_role;
notify pgrst,'reload schema';
commit;
