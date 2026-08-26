begin;

-- PATCH MRL 034. Remove somente a assinatura criada pela migration 037.
drop function if exists public.get_client_management_terms_v1(
  text,text,text,date,date,date,date,boolean,boolean,numeric,numeric,numeric,numeric,text,text,integer,integer
);

create function public.get_client_management_terms_v1(
  p_cashback_max numeric default null,
  p_cashback_min numeric default null,
  p_client_status text default 'all',
  p_end_from date default null,
  p_end_to date default null,
  p_has_cashback boolean default null,
  p_has_savings boolean default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_savings_max numeric default null,
  p_savings_min numeric default null,
  p_search text default null,
  p_sort_by text default 'client_name',
  p_sort_direction text default 'asc',
  p_start_from date default null,
  p_start_to date default null,
  p_term_status text default 'all'
) returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit,25),1),100);
  safe_offset integer := greatest(coalesce(p_offset,0),0);
  search_value text := nullif(trim(coalesce(p_search,'')),'');
  term_filter text := lower(coalesce(nullif(trim(p_term_status),''),'all'));
  client_filter text := lower(coalesce(nullif(trim(p_client_status),''),'all'));
  sort_value text := lower(coalesce(nullif(trim(p_sort_by),''),'client_name'));
  direction_value text := lower(coalesce(nullif(trim(p_sort_direction),''),'asc'));
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  if term_filter not in ('all','active','expiring','ended','no_term','archived') then
    raise exception 'INVALID_TERM_STATUS' using errcode='22023';
  end if;
  if client_filter not in ('all','active','archived') then
    raise exception 'INVALID_CLIENT_STATUS' using errcode='22023';
  end if;
  if sort_value not in ('client_name','starts_on','ends_on','remaining_days','total_days','savings','cashback','last_activity') then
    raise exception 'INVALID_SORT_FIELD' using errcode='22023';
  end if;
  if direction_value not in ('asc','desc') then
    raise exception 'INVALID_SORT_DIRECTION' using errcode='22023';
  end if;
  if (p_start_from is not null and p_start_to is not null and p_start_to<p_start_from)
    or (p_end_from is not null and p_end_to is not null and p_end_to<p_end_from) then
    raise exception 'INVALID_PERIOD' using errcode='22007';
  end if;

  return (
    with base as materialized (
      select
        c.id client_id,
        c.full_name,
        c.status::text client_status,
        mc.id contract_id,
        mc.starts_on,
        mc.ends_on,
        mc.status::text contract_status,
        case
          when c.status='ended' then 'archived'
          when mc.id is null or mc.starts_on>current_date then 'no_term'
          when mc.ends_on<current_date or mc.status in ('ended','cancelled') then 'ended'
          when mc.ends_on between current_date and current_date+30 then 'expiring'
          else 'active'
        end term_status,
        case
          when mc.id is null then null
          when mc.ends_on is null then greatest(current_date-mc.starts_on+1,0)
          else mc.ends_on-mc.starts_on+1
        end total_days,
        case
          when mc.id is null then null
          else greatest(least(current_date,coalesce(mc.ends_on,current_date))-mc.starts_on+1,0)
        end elapsed_days,
        case when mc.ends_on is null then null else mc.ends_on-current_date end remaining_days,
        case
          when mc.id is null then 0
          when mc.ends_on is null then 100
          else least(greatest(round(
            100.0*greatest(least(current_date,mc.ends_on)-mc.starts_on+1,0)
            / nullif(mc.ends_on-mc.starts_on+1,0),1
          ),0),100)
        end progress_percent,
        coalesce(fin.savings,0)::numeric savings,
        coalesce(fin.cashback,0)::numeric cashback,
        fin.last_activity,
        coalesce(hist.historical_savings,0)::numeric historical_savings,
        coalesce(hist.historical_cashback,0)::numeric historical_cashback
      from public.clients c
      left join lateral (
        select x.*
        from public.management_contracts x
        where x.client_id=c.id
        order by
          case when x.status in ('active','paused')
            and x.starts_on<=current_date
            and (x.ends_on is null or x.ends_on>=current_date) then 0 else 1 end,
          x.starts_on desc,x.updated_at desc,x.id desc
        limit 1
      ) mc on true
      left join lateral (
        select
          coalesce((
            select sum(r.savings_amount)
            from public.redemptions r
            where r.client_id=c.id
              and r.status='confirmed'
              and mc.id is not null
              and r.launched_on>=mc.starts_on
              and r.launched_on<=coalesce(mc.ends_on,current_date)
          ),0) savings,
          coalesce((
            select sum(case
              when t.transaction_type='earning' then t.amount
              when t.transaction_type='reversal' then -t.amount
              when t.transaction_type='adjustment' then t.amount
              else 0 end)
            from public.cashback_transactions t
            left join public.redemptions r on r.id=t.redemption_id
            where t.client_id=c.id
              and t.status='confirmed'
              and t.transaction_type in ('earning','reversal','adjustment')
              and mc.id is not null
              and coalesce(r.launched_on,t.created_at::date)>=mc.starts_on
              and coalesce(r.launched_on,t.created_at::date)<=coalesce(mc.ends_on,current_date)
          ),0) cashback,
          (
            select max(r.launched_on)
            from public.redemptions r
            where r.client_id=c.id
              and r.status='confirmed'
              and mc.id is not null
              and r.launched_on between mc.starts_on and coalesce(mc.ends_on,current_date)
          ) last_activity
      ) fin on true
      left join lateral (
        select
          coalesce((
            select sum(r.savings_amount)
            from public.redemptions r
            where r.client_id=c.id and r.status='confirmed'
          ),0) historical_savings,
          coalesce((
            select sum(case
              when t.transaction_type='earning' then t.amount
              when t.transaction_type='reversal' then -t.amount
              when t.transaction_type='adjustment' then t.amount
              else 0 end)
            from public.cashback_transactions t
            where t.client_id=c.id
              and t.status='confirmed'
              and t.transaction_type in ('earning','reversal','adjustment')
          ),0) historical_cashback
      ) hist on true
    ), filtered as materialized (
      select *
      from base
      where (search_value is null or full_name ilike '%'||search_value||'%')
        and (term_filter='all' or term_status=term_filter)
        and (client_filter='all'
          or (client_filter='archived' and client_status='ended')
          or (client_filter='active' and client_status<>'ended'))
        and (p_start_from is null or starts_on>=p_start_from)
        and (p_start_to is null or starts_on<=p_start_to)
        and (p_end_from is null or ends_on>=p_end_from)
        and (p_end_to is null or ends_on<=p_end_to)
        and (p_has_savings is null or (savings>0)=p_has_savings)
        and (p_has_cashback is null or (cashback<>0)=p_has_cashback)
        and (p_savings_min is null or savings>=p_savings_min)
        and (p_savings_max is null or savings<=p_savings_max)
        and (p_cashback_min is null or cashback>=p_cashback_min)
        and (p_cashback_max is null or cashback<=p_cashback_max)
    ), paged as (
      select *
      from filtered
      order by
        case when direction_value='asc' and sort_value='client_name' then full_name end asc,
        case when direction_value='desc' and sort_value='client_name' then full_name end desc,
        case when direction_value='asc' and sort_value='starts_on' then starts_on end asc nulls last,
        case when direction_value='desc' and sort_value='starts_on' then starts_on end desc nulls last,
        case when direction_value='asc' and sort_value='ends_on' then ends_on end asc nulls last,
        case when direction_value='desc' and sort_value='ends_on' then ends_on end desc nulls last,
        case when direction_value='asc' and sort_value='remaining_days' then remaining_days end asc nulls last,
        case when direction_value='desc' and sort_value='remaining_days' then remaining_days end desc nulls last,
        case when direction_value='asc' and sort_value='total_days' then total_days end asc nulls last,
        case when direction_value='desc' and sort_value='total_days' then total_days end desc nulls last,
        case when direction_value='asc' and sort_value='savings' then savings end asc,
        case when direction_value='desc' and sort_value='savings' then savings end desc,
        case when direction_value='asc' and sort_value='cashback' then cashback end asc,
        case when direction_value='desc' and sort_value='cashback' then cashback end desc,
        case when direction_value='asc' and sort_value='last_activity' then last_activity end asc nulls last,
        case when direction_value='desc' and sort_value='last_activity' then last_activity end desc nulls last,
        full_name,client_id
      limit safe_limit offset safe_offset
    )
    select jsonb_build_object(
      'summary',jsonb_build_object(
        'active',(select count(*) from filtered where term_status='active'),
        'expiring',(select count(*) from filtered where term_status='expiring'),
        'ended',(select count(*) from filtered where term_status='ended'),
        'noTerm',(select count(*) from filtered where term_status='no_term'),
        'totalSavings',coalesce((select sum(savings) from filtered),0),
        'totalCashback',coalesce((select sum(cashback) from filtered),0)
      ),
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'clientId',client_id,'clientName',full_name,'clientStatus',client_status,
          'contractId',contract_id,'contractStatus',contract_status,'termStatus',term_status,
          'startsOn',starts_on,'endsOn',ends_on,'totalDays',total_days,
          'elapsedDays',elapsed_days,'remainingDays',remaining_days,'progressPercent',progress_percent,
          'savings',savings,'cashback',cashback,'historicalSavings',historical_savings,
          'historicalCashback',historical_cashback,'lastActivity',last_activity
        ) order by array_position(array(select client_id from paged),client_id))
        from paged
      ),'[]'::jsonb),
      'total',(select count(*) from filtered),
      'limit',safe_limit,
      'offset',safe_offset,
      'canVaultAccess',public.has_vault_access(auth.uid())
    )
  );
