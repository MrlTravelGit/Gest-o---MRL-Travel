begin;

-- PATCH 061: test customers stay available for audit/history, but are never
-- part of the operational customer population.
create or replace function public.is_operational_client_name(p_name text)
returns boolean
language sql
immutable
parallel safe
set search_path=pg_catalog
as $$
  select coalesce(lower(ltrim(p_name)) not like 'z%', false);
$$;

revoke all on function public.is_operational_client_name(text) from public,anon;
grant execute on function public.is_operational_client_name(text) to authenticated,service_role;

with targets as materialized (
  select id from public.clients where not public.is_operational_client_name(full_name)
), archived as (
  update public.clients c
     set status='ended'::public.client_status,
         archived_at=coalesce(c.archived_at,clock_timestamp()),
         archive_reason=coalesce(nullif(c.archive_reason,''),'Cadastro de teste ocultado pelo PATCH 061'),
         updated_at=clock_timestamp()
   where c.id in (select id from targets)
  returning c.id
), disabled_users as (
  update public.client_users cu
     set active=false,updated_at=clock_timestamp()
   where cu.client_id in (select id from targets) and cu.active
  returning cu.user_id
)
update public.management_contracts mc
   set status=case when mc.status='active' then 'ended'::public.contract_status else 'cancelled'::public.contract_status end,
       updated_at=clock_timestamp()
 where mc.client_id in (select id from targets)
   and mc.status in ('draft','active','paused');

-- Latest admin list contract, now excluding test names before pagination and
-- counters are calculated.
create or replace function public.get_admin_clients(p_limit integer default 50,p_offset integer default 0,p_search text default '',p_status text default 'all')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,50),1),100);safe_offset integer:=greatest(coalesce(p_offset,0),0);normalized_search text:=nullif(trim(coalesce(p_search,'')),'');normalized_status text:=lower(coalesce(nullif(trim(p_status),''),'all'));
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if normalized_status not in ('all','lead','active','paused','ended','archived','contract_pending','cashback_enabled','cashback_disabled') then raise exception 'INVALID_STATUS' using errcode='22023';end if;
  if normalized_status='archived' then normalized_status:='ended';end if;
  return (with base as materialized(
    select c.id,c.public_id,c.full_name,c.email::text email,c.phone_e164,c.status,c.created_at,c.archived_at,c.archive_reason,c.contract_review_status,c.registration_source,c.row_version,c.cashback_enabled,c.cashback_default_percentage,
      contract_data.contract_json,coalesce((public.safe_client_totals(c.id)->>'points')::bigint,0) total_points,coalesce((public.safe_client_totals(c.id)->>'programs')::integer,0) programs_count,
      coalesce((select sum(r.savings_amount) from public.redemptions r where r.client_id=c.id and r.status='confirmed'),0) generated_savings,
      (public.cashback_snapshot(c.id)->>'available')::numeric cashback_available,(public.cashback_snapshot(c.id)->>'generated')::numeric cashback_generated,
      (select count(*) from public.program_accounts pa where pa.client_id=c.id and pa.active and pa.club_active) active_clubs_count,
      (select min(el.expires_on) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=c.id and el.status='active' and el.remaining_points>0 and el.expires_on>=current_date) next_expiration_date,
      coalesce((select sum(el.remaining_points) from public.expiration_lots el join public.program_accounts pa on pa.id=el.account_id where pa.client_id=c.id and el.status='active' and el.remaining_points>0 and el.expires_on between current_date and current_date+90),0) expiring_points,
      (select max(pt.occurred_at) from public.point_transactions pt join public.program_accounts pa on pa.id=pt.account_id where pa.client_id=c.id) last_movement_at
    from public.clients c left join lateral(select jsonb_build_object('contractId',mc.id,'startsOn',mc.starts_on,'endsOn',mc.ends_on,'status',mc.status,'planName',mc.plan_name,'contractValue',mc.contract_value,'autoRenew',mc.auto_renew,'updatedAt',mc.updated_at) contract_json from public.management_contracts mc where mc.client_id=c.id order by case when mc.status='active' then 0 when mc.status='paused' then 1 else 2 end,mc.updated_at desc,mc.id desc limit 1) contract_data on true
    where public.is_operational_client_name(c.full_name)
      and (normalized_search is null or c.full_name ilike '%'||normalized_search||'%')
  ),filtered as materialized(select * from base where normalized_status='all' or (normalized_status='contract_pending' and contract_review_status='pending_review') or (normalized_status='cashback_enabled' and cashback_enabled) or (normalized_status='cashback_disabled' and not cashback_enabled) or status::text=normalized_status),paged as(select * from filtered order by full_name,id limit safe_limit offset safe_offset)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'clientId',p.id,'publicId',p.public_id,'fullName',p.full_name,'email',p.email,'phone',p.phone_e164,'status',p.status,'createdAt',p.created_at,'archivedAt',p.archived_at,'archiveReason',p.archive_reason,'contractReviewStatus',p.contract_review_status,'registrationSource',p.registration_source,'rowVersion',p.row_version,'contract',coalesce(p.contract_json,'null'::jsonb),'pointsBalance',p.total_points,'totalPoints',p.total_points,'generatedSavings',p.generated_savings,'programsCount',p.programs_count,'activeClubsCount',p.active_clubs_count,'nextExpirationDate',p.next_expiration_date,'expiringPoints',p.expiring_points,'lastMovementAt',p.last_movement_at,'cashbackEnabled',p.cashback_enabled,'cashbackDefaultPercentage',p.cashback_default_percentage,'cashbackAvailable',p.cashback_available,'cashbackGenerated',p.cashback_generated) order by p.full_name,p.id) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'limit',safe_limit,'offset',safe_offset,'counts',jsonb_build_object('all',(select count(*) from base),'active',(select count(*) from base where status='active'),'leads',(select count(*) from base where status='lead'),'archived',(select count(*) from base where status='ended'),'contractPending',(select count(*) from base where contract_review_status='pending_review'),'cashbackEnabled',(select count(*) from base where cashback_enabled))));
