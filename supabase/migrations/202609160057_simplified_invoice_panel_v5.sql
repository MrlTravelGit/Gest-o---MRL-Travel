begin;

create or replace function public.save_card_statement_v4(
  p_statement_id uuid default null,p_client_id uuid default null,p_financial_institution_id uuid default null,p_account_person_type text default null,
  p_card_id uuid default null,p_statement_month date default null,p_total_amount numeric default null,p_domestic_amount numeric default null,
  p_international_amount numeric default null,p_partner_amount numeric default null,p_partner_scope text default null,p_partner_name text default null,
  p_loyalty_program_id uuid default null,p_points_received numeric default null,p_fx_rate numeric default null,p_fx_rate_date date default null,
  p_fx_source text default null,p_notes text default null,p_operation_id uuid default gen_random_uuid()
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  base jsonb; sid uuid; s public.card_statements%rowtype; card_name text; unit_type text; rate_value numeric;
  converted numeric; raw_points numeric; points_value numeric; mile_value numeric; program_name text; snapshot jsonb; final_status text;
begin
  -- O total da fatura e a base principal. Os campos segmentados antigos permanecem apenas por compatibilidade.
  base:=public.save_card_statement_v3(p_statement_id,p_client_id,p_financial_institution_id,p_account_person_type,p_card_id,p_statement_month,p_total_amount,
    case when p_card_id is not null then p_total_amount else p_domestic_amount end,null,null,p_partner_scope,p_partner_name,p_points_received,p_fx_rate,p_fx_rate_date,p_fx_source,p_notes,p_operation_id);
  sid:=(base->>'statementId')::uuid;
  select * into s from public.card_statements where id=sid for update;

  if p_card_id is not null then
    select cc.issuer||' '||cc.product_name||coalesce(' final '||cc.last_four,''),coalesce(cc.custom_unit_type,r.unit_type),
      coalesce(cc.custom_rate,r.rate,case when r.denominator>0 then 1/r.denominator end),coalesce(p_loyalty_program_id,cc.linked_program_id)
      into card_name,unit_type,rate_value,p_loyalty_program_id
    from public.credit_cards cc
    left join lateral(
      select x.* from public.card_catalog_rules x
      where x.catalog_version_id=cc.catalog_version_id and x.calculation_enabled and x.valid_from<=p_statement_month
        and (x.valid_until is null or x.valid_until>=p_statement_month)
      order by (x.merchant_scope='any') desc,(x.spend_location='any') desc,x.priority desc limit 1
    ) r on true
    where cc.id=p_card_id;
  end if;

  select name,default_value_per_thousand into program_name,mile_value from public.loyalty_programs where id=p_loyalty_program_id;

  if unit_type='points_per_usd' and coalesce(p_fx_rate,0)>0 and rate_value>0 then
    converted:=round(p_total_amount/p_fx_rate,2);
    raw_points:=(p_total_amount/p_fx_rate)*rate_value;
    s.predicted_points:=round(raw_points);
    final_status:='calculated';
  elsif unit_type in ('points_per_brl','one_point_per_brl_amount') and rate_value>0 then
    raw_points:=p_total_amount*rate_value;
    s.predicted_points:=round(raw_points);
    final_status:='calculated';
  elsif unit_type='points_per_usd' then
    s.predicted_points:=null; final_status:='missing_fx';
  elsif p_card_id is null then
    s.predicted_points:=null; final_status:='pending_card';
  else
    s.predicted_points:=null; final_status:='pending_breakdown';
  end if;

  points_value:=case when raw_points is not null and mile_value is not null then round(raw_points/1000*mile_value,2) end;
  if p_points_received is not null and s.predicted_points is not null then
    final_status:=case when round(p_points_received)=round(s.predicted_points) then 'confirmed' else 'divergent' end;
  end if;

  snapshot:=jsonb_build_object(
    'card_name',card_name,
    'earning_type',case when unit_type='points_per_usd' then 'usd' when unit_type is null then null else 'brl' end,
    'points_per_usd',case when unit_type='points_per_usd' then rate_value end,
    'points_per_brl',case when unit_type<>'points_per_usd' then rate_value end,
    'invoice_total',round(p_total_amount,2),
    'exchange_rate',p_fx_rate,
    'converted_usd',converted,
    'estimated_points',s.predicted_points,
    'program_name',program_name,
    'mile_value',mile_value,
    'estimated_points_value',points_value
  );

  update public.card_statements set
    domestic_amount=p_domestic_amount,
    international_amount=p_international_amount,
    loyalty_program_id=p_loyalty_program_id,
    partner_type=nullif(p_partner_scope,''),
    partner_name=nullif(trim(coalesce(p_partner_name,'')),''),
    predicted_points=s.predicted_points,
    calculated_expected_points=s.predicted_points,
    estimated_points_value=points_value,
    actual_points_confirmed=p_points_received is not null,
    points_difference=case when p_points_received is not null and s.predicted_points is not null then round(p_points_received-s.predicted_points,2) end,
    prediction_status=final_status,
    calculation_snapshot=snapshot,
    calculation_rule_snapshot=snapshot,
    calculation_version='invoice-points-v5',
    updated_at=now()
  where id=sid;

  return jsonb_build_object(
    'statementId',sid,
    'predictionStatus',final_status,
    'predictedPoints',s.predicted_points,
    'estimatedPointsValue',points_value,
    'pointsDifference',case when p_points_received is not null and s.predicted_points is not null then round(p_points_received-s.predicted_points,2) end
  );
end $$;

create or replace function public.build_public_client_invoice_payload(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with rows as(
    select s.*,fi.name institution_name,cc.issuer||' '||cc.product_name||coalesce(' final '||cc.last_four,'') card_name,lp.name program_name
    from public.card_statements s
    left join public.financial_institutions fi on fi.id=s.financial_institution_id
    left join public.credit_cards cc on cc.id=s.card_id
    left join public.loyalty_programs lp on lp.id=s.loyalty_program_id
    where s.client_id=p_client_id and s.archived_at is null
  ), annual as(select * from rows where extract(year from statement_month)=extract(year from current_date))
  select jsonb_build_object(
    'cardStatements',coalesce((select jsonb_agg(jsonb_build_object(
      'month',statement_month,
      'cardName',coalesce(card_name,'Cartao nao associado'),
      'institutionName',institution_name,
      'programName',program_name,
      'totalSpend',total_spend,
      'exchangeRate',fx_rate,
      'estimatedPoints',predicted_points,
      'estimatedPointsValue',estimated_points_value,
      'receivedPoints',case when actual_points_confirmed then received_points end,
      'difference',points_difference,
      'status',case when prediction_status='missing_fx' then 'missing_fx' when actual_points_confirmed and coalesce(points_difference,0)<>0 then 'divergent' when actual_points_confirmed then 'received' else 'predicted' end
    ) order by statement_month desc) from rows),'[]'::jsonb),
    'invoiceSummary',jsonb_build_object(
      'year',extract(year from current_date)::int,
      'invoiceCount',(select count(*) from annual),
      'totalInvoiced',coalesce((select sum(total_spend) from annual),0),
      'estimatedPoints',coalesce((select sum(predicted_points) from annual),0),
      'estimatedPointsValue',coalesce((select sum(estimated_points_value) from annual),0),
      'receivedPoints',coalesce((select sum(received_points) from annual where actual_points_confirmed),0),
      'accumulatedDifference',coalesce((select sum(points_difference) from annual where actual_points_confirmed),0)
    )
  );
$$;

revoke all on function public.save_card_statement_v4(uuid,uuid,uuid,text,uuid,date,numeric,numeric,numeric,numeric,text,text,uuid,numeric,numeric,date,text,text,uuid) from public,anon;
grant execute on function public.save_card_statement_v4(uuid,uuid,uuid,text,uuid,date,numeric,numeric,numeric,numeric,text,text,uuid,numeric,numeric,date,text,text,uuid) to authenticated;
revoke all on function public.build_public_client_invoice_payload(uuid) from public,anon,authenticated;
grant execute on function public.build_public_client_invoice_payload(uuid) to service_role;

notify pgrst,'reload schema';
commit;
