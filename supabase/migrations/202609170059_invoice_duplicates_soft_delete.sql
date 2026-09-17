begin;

alter table public.credit_cards
  add column if not exists is_primary boolean not null default false,
  add column if not exists account_person_type text not null default 'PF';

alter table public.credit_cards drop constraint if exists credit_cards_account_person_type_valid;
alter table public.credit_cards add constraint credit_cards_account_person_type_valid
  check (account_person_type in ('PF','PJ'));

alter table public.card_statements
  add column if not exists invoice_sequence integer,
  add column if not exists invoice_label text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

alter table public.card_statements drop constraint if exists card_statements_card_id_statement_month_key;

with numbered as (
  select id,row_number() over(partition by card_id,statement_month order by created_at,id)::integer sequence
  from public.card_statements
)
update public.card_statements s set invoice_sequence=n.sequence
from numbered n where n.id=s.id and s.invoice_sequence is null;

alter table public.card_statements alter column invoice_sequence set default 1;
alter table public.card_statements alter column invoice_sequence set not null;
alter table public.card_statements drop constraint if exists card_statements_invoice_sequence_positive;
alter table public.card_statements add constraint card_statements_invoice_sequence_positive check(invoice_sequence>0);

create index if not exists card_statements_visible_competency_idx
  on public.card_statements(client_id,statement_month desc,invoice_sequence desc)
  where archived_at is null and deleted_at is null;

create unique index if not exists credit_cards_one_primary_per_client_idx
  on public.credit_cards(client_id) where active and is_primary;

create or replace function public.assign_card_statement_invoice_sequence()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(coalesce(new.card_id::text,new.client_id::text)||':'||public.first_day(new.statement_month)::text,0));
  select coalesce(max(s.invoice_sequence),0)+1 into new.invoice_sequence
  from public.card_statements s
  where s.card_id is not distinct from new.card_id and s.client_id is not distinct from new.client_id
    and s.statement_month=public.first_day(new.statement_month);
  return new;
end $$;

drop trigger if exists card_statements_assign_invoice_sequence on public.card_statements;
create trigger card_statements_assign_invoice_sequence before insert on public.card_statements
for each row execute function public.assign_card_statement_invoice_sequence();

create or replace function public.get_card_statement_options_v4(p_client_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'clients',coalesce((select jsonb_agg(jsonb_build_object('clientId',id,'fullName',full_name) order by full_name) from public.clients where status in ('active','lead','ended')),'[]'::jsonb),
    'institutions',coalesce((select jsonb_agg(jsonb_build_object('institutionId',id,'name',name,'logoUrl',logo_url) order by name) from public.financial_institutions where active),'[]'::jsonb),
    'programs',coalesce((select jsonb_agg(jsonb_build_object('programId',id,'name',name,'mileValue',default_value_per_thousand) order by name) from public.loyalty_programs where active),'[]'::jsonb),
    'cards',coalesce((select jsonb_agg(jsonb_build_object(
      'cardId',cc.id,'clientId',cc.client_id,'institutionId',fi.id,'issuer',cc.issuer,'isPrimary',cc.is_primary,'accountPersonType',cc.account_person_type,
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
    ) order by cc.is_primary desc,cc.issuer,cc.product_name)
    from public.credit_cards cc
    left join public.card_catalog_versions cv on cv.id=cc.catalog_version_id
    left join public.financial_institutions fi on fi.normalized_name=lower(regexp_replace(trim(cc.issuer),'[^a-zA-Z0-9]+','','g'))
    left join lateral(select r.* from public.card_catalog_rules r where r.catalog_version_id=cc.catalog_version_id and r.calculation_enabled and r.valid_from<=current_date and (r.valid_until is null or r.valid_until>=current_date) order by (r.merchant_scope='any') desc,(r.spend_location='any') desc,r.priority desc limit 1) rule on true
    left join public.loyalty_programs lp on lp.id=cc.linked_program_id
    where cc.active and (p_client_id is null or cc.client_id=p_client_id)),'[]'::jsonb)
  );
end $$;

create or replace function public.get_card_statements_v4(p_client_id uuid default null,p_card_id uuid default null,p_prediction_status text default 'all',p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
 return (with f as materialized(select s.*,c.full_name,fi.name institution_name,cc.issuer,cc.product_name,cc.last_four,lp.name program_name,lp.default_value_per_thousand mile_value from public.card_statements s left join public.clients c on c.id=s.client_id left join public.financial_institutions fi on fi.id=s.financial_institution_id left join public.credit_cards cc on cc.id=s.card_id left join public.loyalty_programs lp on lp.id=s.loyalty_program_id where s.archived_at is null and s.deleted_at is null and (p_client_id is null or s.client_id=p_client_id) and (p_card_id is null or s.card_id=p_card_id) and (coalesce(p_prediction_status,'all')='all' or s.prediction_status=p_prediction_status)),p as(select * from f order by statement_month desc,invoice_sequence desc,created_at desc limit least(greatest(p_limit,1),200) offset greatest(p_offset,0))
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('statementId',id,'clientId',client_id,'clientName',coalesce(full_name,'Vinculo pendente'),'institutionId',financial_institution_id,'institutionName',institution_name,'accountPersonType',account_person_type,'cardId',card_id,'cardLabel',case when card_id is null then null else issuer||' '||product_name||coalesce(' final '||last_four,'') end,'statementMonth',statement_month,'invoiceSequence',invoice_sequence,'invoiceLabel',invoice_label,'totalSpend',total_spend,'eligibleSpend',eligible_spend,'domesticAmount',domestic_amount,'internationalAmount',international_amount,'earningBasis',earning_basis,'earningRate',earning_rate,'fxRate',fx_rate,'fxRateDate',fx_rate_date,'fxSource',fx_source,'predictedPoints',predicted_points,'expectedPoints',predicted_points,'receivedPoints',case when actual_points_confirmed then received_points end,'difference',points_difference,'predictionStatus',prediction_status,'status',prediction_status,'notes',notes,'ruleSnapshot',calculation_snapshot,'calculationVersion',calculation_version,'loyaltyProgramId',loyalty_program_id,'programName',program_name,'mileValue',mile_value,'estimatedPointsValue',estimated_points_value,'actualPointsConfirmed',actual_points_confirmed,'partnerType',partner_type,'partnerName',partner_name) order by statement_month desc,invoice_sequence desc,created_at desc) from p),'[]'::jsonb),'total',(select count(*) from f),'limit',least(greatest(p_limit,1),200),'offset',greatest(p_offset,0)));
end $$;

