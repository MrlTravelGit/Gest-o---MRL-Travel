-- PATCH MRL 025 - validacao transacional obrigatoria em producao.
-- Nao deixa dados de teste: o bloco interno termina com uma excecao controlada,
-- que reverte sua subtransacao depois de todas as assercoes passarem.

create or replace function public.calculate_client_card_points(
  p_card_id uuid,p_statement_month date,p_spend_segments jsonb,p_fx_rate numeric default null
)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
  card public.credit_cards%rowtype; catalog public.card_catalog_versions%rowtype;
  segment jsonb; selected_rule public.card_catalog_rules%rowtype;
  amount_value numeric; total_value numeric:=0; segment_points numeric; total_points numeric:=0;
  applications jsonb:='[]'::jsonb; month_value date:=public.first_day(p_statement_month);
  location_value text; merchant_scope_value text; merchant_name_value text;
  unit_value text; rate_value numeric; denominator_value numeric;
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso nao autorizado' using errcode='42501'; end if;
  if jsonb_typeof(p_spend_segments)<>'array' or jsonb_array_length(p_spend_segments)=0 then
    raise exception 'Informe ao menos um segmento de gasto.' using errcode='22023';
  end if;
  select * into card from public.credit_cards where id=p_card_id and active;
  if card.id is null then raise exception 'Cartao nao encontrado ou inativo.' using errcode='P0002'; end if;
  if card.started_on is not null and month_value<public.first_day(card.started_on) then
    raise exception 'O cartao ainda nao estava ativo na competencia informada.' using errcode='22023';
  end if;
  if card.ended_on is not null and month_value>public.first_day(card.ended_on) then
    raise exception 'O cartao ja estava encerrado na competencia informada.' using errcode='22023';
  end if;
  select * into catalog from public.card_catalog_versions where id=card.catalog_version_id;
  if catalog.id is null then raise exception 'Cartao sem versao do catalogo.' using errcode='P0002'; end if;
  if month_value<catalog.valid_from or (catalog.valid_until is not null and month_value>catalog.valid_until) then
    raise exception 'A versao do cartao nao esta vigente para esta fatura.' using errcode='22023';
  end if;
  if not catalog.calculation_enabled and card.custom_rate is null then
    raise exception 'A fonte informa ate/a partir de. Confirme a taxa contratual real do cliente antes de calcular.' using errcode='22023';
  end if;
  select coalesce(sum((x->>'amountBrl')::numeric),0) into total_value from jsonb_array_elements(p_spend_segments) x;
  if total_value<=0 then raise exception 'O gasto elegivel deve ser positivo.' using errcode='22023'; end if;
  for segment in select value from jsonb_array_elements(p_spend_segments) loop
    amount_value:=(segment->>'amountBrl')::numeric;
    location_value:=coalesce(nullif(segment->>'spendLocation',''),'domestic');
    merchant_scope_value:=coalesce(nullif(segment->>'merchantScope',''),'any');
    merchant_name_value:=coalesce(segment->>'merchantName','');
    if amount_value<=0 then raise exception 'Segmento de gasto invalido.' using errcode='22023'; end if;
    if card.custom_rate is not null then
      selected_rule.id:=null; selected_rule.rule_scope:='client-custom-confirmed'; unit_value:=card.custom_unit_type;
      if unit_value='one_point_per_brl_amount' then rate_value:=null;denominator_value:=card.custom_rate;
      else rate_value:=card.custom_rate;denominator_value:=null; end if;
    else
      select r.* into selected_rule from public.card_catalog_rules r
      where r.catalog_version_id=catalog.id and r.calculation_enabled
        and r.valid_from<=month_value and (r.valid_until is null or r.valid_until>=month_value)
        and r.spend_location in ('any',location_value)
        and r.merchant_scope in ('any',merchant_scope_value)
        and (r.merchant_match is null or merchant_name_value~*r.merchant_match)
        and (r.minimum_statement_amount is null or total_value>=r.minimum_statement_amount)
        and (r.maximum_statement_amount is null or total_value<=r.maximum_statement_amount)
        and (r.relationship_condition is null or lower(r.relationship_condition)=lower(coalesce(card.relationship_condition,'')))
        and (r.club_condition is null or r.club_condition=card.club_condition
          or (r.club_condition='clube_smiles_or_diamante' and (
            lower(coalesce(card.club_condition,'')) in ('clube_smiles','clube smiles','clube_smiles_or_diamante')
            or lower(coalesce(card.elite_category_condition,''))='diamante')))
        and (r.elite_category_condition is null or lower(r.elite_category_condition)=lower(coalesce(card.elite_category_condition,'')))
        and (r.accelerator_condition is null or r.accelerator_condition=card.accelerator_active)
        and (r.reward_mode_condition is null or r.reward_mode_condition=card.reward_mode)
        and (r.automatic_debit_condition is null or r.automatic_debit_condition=card.automatic_debit_active)
      order by r.priority desc,r.id limit 1;
      if selected_rule.id is null then
        raise exception 'Nenhuma regra confirmada atende ao segmento %. Revise as condicoes do cliente.',segment using errcode='22023';
      end if;
      unit_value:=selected_rule.unit_type;rate_value:=selected_rule.rate;denominator_value:=selected_rule.denominator;
    end if;
    if unit_value='points_per_usd' then
      if p_fx_rate is null or p_fx_rate<=0 then raise exception 'Informe a cotacao usada na fatura.' using errcode='22023'; end if;
      segment_points:=amount_value/p_fx_rate*rate_value;
    elsif unit_value='points_per_brl' then segment_points:=amount_value*rate_value;
    else segment_points:=amount_value/denominator_value; end if;
    segment_points:=round(segment_points,4);total_points:=total_points+segment_points;
    applications:=applications||jsonb_build_array(jsonb_build_object(
      'segment',segment,'ruleId',selected_rule.id,'ruleScope',selected_rule.rule_scope,
      'unitType',unit_value,'rate',rate_value,'denominator',denominator_value,
      'eligibleAmountBrl',amount_value,'fxRate',case when unit_value='points_per_usd' then p_fx_rate else null end,
      'calculatedPoints',segment_points,'catalogVersionId',catalog.id,'catalogVersion',catalog.version));
  end loop;
  return jsonb_build_object('cardId',card.id,'catalogVersionId',catalog.id,'catalogVersion',catalog.version,
    'statementMonth',month_value,'eligibleSpend',total_value,'expectedPoints',round(total_points,4),
    'fxRate',p_fx_rate,'applications',applications,'calculationVersion','card-points-v2.1');
