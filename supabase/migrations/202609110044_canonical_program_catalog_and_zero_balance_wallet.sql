begin;

-- loyalty_programs is the single source of truth. The legacy columns remain as
-- compatibility aliases while callers migrate to the explicit capabilities.
alter table public.loyalty_programs
  add column if not exists supports_points_launch boolean not null default true,
  add column if not exists supports_bonus_transfer boolean not null default false,
  add column if not exists logo_path text;

alter table public.loyalty_programs drop constraint if exists loyalty_slug_format;
alter table public.loyalty_programs add constraint loyalty_slug_format
  check (slug ~ '^[a-z0-9]+([_-][a-z0-9]+)*$');

create or replace function public.sync_loyalty_program_logo_paths()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    new.logo_path:=coalesce(new.logo_path,new.logo_url);
    new.logo_url:=coalesce(new.logo_path,new.logo_url);
  elsif new.logo_path is distinct from old.logo_path then
    new.logo_url:=new.logo_path;
  elsif new.logo_url is distinct from old.logo_url then
    new.logo_path:=new.logo_url;
  end if;
  return new;
end; $$;

drop trigger if exists sync_loyalty_program_logo_paths_trigger on public.loyalty_programs;
create trigger sync_loyalty_program_logo_paths_trigger before insert or update of logo_path,logo_url
on public.loyalty_programs for each row execute function public.sync_loyalty_program_logo_paths();

update public.loyalty_programs set logo_path=logo_url where logo_path is null and logo_url is not null;

do $$
declare
  item record;
  existing_id uuid;
begin
  for item in
    select * from (values
      ('nubank-croma','Nubank Croma','/logos/programs/banks/nubank-croma.svg','1 milha a cada 1 ponto Nubank Croma.',false),
      ('nubank-ultravioleta','Nubank Ultravioleta','/logos/programs/banks/nubank-ultravioleta.svg','1 milha a cada 1 ponto Nubank.',false),
      ('picpay','PicPay','/logos/programs/banks/picpay.svg','1 milha a cada R$ 2,00 em compras na Coleção LATAM Pass.',false),
      ('revolut','Revolut','/logos/programs/banks/revolut.svg','1 milha a cada 1 RevPoint.',false),
      ('btg-pactual','BTG Pactual','/logos/programs/banks/btg-pactual.png','1 milha a cada 1 ponto BTG Pactual.',false),
      ('livelo','Livelo','/logos/programs/banks/livelo.svg','1 milha a cada 1 ponto Livelo.',true),
      ('itau','Itaú','/logos/programs/banks/itau.png','1 milha a cada 1 ponto Itaú.',false),
      ('esfera','Esfera','/logos/programs/banks/esfera.svg','1 milha a cada 1 ponto Esfera.',true),
      ('astropay','AstroPay','/logos/programs/banks/astropay.png','5 milhas a cada 1 USD ou 1 EUR.',false),
      ('bradesco-cartoes','Bradesco Cartões','/logos/programs/banks/bradesco-cartoes.png','1 milha a cada 1 ponto Livelo.',false),
      ('banco-do-brasil','Banco do Brasil','/logos/programs/banks/banco-do-brasil.png','1 milha a cada 1 ponto BB Livelo.',false),
      ('uau-caixa','UAU Caixa','/logos/programs/banks/uau-caixa.svg','1 milha a cada 1 ponto UAU Caixa.',false),
      ('coopera','Coopera','/logos/programs/banks/coopera.png','1 milha a cada 1 ponto Coopera.',false),
      ('sicredi','Sicredi','/logos/programs/banks/sicredi.png','1 milha a cada 1 ponto Sicredi.',false),
      ('banriclube','Banriclube','/logos/programs/banks/banriclube.png','1 milha a cada 1 ponto Banriclube.',false),
      ('banco-do-nordeste','Banco do Nordeste','/logos/programs/banks/banco-do-nordeste.svg','1 milha a cada 1 ponto Banco do Nordeste.',false),
      ('banpara','Banpará','/logos/programs/banks/banpara.svg','1 milha a cada 1 ponto Banpará.',false),
      ('banco-pan','Banco PAN','/logos/programs/banks/banco-pan.png','1 milha a cada 1 ponto PAN.',false),
      ('sisprime','Sisprime','/logos/programs/banks/sisprime.png','1 milha a cada 1 ponto Sisprime.',false),
      ('credicard','Credicard','/logos/programs/banks/credicard.svg','1 milha a cada 1 ponto Credicard Exclusive.',false),
      ('banestes','Banestes','/logos/programs/banks/banestes.png','1 milha a cada 1 ponto Banestes.',false),
      ('porto-bank','Porto Bank','/logos/programs/banks/porto-bank.svg','1 milha a cada 1 ponto PortoPlus.',false),
      ('brb-card','BRB Card','/logos/programs/banks/brb-card.png','1 milha a cada 1 ponto BRB Card.',false),
      ('banco-mercantil','Banco Mercantil','/logos/programs/banks/banco-mercantil.svg','1 milha a cada 1 ponto Sempre Mais.',false),
      ('unicred','Unicred','/logos/programs/banks/unicred.png','1 milha a cada 1 ponto Unicred.',false),
      ('credicoamo','Credicoamo','/logos/programs/banks/credicoamo.png','1 milha a cada 1 ponto Credicoamo.',false)
    ) as catalog(slug,name,logo_path,conversion_label,is_transfer_target)
  loop
    existing_id:=null;
    select lp.id into existing_id
    from public.loyalty_programs lp
    where lp.slug=item.slug
       or replace(lp.slug,'_','-')=item.slug
       or lower(trim(lp.name))=lower(item.name)
    order by case when lp.slug=item.slug then 0 when lower(trim(lp.name))=lower(item.name) then 1 else 2 end,lp.created_at,lp.id
    limit 1;

    if existing_id is null then
      insert into public.loyalty_programs
        (slug,name,logo_url,logo_path,category,program_type,conversion_label,active,
         supports_points_launch,supports_bonus_transfer,is_transfer_source,is_transfer_target)
      values
        (item.slug,item.name,item.logo_path,item.logo_path,'bancos','financial_points_program',item.conversion_label,true,
         true,true,true,item.is_transfer_target);
    else
      update public.loyalty_programs set
        slug=item.slug,name=item.name,logo_path=item.logo_path,category='bancos',program_type='financial_points_program',
        conversion_label=item.conversion_label,active=true,supports_points_launch=true,supports_bonus_transfer=true,
        is_transfer_source=true,is_transfer_target=item.is_transfer_target,updated_at=clock_timestamp()
      where id=existing_id;
    end if;
  end loop;