create or replace function public.delete_card_statement_v1(p_statement_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); target public.card_statements%rowtype;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'Voce nao possui permissao para excluir faturas.' using errcode='42501'; end if;
  select * into target from public.card_statements where id=p_statement_id and archived_at is null and deleted_at is null for update;
  if target.id is null then raise exception 'Fatura nao encontrada.' using errcode='P0002'; end if;
  if exists(select 1 from public.point_transactions pt where pt.status<>'voided' and (
    pt.metadata->>'cardStatementId'=target.id::text or pt.metadata->>'statementId'=target.id::text or pt.metadata->>'statement_id'=target.id::text or pt.external_reference=target.id::text
  )) then raise exception 'Esta fatura possui movimentacao real de pontos vinculada e nao pode ser excluida.' using errcode='23503'; end if;
  update public.card_statements set deleted_at=now(),deleted_by=actor,updated_at=now(),updated_by=actor where id=target.id;
  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(actor,target.client_id,'delete_card_statement','card_statements',target.id::text,to_jsonb(target),jsonb_build_object('deletedAt',now(),'deletedBy',actor));
  return jsonb_build_object('statementId',target.id,'deleted',true);
end $$;

create or replace function public.recalculate_card_statement_v4(p_statement_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.card_statements%rowtype;
begin
  if auth.uid() is null or not public.can_write_client_data() then raise exception 'Voce nao possui permissao para recalcular faturas.' using errcode='42501'; end if;
  select * into s from public.card_statements where id=p_statement_id and archived_at is null and deleted_at is null;
  if s.id is null then raise exception 'Fatura nao encontrada.' using errcode='P0002'; end if;
  return public.save_card_statement_v4(p_statement_id=>s.id,p_client_id=>s.client_id,p_financial_institution_id=>s.financial_institution_id,p_account_person_type=>s.account_person_type,p_card_id=>s.card_id,p_statement_month=>s.statement_month,p_total_amount=>s.total_spend,p_domestic_amount=>s.domestic_amount,p_international_amount=>s.international_amount,p_loyalty_program_id=>s.loyalty_program_id,p_points_received=>case when s.actual_points_confirmed then s.received_points end,p_fx_rate=>coalesce(s.calculation_snapshot->>'exchange_rate',s.fx_rate::text)::numeric,p_fx_rate_date=>s.fx_rate_date,p_fx_source=>s.fx_source,p_notes=>s.notes,p_operation_id=>gen_random_uuid());
end $$;

create or replace function public.build_public_client_invoice_payload(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with rows as(
    select s.*,fi.name institution_name,cc.issuer||' '||cc.product_name||coalesce(' final '||cc.last_four,'') card_name,lp.name program_name
    from public.card_statements s left join public.financial_institutions fi on fi.id=s.financial_institution_id left join public.credit_cards cc on cc.id=s.card_id left join public.loyalty_programs lp on lp.id=s.loyalty_program_id
    where s.client_id=p_client_id and s.archived_at is null and s.deleted_at is null
  ), annual as(select * from rows where extract(year from statement_month)=extract(year from current_date))
  select jsonb_build_object(
    'cardStatements',coalesce((select jsonb_agg(jsonb_build_object('month',statement_month,'invoiceSequence',invoice_sequence,'invoiceLabel',invoice_label,'cardName',coalesce(card_name,'Cartao nao associado'),'institutionName',institution_name,'programName',program_name,'totalSpend',total_spend,'exchangeRate',fx_rate,'estimatedPoints',predicted_points,'estimatedPointsValue',estimated_points_value,'receivedPoints',case when actual_points_confirmed then received_points end,'difference',points_difference,'status',case when prediction_status='missing_fx' then 'missing_fx' when actual_points_confirmed and coalesce(points_difference,0)<>0 then 'divergent' when actual_points_confirmed then 'received' else 'predicted' end) order by statement_month desc,invoice_sequence desc,created_at desc) from rows),'[]'::jsonb),
    'invoiceSummary',jsonb_build_object('year',extract(year from current_date)::int,'invoiceCount',(select count(*) from annual),'totalInvoiced',coalesce((select sum(total_spend) from annual),0),'estimatedPoints',coalesce((select sum(predicted_points) from annual),0),'estimatedPointsValue',coalesce((select sum(estimated_points_value) from annual),0),'receivedPoints',coalesce((select sum(received_points) from annual where actual_points_confirmed),0),'accumulatedDifference',coalesce((select sum(points_difference) from annual where actual_points_confirmed),0))
  );
$$;

revoke all on function public.delete_card_statement_v1(uuid) from public,anon;
grant execute on function public.delete_card_statement_v1(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