end
$$;

revoke all on function public.get_client_management_terms_v1(
  numeric,numeric,text,date,date,boolean,boolean,integer,integer,numeric,numeric,text,text,text,date,date,text
) from public,anon;
grant execute on function public.get_client_management_terms_v1(
  numeric,numeric,text,date,date,boolean,boolean,integer,integer,numeric,numeric,text,text,text,date,date,text
) to authenticated;

comment on function public.get_client_management_terms_v1(
  numeric,numeric,text,date,date,boolean,boolean,integer,integer,numeric,numeric,text,text,text,date,date,text
) is 'Vigencias administrativas v1; assinatura canonica de 17 parametros, economia confirmada e cashback liquido do ledger limitados ao contrato selecionado.';

do $$
declare
  function_oid oid;
  canonical_names text[] := array[
    'p_cashback_max','p_cashback_min','p_client_status','p_end_from','p_end_to',
    'p_has_cashback','p_has_savings','p_limit','p_offset','p_savings_max',
    'p_savings_min','p_search','p_sort_by','p_sort_direction','p_start_from',
    'p_start_to','p_term_status'
  ];
begin
  select p.oid into function_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_client_management_terms_v1';

  if function_oid is null
    or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='get_client_management_terms_v1')<>1
    or (select proargnames from pg_proc where oid=function_oid)<>canonical_names
    or (select pg_get_function_result(function_oid))<>'jsonb'
    or not (select prosecdef from pg_proc where oid=function_oid)
    or not ('search_path=pg_catalog, public'=any(select unnest(proconfig) from pg_proc where oid=function_oid))
    or has_function_privilege('anon',function_oid,'EXECUTE')
    or not has_function_privilege('authenticated',function_oid,'EXECUTE') then
    raise exception 'INVALID_MANAGEMENT_TERMS_RPC_CONTRACT';
  end if;
end
$$;

notify pgrst,'reload schema';

commit;