end; $$;

create or replace function public.get_admin_form_options()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'canWrite',public.can_write_client_data(),
    'clients',coalesce((select jsonb_agg(jsonb_build_object(
      'clientId',c.id,'fullName',c.full_name,'accounts',coalesce((select jsonb_agg(jsonb_build_object(
        'accountId',pa.id,'programId',lp.id,'programName',lp.name,'balance',coalesce(latest.balance,0)
      ) order by lp.name) from public.program_accounts pa join public.loyalty_programs lp on lp.id=pa.program_id left join lateral(
        select bs.balance from public.balance_snapshots bs where bs.account_id=pa.id order by bs.captured_at desc,bs.id desc limit 1
      ) latest on true where pa.client_id=c.id and pa.active and lp.active),'[]'::jsonb)
    ) order by c.full_name) from public.clients c
      where c.status='active' and public.is_operational_client_name(c.full_name)),'[]'::jsonb)
  );
end; $$;

revoke all on function public.get_admin_clients(integer,integer,text,text),public.get_admin_form_options() from public,anon;
grant execute on function public.get_admin_clients(integer,integer,text,text),public.get_admin_form_options() to authenticated;

do $$
declare
  v_client_id uuid;
  v_submission public.client_onboarding_submissions%rowtype;
  v_program_id uuid;
  v_account_id uuid;
  v_current_balance bigint;
  v_delta bigint;
  v_has_initial boolean;
  v_default_value numeric(14,4);
