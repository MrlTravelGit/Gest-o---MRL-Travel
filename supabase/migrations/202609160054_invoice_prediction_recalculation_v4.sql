begin;

create or replace function public.recalculate_card_statement_v4(p_statement_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.card_statements%rowtype;
begin
  if auth.uid() is null or not public.can_write_client_data() then
    raise exception 'Voce nao possui permissao para recalcular faturas.' using errcode='42501';
  end if;
  select * into s from public.card_statements where id=p_statement_id and archived_at is null;
  if s.id is null then raise exception 'Fatura nao encontrada.' using errcode='P0002'; end if;
  return public.save_card_statement_v4(
    p_statement_id=>s.id,p_client_id=>s.client_id,p_financial_institution_id=>s.financial_institution_id,
    p_account_person_type=>s.account_person_type,p_card_id=>s.card_id,p_statement_month=>s.statement_month,
    p_total_amount=>s.total_spend,p_domestic_amount=>s.domestic_amount,p_international_amount=>s.international_amount,
    p_partner_scope=>coalesce(s.partner_type,'program_partner'),p_partner_name=>s.partner_name,
    p_loyalty_program_id=>s.loyalty_program_id,p_points_received=>case when s.actual_points_confirmed then s.received_points end,
    p_fx_rate=>s.fx_rate,p_fx_rate_date=>s.fx_rate_date,p_fx_source=>s.fx_source,p_notes=>s.notes,p_operation_id=>gen_random_uuid()
  );
end $$;

revoke all on function public.recalculate_card_statement_v4(uuid) from public,anon;
grant execute on function public.recalculate_card_statement_v4(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
