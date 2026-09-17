begin;

create or replace function public.save_card_statement_v5(
  p_statement_id uuid default null,p_client_id uuid default null,p_financial_institution_id uuid default null,p_account_person_type text default null,
  p_card_id uuid default null,p_statement_month date default null,p_total_amount numeric default null,p_domestic_amount numeric default null,
  p_international_amount numeric default null,p_partner_amount numeric default null,p_partner_scope text default null,p_partner_name text default null,
  p_loyalty_program_id uuid default null,p_points_received numeric default null,p_fx_rate numeric default null,p_fx_rate_date date default null,
  p_fx_source text default null,p_notes text default null,p_operation_id uuid default gen_random_uuid(),p_due_on date default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; statement_id uuid;
begin
  result:=public.save_card_statement_v4(
    p_statement_id,p_client_id,p_financial_institution_id,p_account_person_type,p_card_id,p_statement_month,p_total_amount,
    p_domestic_amount,p_international_amount,p_partner_amount,p_partner_scope,p_partner_name,p_loyalty_program_id,p_points_received,
    p_fx_rate,p_fx_rate_date,p_fx_source,p_notes,p_operation_id
  );
  statement_id:=(result->>'statementId')::uuid;
  if p_due_on is not null then
    update public.card_statements set due_on=p_due_on,updated_at=clock_timestamp() where id=statement_id;
  end if;
  return result||jsonb_build_object('dueOn',p_due_on);
end $$;

create or replace function public.get_card_statements_v5(
  p_client_id uuid default null,p_card_id uuid default null,p_prediction_status text default 'all',p_limit integer default 50,p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare payload jsonb;
begin
  payload:=public.get_card_statements_v4(p_client_id,p_card_id,p_prediction_status,p_limit,p_offset);
  return jsonb_set(payload,'{items}',coalesce((
    select jsonb_agg(item||jsonb_build_object('dueOn',s.due_on) order by ordinality)
    from jsonb_array_elements(payload->'items') with ordinality as rows(item,ordinality)
    left join public.card_statements s on s.id=(item->>'statementId')::uuid
  ),'[]'::jsonb));
end $$;

revoke all on function public.save_card_statement_v5(uuid,uuid,uuid,text,uuid,date,numeric,numeric,numeric,numeric,text,text,uuid,numeric,numeric,date,text,text,uuid,date) from public,anon;
grant execute on function public.save_card_statement_v5(uuid,uuid,uuid,text,uuid,date,numeric,numeric,numeric,numeric,text,text,uuid,numeric,numeric,date,text,text,uuid,date) to authenticated;
revoke all on function public.get_card_statements_v5(uuid,uuid,text,integer,integer) from public,anon;
grant execute on function public.get_card_statements_v5(uuid,uuid,text,integer,integer) to authenticated;

notify pgrst,'reload schema';
commit;
