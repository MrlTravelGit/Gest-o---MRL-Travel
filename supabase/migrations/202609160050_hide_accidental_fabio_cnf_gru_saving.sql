begin;

do $$
declare
  target public.redemptions%rowtype;
  target_count integer;
  target_source text;
  target_source_id text;
  target_match_key text;
begin
  select count(*) into target_count
  from public.redemptions r
  where r.launched_on='2026-01-08'::date
    and r.cash_reference_total=2206.97
    and r.effective_cost=260.13
    and r.savings_amount=1946.84
    and public.normalize_savings_match_text(r.description)=
      'emissao-de-passagem-aerea-cnf-gru-fabio-r26013-taxa-de-embarque';

  if target_count<>1 then
    raise exception 'FABIO_CNF_GRU_TARGET_COUNT_%',target_count using errcode='P0002';
  end if;

  select * into target
  from public.redemptions r
  where r.launched_on='2026-01-08'::date
    and r.cash_reference_total=2206.97
    and r.effective_cost=260.13
    and r.savings_amount=1946.84
    and public.normalize_savings_match_text(r.description)=
      'emissao-de-passagem-aerea-cnf-gru-fabio-r26013-taxa-de-embarque'
  for update;

  target_source:=coalesce(nullif(trim(target.source_system),''),'redemptions');
  target_source_id:=coalesce(nullif(trim(target.source_external_key),''),target.id::text);
  target_match_key:=public.build_savings_match_key(
    target.client_id,target_source,target_source_id,target.description,target.launched_on,
    target.cash_reference_total,target.effective_cost,target.savings_amount
  );

  insert into public.client_savings_hidden_items(
    client_id,source,source_id,title,launched_on,original_amount,paid_amount,saved_amount,
    match_key,hidden_reason,hidden_by,hidden_at
  ) values (
    target.client_id,target_source,target_source_id,target.description,target.launched_on,
    target.cash_reference_total,target.effective_cost,target.savings_amount,target_match_key,
    'Correção PATCH 040: lançamento CNF-GRU incluído por engano',null,clock_timestamp()
  ) on conflict(client_id,match_key) do update set
    hidden_reason=excluded.hidden_reason,
    hidden_at=least(public.client_savings_hidden_items.hidden_at,excluded.hidden_at);

  update public.redemptions set
    status=case when status='confirmed' then 'voided'::public.redemption_status else status end,
    voided_at=coalesce(voided_at,clock_timestamp()),
    void_reason=coalesce(void_reason,'Ocultada pelo PATCH 040: lançamento incluído por engano'),
    updated_at=clock_timestamp(),
    notes=case when coalesce(notes,'') like '%PATCH 040: CNF-GRU ocultada%'
      then notes else concat_ws(E'\n',notes,'PATCH 040: CNF-GRU ocultada como lançamento indevido.') end
  where id=target.id;

  update public.cashback_transactions
  set visibility_scope='admin_only'
  where redemption_id=target.id;

  insert into public.audit_logs(actor_user_id,client_id,action,table_name,record_id,old_data,new_data)
  values(null,target.client_id,'hide_accidental_saving_patch040','client_savings_hidden_items',target.id::text,
    jsonb_build_object('status',target.status,'title',target.description,'launchedOn',target.launched_on,
      'originalAmount',target.cash_reference_total,'paidAmount',target.effective_cost,'savedAmount',target.savings_amount),
    jsonb_build_object('status','hidden','matchKey',target_match_key,'systemMigration',true,'originalPreserved',true));
end $$;

notify pgrst,'reload schema';
commit;