end $$;

-- Airline programs are valid transfer destinations, but are never mixed into
-- the financial-source filter.
update public.loyalty_programs set
  supports_points_launch=true,
  supports_bonus_transfer=true,
  is_transfer_target=true,
  updated_at=clock_timestamp()
where slug in ('azul_fidelidade','latam_pass','smiles');

create or replace function public.build_active_program_wallet(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug',lp.slug,
    'name',lp.name,
    'logoUrl',coalesce(lp.logo_path,lp.logo_url),
    'balance',coalesce(latest.balance,0),
    'averageCostPerThousand',coalesce(latest.average_cost_per_thousand,0),
    'estimatedValue',coalesce(latest.estimated_value,0),
    'capturedAt',latest.captured_at,
    'expiringPoints',coalesce((select sum(el.remaining_points) from public.expiration_lots el
      where el.account_id=pa.id and el.status='active' and el.remaining_points>0
        and el.expires_on between current_date and current_date+90),0),
    'catalogActive',lp.active,
    'hasMovements',exists(
      select 1 from public.point_transactions pt
      where pt.account_id=pa.id and coalesce(pt.status,'confirmed')<>'voided'
    )
  ) order by lp.name),'[]'::jsonb)
  from public.loyalty_programs lp
  left join public.program_accounts pa on pa.program_id=lp.id and pa.client_id=p_client_id and pa.active
  left join lateral(
    select bs.balance,bs.average_cost_per_thousand,bs.estimated_value,bs.captured_at
    from public.balance_snapshots bs where bs.account_id=pa.id
    order by bs.captured_at desc,bs.id desc limit 1
  ) latest on true
  where lp.active and lp.supports_points_launch;
$$;