end $$;

do $validation$
declare
  actor_id uuid;
  test_client_id constant uuid := '00000000-0000-0000-0000-000000002590';
  test_card_id uuid;
  calculation jsonb;
  validation_month date := public.first_day((current_date+interval '1 month')::date);
begin
  assert (select count(*)=5 from public.loyalty_club_plans
    where slug in ('esfera-pro','esfera-master','esfera-vip','esfera-exclusive','smiles-mais-streaming-1000')
      and catalog_version=1), 'PATCH025_VALIDATION: cinco clubes ausentes ou duplicados';
  assert (select product_family='Clube Esfera' from public.loyalty_club_plans where slug='esfera-pro' and catalog_version=1),
    'PATCH025_VALIDATION: Esfera identificado incorretamente';
  assert (select product_family='Clube Smiles + Streaming' and monthly_points=1000 and joining_bonus_points=14500
    from public.loyalty_club_plans where slug='smiles-mais-streaming-1000' and catalog_version=1),
    'PATCH025_VALIDATION: Smiles + Streaming misturado ou bonus recorrente';
  assert (select count(*)=54 from public.card_catalog_versions where version=1),
    'PATCH025_VALIDATION: catalogo nao possui 54 cartoes';
  assert (select count(*)>=102 from public.card_catalog_rules),
    'PATCH025_VALIDATION: regras do catalogo incompletas';
  assert not exists(select 1 from public.card_catalog_versions where source_quality='official_up_to' and calculation_enabled),
    'PATCH025_VALIDATION: produto official_up_to habilitado';
  assert (select count(*)=68 from public.iddas_savings_source_rows),
    'PATCH025_VALIDATION: economias legadas alteradas';
  assert (select sum(verified_savings_value_brl)=130404.85 from public.iddas_savings_source_rows),
    'PATCH025_VALIDATION: total de economia legado alterado';
  assert (select sum(points)=3080020 from public.iddas_balance_source_rows),
    'PATCH025_VALIDATION: pontos migrados alterados';
  assert not has_function_privilege('anon','public.get_card_catalog(text,text,text,text,boolean)','EXECUTE'),
    'PATCH025_VALIDATION: anon executa catalogo administrativo';
  assert (select relrowsecurity from pg_catalog.pg_class where oid='public.card_catalog_versions'::regclass),
    'PATCH025_VALIDATION: RLS do catalogo desabilitada';
  assert (select relrowsecurity from pg_catalog.pg_class where oid='public.card_catalog_rules'::regclass),
    'PATCH025_VALIDATION: RLS das regras desabilitada';

  select sm.user_id into actor_id from public.staff_members sm
  where sm.active and sm.role in ('super_admin','manager','operator')
  order by case sm.role when 'super_admin' then 1 when 'manager' then 2 else 3 end
  limit 1;

  begin
    if actor_id is null then
      actor_id:='00000000-0000-0000-0000-000000002591';
      insert into auth.users(
        id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
        raw_app_meta_data,raw_user_meta_data,created_at,updated_at
      ) values(
        actor_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'patch025-validation-admin@example.invalid','',now(),'{}',
        '{"full_name":"Patch 025 Validation"}',now(),now()
      );
      insert into public.staff_members(user_id,role,active) values(actor_id,'super_admin',true);
    end if;
    perform set_config('request.jwt.claim.sub',actor_id::text,true);
    insert into public.clients(id,full_name,first_name_normalized,email,status,created_by)
    values(test_client_id,'Validacao transacional Patch 025','validacao',
      'patch025-production-validation@example.invalid','active',actor_id);

    select (public.associate_catalog_card(
      test_client_id,c.id,validation_month,null,'holder','points',null,null,null,false,false,
      null,null,null,null,'Validacao produtiva transacional do vinculo',null
    )->>'cardId')::uuid into test_card_id
    from public.card_catalog_versions c where c.card_slug='c6-basico' and c.version=1;
    assert test_card_id is not null, 'PATCH025_VALIDATION: associacao de cartao falhou';

    calculation:=public.calculate_client_card_points(
      test_card_id,validation_month,
      '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any"}]'::jsonb,null
    );
    assert (calculation->>'expectedPoints')::numeric=250,
      'PATCH025_VALIDATION: calculo por real incorreto';

    select (public.associate_catalog_card(
      test_client_id,c.id,validation_month,null,'holder','points',null,null,null,false,false,
      null,null,null,null,'Validacao produtiva do bloqueio official_up_to',null
    )->>'cardId')::uuid into test_card_id
    from public.card_catalog_versions c where c.card_slug='c6-mastercard-black' and c.version=1;
    begin
      perform public.calculate_client_card_points(
        test_card_id,validation_month,
        '[{"amountBrl":5000,"spendLocation":"domestic","merchantScope":"any"}]'::jsonb,5
      );
      raise exception 'PATCH025_VALIDATION: official_up_to calculou sem confirmacao';
    exception
      when sqlstate '22023' then
        if sqlerrm not like 'A fonte informa ate/a partir de.%' then raise; end if;
    end;

    -- Excecao sentinela: reverte cliente, vinculos e auditorias desta subtransacao.
    raise exception using errcode='P0250',message='PATCH025_VALIDATION_ROLLBACK';
  exception
    when sqlstate 'P0250' then null;
  end;

  assert not exists(select 1 from public.clients where id=test_client_id),
    'PATCH025_VALIDATION: dados transacionais de teste nao foram revertidos';
end
$validation$;
