begin;

-- PostgreSQL não implementa min(uuid). O resolvedor mantém a mesma regra
-- determinística convertendo apenas durante a agregação.
create or replace function public.resolve_iddas_savings_client(p_legacy_person_id bigint,p_legacy_name text)
returns table(resolved_client_id uuid,resolved_match_method text,resolved_issue_code text,resolved_reason text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare candidate uuid; candidate_count integer; alias_target text;
begin
  if p_legacy_person_id=10178 then
    return query select null::uuid,null::text,'SPECIAL_ALESSANDRA_ANTIGO'::text,'Alessandra (Antigo) exige seleção administrativa explícita.'::text; return;
  end if;
  if public.normalize_iddas_savings_name(p_legacy_name)=public.normalize_iddas_savings_name('Hamilton Antônio Figueiredo') then
    return query select null::uuid,null::text,'SPECIAL_HAMILTON'::text,'Hamilton não possui identificador legado comprovado.'::text; return;
  end if;
  if public.normalize_iddas_savings_name(p_legacy_name)='michael' then
    return query select null::uuid,null::text,'SPECIAL_MICHAEL'::text,'Michael exige confirmação administrativa explícita; o usuário administrador nunca é inferido.'::text; return;
  end if;

  if p_legacy_person_id is not null then
    select count(distinct esm.local_entity_id),min(esm.local_entity_id::text)::uuid into candidate_count,candidate
      from public.external_source_map esm
     where esm.source_system='iddas_html' and esm.source_database_id='iddas_html_saldos_20260721_v1'
       and esm.source_page_id=md5('iddas-person:'||p_legacy_person_id::text) and esm.entity_type='client';
    if candidate_count=1 then return query select candidate,'legacy_id'::text,null::text,null::text; return;
    elsif candidate_count>1 then return query select null::uuid,null::text,'AMBIGUOUS_LEGACY_ID'::text,'O ID legado possui mais de um vínculo e exige revisão.'::text; return;
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
    select count(*),min(c.id::text)::uuid into candidate_count,candidate from public.clients c
     where public.normalize_iddas_savings_name(c.full_name)=public.normalize_iddas_savings_name(alias_target);
    if candidate_count=1 then return query select candidate,'approved_alias'::text,null::text,null::text; return; end if;
    return query select null::uuid,null::text,'ALIAS_TARGET_NOT_UNIQUE'::text,'O alias aprovado não encontrou um único cadastro atual.'::text; return;
  end if;

  select count(*),min(c.id::text)::uuid into candidate_count,candidate from public.clients c
   where public.normalize_iddas_savings_name(c.full_name)=public.normalize_iddas_savings_name(p_legacy_name);
  if candidate_count=1 then return query select candidate,'exact_unique_name'::text,null::text,null::text;
  elsif candidate_count>1 then return query select null::uuid,null::text,'AMBIGUOUS_EXACT_NAME'::text,'Mais de um cadastro possui o mesmo nome completo normalizado.'::text;
  else return query select null::uuid,null::text,'UNRESOLVED_CLIENT'::text,'Nenhum cadastro possui ID legado ou nome completo exato e único.'::text;
  end if;
end; $$;

notify pgrst,'reload schema';
commit;