create or replace function public.get_bonus_transfer_admin()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'canWrite',public.can_write_client_data(),
    'programs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',lp.id,'slug',lp.slug,'name',lp.name,'category',lp.category,'programType',lp.program_type,
      'logoUrl',coalesce(lp.logo_path,lp.logo_url),'conversionLabel',lp.conversion_label,
      'supportsPointsLaunch',lp.supports_points_launch,'supportsBonusTransfer',lp.supports_bonus_transfer,
      'isTransferSource',lp.is_transfer_source and lp.supports_bonus_transfer,
      'isTransferTarget',lp.is_transfer_target and lp.supports_bonus_transfer,'isActive',lp.active
    ) order by lp.category,lp.name) from public.loyalty_programs lp where lp.active),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'sourceProgramId',c.source_program_id,'sourceProgramName',source.name,
      'targetProgramId',c.target_program_id,'targetProgramName',target.name,'bonusPercentage',c.bonus_percentage,
      'startsAt',c.starts_at,'endsAt',c.ends_at,'minimumPoints',c.minimum_points,'maximumPoints',c.maximum_points,
      'rulesSummary',c.rules_summary,'officialUrl',c.official_url,'isActive',c.is_active,
      'createdAt',c.created_at,'updatedAt',c.updated_at
    ) order by c.is_active desc,c.starts_at desc,c.created_at desc)
    from public.bonus_transfer_campaigns c
    join public.loyalty_programs source on source.id=c.source_program_id
    join public.loyalty_programs target on target.id=c.target_program_id),'[]'::jsonb)
  );
end; $$;

-- Preserve the complete, already-audited payload implementation and only
-- replace its wallet branch with the canonical zero-balance wallet.
do $$
begin
  if to_regprocedure('public.build_public_client_dashboard_payload_legacy(uuid)') is null then
    alter function public.build_public_client_dashboard_payload(uuid) rename to build_public_client_dashboard_payload_legacy;
  end if;
end $$;

create or replace function public.build_public_client_dashboard_payload(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select public.build_public_client_dashboard_payload_legacy(p_client_id)
    || jsonb_build_object('programs',public.build_active_program_wallet(p_client_id));
$$;

create or replace function public.get_admin_client_dashboard_preview(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id=p_client_id and status='active') then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  return public.build_public_client_dashboard_payload(p_client_id)
    || jsonb_build_object('savingsHistory',public.build_public_client_savings_history(p_client_id),'cashback',public.build_public_client_cashback(p_client_id));
end; $$;

-- Enforce the same catalog capability when a new zero-balance program is
-- selected from the launch form, while retaining the atomic legacy engine.
do $$
begin
  if to_regprocedure('public.record_point_entry_legacy(uuid,uuid,public.point_entry_category,date,bigint,text,numeric,date,text,uuid)') is null then
    alter function public.record_point_entry(uuid,uuid,public.point_entry_category,date,bigint,text,numeric,date,text,uuid)
      rename to record_point_entry_legacy;
  end if;
end $$;

create or replace function public.record_point_entry(
  p_client_id uuid,p_program_id uuid,p_entry_category public.point_entry_category,p_entry_date date,
  p_points_amount bigint,p_valuation_mode text,p_entered_value numeric,p_expires_on date default null,
  p_notes text default null,p_operation_id uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.loyalty_programs lp
    where lp.id=p_program_id and lp.active and lp.supports_points_launch) then
    raise exception 'Selecione um programa ativo para lançamento.' using errcode='P0002';
  end if;
  return public.record_point_entry_legacy(p_client_id,p_program_id,p_entry_category,p_entry_date,
    p_points_amount,p_valuation_mode,p_entered_value,p_expires_on,p_notes,p_operation_id);
end; $$;

revoke all on function public.build_active_program_wallet(uuid) from public,anon,authenticated;
revoke all on function public.sync_loyalty_program_logo_paths() from public,anon,authenticated;
revoke all on function public.build_public_client_dashboard_payload(uuid) from public,anon,authenticated;
revoke all on function public.build_public_client_dashboard_payload_legacy(uuid) from public,anon,authenticated;
grant execute on function public.build_public_client_dashboard_payload(uuid) to service_role;
revoke all on function public.get_admin_client_dashboard_preview(uuid) from public,anon;
grant execute on function public.get_admin_client_dashboard_preview(uuid) to authenticated;
revoke all on function public.get_bonus_transfer_admin() from public,anon;
grant execute on function public.get_bonus_transfer_admin() to authenticated;
revoke all on function public.record_point_entry_legacy(uuid,uuid,public.point_entry_category,date,bigint,text,numeric,date,text,uuid) from public,anon,authenticated;
grant execute on function public.record_point_entry(uuid,uuid,public.point_entry_category,date,bigint,text,numeric,date,text,uuid) to authenticated;
revoke all on function public.record_point_entry(uuid,uuid,public.point_entry_category,date,bigint,text,numeric,date,text,uuid) from public,anon;

notify pgrst,'reload schema';
commit;