begin
  select s.* into v_submission
    from public.client_onboarding_submissions s
   where lower(trim(s.email))='letorress@hotmail.com' and s.cpf_last4='8648'
   order by s.submitted_at desc,s.id desc limit 1;

  select c.id into v_client_id
    from public.clients c
   where lower(c.email::text)='letorress@hotmail.com'
      or (v_submission.id is not null and c.id=v_submission.client_id)
   order by (lower(c.email::text)='letorress@hotmail.com') desc,c.created_at asc limit 1;

  if v_client_id is null then
    v_client_id:='06100000-0000-4000-8000-000000000061'::uuid;
    insert into public.clients(
      id,full_name,display_name,first_name_normalized,email,phone_e164,whatsapp_e164,birth_date,status,
      registration_source,activated_at,contract_review_status,document_ciphertext,document_hash,document_last4,document_kind,notes
    ) values(
      v_client_id,'Letícia Tôrres de Souza','Letícia Tôrres de Souza',public.normalize_first_name('Letícia Tôrres de Souza'),
      'letorress@hotmail.com','+5537998316163','+5537998316163',date '1981-11-01','active','manual',clock_timestamp(),'pending_review',
      case when v_submission.cpf_encrypted is not null and v_submission.cpf_hash is not null and v_submission.cpf_last4='8648' then v_submission.cpf_encrypted end,
      case when v_submission.cpf_encrypted is not null and v_submission.cpf_hash is not null and v_submission.cpf_last4='8648' then v_submission.cpf_hash end,
      case when v_submission.cpf_encrypted is not null and v_submission.cpf_hash is not null and v_submission.cpf_last4='8648' then v_submission.cpf_last4 end,
      case when v_submission.cpf_encrypted is not null and v_submission.cpf_hash is not null and v_submission.cpf_last4='8648' then 'cpf' end,
      'Endereço principal mantido no Cofre Local; completar CEP, cidade e UF para materialização no banco principal.'
    );
  else
    update public.clients c set
      full_name='Letícia Tôrres de Souza',display_name='Letícia Tôrres de Souza',first_name_normalized=public.normalize_first_name('Letícia Tôrres de Souza'),
      email='letorress@hotmail.com',phone_e164='+5537998316163',whatsapp_e164='+5537998316163',birth_date=date '1981-11-01',status='active',
      activated_at=coalesce(c.activated_at,clock_timestamp()),archived_at=null,archived_by=null,archive_reason=null,
      document_ciphertext=coalesce(c.document_ciphertext,case when v_submission.cpf_encrypted is not null and v_submission.cpf_hash is not null and v_submission.cpf_last4='8648' then v_submission.cpf_encrypted end),
      document_hash=coalesce(c.document_hash,case when v_submission.cpf_encrypted is not null and v_submission.cpf_hash is not null and v_submission.cpf_last4='8648' then v_submission.cpf_hash end),
      document_last4=coalesce(c.document_last4,case when v_submission.cpf_encrypted is not null and v_submission.cpf_hash is not null and v_submission.cpf_last4='8648' then v_submission.cpf_last4 end),
      document_kind=coalesce(c.document_kind,case when v_submission.cpf_encrypted is not null and v_submission.cpf_hash is not null and v_submission.cpf_last4='8648' then 'cpf' end),
      updated_at=clock_timestamp(),row_version=c.row_version+1
    where c.id=v_client_id;
  end if;

  if v_submission.id is not null
     and nullif(trim(v_submission.postal_code),'') is not null
     and nullif(trim(v_submission.city),'') is not null
     and nullif(trim(v_submission.state),'') is not null then
    insert into public.client_addresses(client_id,postal_code,street,number,neighborhood,city,state,country_code)
    values(v_client_id,trim(v_submission.postal_code),'Rua Aurora Torquato','1350','Santo Antônio',trim(v_submission.city),upper(trim(v_submission.state)),'BR')
    on conflict(client_id) do update set postal_code=excluded.postal_code,street=excluded.street,number=excluded.number,
      neighborhood=excluded.neighborhood,city=excluded.city,state=excluded.state,country_code='BR',updated_at=clock_timestamp();
  end if;

  for v_program_id in
    select id from public.loyalty_programs where slug in ('latam_pass','smiles','livelo')
  loop
    insert into public.program_accounts(client_id,program_id,membership_number_masked,active)
    select v_client_id,v_program_id,
      case lp.slug when 'latam_pass' then 'l***_1011' when 'livelo' then 'L***_1011' else 'Vínculo confirmado' end,true
    from public.loyalty_programs lp where lp.id=v_program_id
    on conflict(client_id,program_id) do update set membership_number_masked=excluded.membership_number_masked,active=true,updated_at=clock_timestamp();
  end loop;

  select lp.id,lp.default_value_per_thousand into v_program_id,v_default_value
    from public.loyalty_programs lp where lp.slug='livelo';
  select pa.id into v_account_id from public.program_accounts pa where pa.client_id=v_client_id and pa.program_id=v_program_id;
  select coalesce(bs.balance,0) into v_current_balance from public.balance_snapshots bs
    where bs.account_id=v_account_id order by bs.captured_at desc,bs.id desc limit 1;
  if not found then
    select coalesce(sum(pt.points_delta) filter(where coalesce(pt.status,'confirmed')<>'voided'),0)
      into v_current_balance from public.point_transactions pt where pt.account_id=v_account_id;
  end if;
  v_delta:=50000-coalesce(v_current_balance,0);

  if v_delta<>0 and not exists(select 1 from public.point_transactions where operation_id='06100000-0000-4000-8000-000000050000'::uuid) then
    select exists(select 1 from public.point_transactions where account_id=v_account_id and entry_category='initial_balance') into v_has_initial;
    insert into public.point_transactions(
      account_id,occurred_at,transaction_type,points_delta,description,external_reference,source,metadata,
      entry_category,entry_date,valuation_mode,cash_total,cost_per_thousand,operation_id
    ) values(
      v_account_id,clock_timestamp(),'adjustment',v_delta,'Saldo Livelo informado no cadastro PATCH 061','PATCH-061-LETICIA-LIVELO','patch061',
      jsonb_build_object('targetBalance',50000,'idempotentPatch','061'),case when v_has_initial then 'other'::public.point_entry_category else 'initial_balance'::public.point_entry_category end,
      date '2026-09-21','per_thousand',case when v_delta>0 then round((v_delta::numeric/1000)*35,2) end,35,
      '06100000-0000-4000-8000-000000050000'::uuid
    );
    insert into public.balance_snapshots(account_id,captured_at,balance,average_cost_per_thousand,value_per_thousand,source,notes)
    values(v_account_id,clock_timestamp(),50000,35,coalesce(v_default_value,0),'patch061','Saldo cadastrado pelo PATCH 061');
  end if;

  if not exists(select 1 from public.vault_provisioning_outbox o where o.client_id=v_client_id and o.processing_status in ('pending','processing')) then
    insert into public.vault_provisioning_outbox(client_id,display_name,event_type)
    values(v_client_id,'Letícia Tôrres de Souza','client_vault_create');
  end if;
end $$;

notify pgrst,'reload schema';
commit;
