begin;

alter table public.loyalty_programs
  add column if not exists category text not null default 'programas_aereos',
  add column if not exists program_type text not null default 'loyalty_program',
  add column if not exists conversion_label text,
  add column if not exists is_transfer_source boolean not null default false,
  add column if not exists is_transfer_target boolean not null default true;

alter table public.loyalty_programs drop constraint if exists loyalty_programs_category_valid;
alter table public.loyalty_programs add constraint loyalty_programs_category_valid
  check (category in ('bancos','programas_aereos','outros'));

alter table public.loyalty_programs drop constraint if exists loyalty_programs_program_type_valid;
alter table public.loyalty_programs add constraint loyalty_programs_program_type_valid
  check (program_type in ('financial_points_program','loyalty_program'));

update public.loyalty_programs
set is_transfer_target=true,
    category=case when slug in ('livelo','esfera','atomos') then 'bancos' else category end,
    program_type=case when slug in ('livelo','esfera','atomos') then 'financial_points_program' else program_type end,
    is_transfer_source=case when slug in ('livelo','esfera','atomos') then true else is_transfer_source end,
    updated_at=now()
where slug in ('azul_fidelidade','latam_pass','smiles','livelo','esfera','atomos');

insert into public.loyalty_programs
  (slug,name,logo_url,category,program_type,conversion_label,active,is_transfer_source,is_transfer_target)
values
  ('nubank_croma','Nubank Croma','/logos/programs/banks/nubank-croma.svg','bancos','financial_points_program','1 milha a cada 1 ponto Nubank Croma.',true,true,false),
  ('nubank_ultravioleta','Nubank Ultravioleta','/logos/programs/banks/nubank-ultravioleta.svg','bancos','financial_points_program','1 milha a cada 1 ponto Nubank.',true,true,false),
  ('picpay','PicPay','/logos/programs/banks/picpay.svg','bancos','financial_points_program','1 milha a cada R$ 2,00 em compras na Coleção LATAM Pass.',true,true,false),
  ('revolut','Revolut','/logos/programs/banks/revolut.svg','bancos','financial_points_program','1 milha a cada 1 RevPoint.',true,true,false),
  ('btg_pactual','BTG Pactual','/logos/programs/banks/btg-pactual.svg','bancos','financial_points_program','1 milha a cada 1 ponto BTG Pactual.',true,true,false),
  ('livelo','Livelo','/logos/programs/banks/livelo.svg','bancos','financial_points_program','1 milha a cada 1 ponto Livelo.',true,true,true),
  ('itau','Itaú','/logos/programs/banks/itau.svg','bancos','financial_points_program','1 milha a cada 1 ponto Itaú.',true,true,false),
  ('esfera','Esfera','/logos/programs/banks/esfera.svg','bancos','financial_points_program','1 milha a cada 1 ponto Esfera.',true,true,true),
  ('astropay','AstroPay','/logos/programs/banks/astropay.svg','bancos','financial_points_program','5 milhas a cada 1 USD ou 1 EUR.',true,true,false),
  ('bradesco_cartoes','Bradesco Cartões','/logos/programs/banks/bradesco-cartoes.svg','bancos','financial_points_program','1 milha a cada 1 ponto Livelo.',true,true,false),
  ('banco_do_brasil','Banco do Brasil','/logos/programs/banks/banco-do-brasil.svg','bancos','financial_points_program','1 milha a cada 1 ponto BB Livelo.',true,true,false),
  ('uau_caixa','UAU Caixa','/logos/programs/banks/uau-caixa.svg','bancos','financial_points_program','1 milha a cada 1 ponto UAU Caixa.',true,true,false),
  ('coopera','Coopera','/logos/programs/banks/coopera.svg','bancos','financial_points_program','1 milha a cada 1 ponto Coopera.',true,true,false),
  ('sicredi','Sicredi','/logos/programs/banks/sicredi.svg','bancos','financial_points_program','1 milha a cada 1 ponto Sicredi.',true,true,false),
  ('banriclube','Banriclube','/logos/programs/banks/banriclube.svg','bancos','financial_points_program','1 milha a cada 1 ponto Banriclube.',true,true,false),
  ('banco_do_nordeste','Banco do Nordeste','/logos/programs/banks/banco-do-nordeste.svg','bancos','financial_points_program','1 milha a cada 1 ponto Banco do Nordeste.',true,true,false),
  ('banpara','Banpará','/logos/programs/banks/banpara.svg','bancos','financial_points_program','1 milha a cada 1 ponto Banpará.',true,true,false),
  ('banco_pan','Banco PAN','/logos/programs/banks/banco-pan.svg','bancos','financial_points_program','1 milha a cada 1 ponto PAN.',true,true,false),
  ('sisprime','Sisprime','/logos/programs/banks/sisprime.svg','bancos','financial_points_program','1 milha a cada 1 ponto Sisprime.',true,true,false),
  ('credicard','Credicard','/logos/programs/banks/credicard.svg','bancos','financial_points_program','1 milha a cada 1 ponto Credicard Exclusive.',true,true,false),
  ('banestes','Banestes','/logos/programs/banks/banestes.png','bancos','financial_points_program','1 milha a cada 1 ponto Banestes.',true,true,false),
  ('porto_bank','Porto Bank','/logos/programs/banks/porto-bank.svg','bancos','financial_points_program','1 milha a cada 1 ponto PortoPlus.',true,true,false),
  ('brb_card','BRB Card','/logos/programs/banks/brb-card.svg','bancos','financial_points_program','1 milha a cada 1 ponto BRB Card.',true,true,false),
  ('banco_mercantil','Banco Mercantil','/logos/programs/banks/banco-mercantil.svg','bancos','financial_points_program','1 milha a cada 1 ponto Sempre Mais.',true,true,false),
  ('unicred','Unicred','/logos/programs/banks/unicred.svg','bancos','financial_points_program','1 milha a cada 1 ponto Unicred.',true,true,false),
  ('credicoamo','Credicoamo','/logos/programs/banks/credicoamo.png','bancos','financial_points_program','1 milha a cada 1 ponto Credicoamo.',true,true,false)
on conflict (slug) do update set
  name=excluded.name,
  logo_url=excluded.logo_url,
  category=excluded.category,
  program_type=excluded.program_type,
  conversion_label=excluded.conversion_label,
  active=true,
  is_transfer_source=true,
  is_transfer_target=case when public.loyalty_programs.slug in ('livelo','esfera') then true else public.loyalty_programs.is_transfer_target end,
  updated_at=now();

update public.loyalty_programs set logo_url=case slug
  when 'btg_pactual' then '/logos/programs/banks/btg-pactual.png'
  when 'itau' then '/logos/programs/banks/itau.png'
  when 'astropay' then '/logos/programs/banks/astropay.png'
  when 'bradesco_cartoes' then '/logos/programs/banks/bradesco-cartoes.png'
  when 'banco_do_brasil' then '/logos/programs/banks/banco-do-brasil.png'
  when 'coopera' then '/logos/programs/banks/coopera.png'
  when 'sicredi' then '/logos/programs/banks/sicredi.png'
  when 'banriclube' then '/logos/programs/banks/banriclube.png'
  when 'banco_pan' then '/logos/programs/banks/banco-pan.png'
  when 'sisprime' then '/logos/programs/banks/sisprime.png'
  when 'brb_card' then '/logos/programs/banks/brb-card.png'
  when 'unicred' then '/logos/programs/banks/unicred.png'
  else logo_url end,
  updated_at=now()
where slug in ('btg_pactual','itau','astropay','bradesco_cartoes','banco_do_brasil','coopera','sicredi','banriclube','banco_pan','sisprime','brb_card','unicred');

create table if not exists public.bonus_transfer_campaigns (
  id uuid primary key default gen_random_uuid(),
  source_program_id uuid not null references public.loyalty_programs(id) on delete restrict,
  target_program_id uuid not null references public.loyalty_programs(id) on delete restrict,
  bonus_percentage numeric(8,4) not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  minimum_points bigint,
  maximum_points bigint,
  rules_summary text not null,
  official_url text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bonus_campaign_programs_different check (source_program_id<>target_program_id),
  constraint bonus_campaign_percentage_valid check (bonus_percentage>=0 and bonus_percentage<=1000),
  constraint bonus_campaign_dates_valid check (ends_at>=starts_at),
  constraint bonus_campaign_points_valid check (minimum_points is null or minimum_points>=0),
  constraint bonus_campaign_max_points_valid check (maximum_points is null or maximum_points>=coalesce(minimum_points,0)),
  constraint bonus_campaign_rules_present check (char_length(trim(rules_summary))>=3),
  constraint bonus_campaign_url_valid check (official_url is null or official_url ~ '^https://')
);

create index if not exists bonus_transfer_campaigns_period_idx on public.bonus_transfer_campaigns(is_active,starts_at,ends_at);
create index if not exists bonus_transfer_campaigns_source_idx on public.bonus_transfer_campaigns(source_program_id);
alter table public.bonus_transfer_campaigns enable row level security;
alter table public.bonus_transfer_campaigns force row level security;

drop policy if exists bonus_transfer_campaigns_select_staff on public.bonus_transfer_campaigns;
create policy bonus_transfer_campaigns_select_staff on public.bonus_transfer_campaigns for select to authenticated using (public.is_staff());
drop policy if exists bonus_transfer_campaigns_manage_staff on public.bonus_transfer_campaigns;
create policy bonus_transfer_campaigns_manage_staff on public.bonus_transfer_campaigns for all to authenticated
  using (public.can_write_client_data()) with check (public.can_write_client_data());

create or replace function public.get_bonus_transfer_admin()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'canWrite',public.can_write_client_data(),
    'programs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',lp.id,'slug',lp.slug,'name',lp.name,'category',lp.category,'programType',lp.program_type,
      'logoUrl',lp.logo_url,'conversionLabel',lp.conversion_label,'isTransferSource',lp.is_transfer_source,
      'isTransferTarget',lp.is_transfer_target,'isActive',lp.active
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

create or replace function public.upsert_bonus_transfer_campaign(
  p_campaign_id uuid,p_source_program_id uuid,p_target_program_id uuid,p_bonus_percentage numeric,
  p_starts_at timestamptz,p_ends_at timestamptz,p_minimum_points bigint,p_maximum_points bigint,
  p_rules_summary text,p_official_url text,p_is_active boolean
)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); result_id uuid; source_ok boolean; target_ok boolean;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  select lp.active and lp.is_transfer_source into source_ok from public.loyalty_programs lp where lp.id=p_source_program_id;
  select lp.active and lp.is_transfer_target into target_ok from public.loyalty_programs lp where lp.id=p_target_program_id;
  if not coalesce(source_ok,false) then raise exception 'Programa de origem inválido' using errcode='22023'; end if;
  if not coalesce(target_ok,false) then raise exception 'Programa de destino inválido' using errcode='22023'; end if;
  if p_campaign_id is null then
    insert into public.bonus_transfer_campaigns(source_program_id,target_program_id,bonus_percentage,starts_at,ends_at,minimum_points,maximum_points,rules_summary,official_url,is_active,created_by,updated_by)
    values(p_source_program_id,p_target_program_id,p_bonus_percentage,p_starts_at,p_ends_at,p_minimum_points,p_maximum_points,trim(p_rules_summary),nullif(trim(coalesce(p_official_url,'')),''),coalesce(p_is_active,true),actor,actor)
    returning id into result_id;
  else
    update public.bonus_transfer_campaigns set source_program_id=p_source_program_id,target_program_id=p_target_program_id,
      bonus_percentage=p_bonus_percentage,starts_at=p_starts_at,ends_at=p_ends_at,minimum_points=p_minimum_points,
      maximum_points=p_maximum_points,rules_summary=trim(p_rules_summary),official_url=nullif(trim(coalesce(p_official_url,'')),''),
      is_active=coalesce(p_is_active,true),updated_by=actor,updated_at=clock_timestamp()
    where id=p_campaign_id returning id into result_id;
    if result_id is null then raise exception 'Campanha não encontrada' using errcode='P0002'; end if;
  end if;
  return result_id;
end; $$;

create or replace function public.update_financial_program_conversion(p_program_id uuid,p_conversion_label text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.can_write_client_data() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if char_length(trim(coalesce(p_conversion_label,'')))<3 then raise exception 'Informe a regra de conversão' using errcode='22023'; end if;
  update public.loyalty_programs set conversion_label=trim(p_conversion_label),updated_at=clock_timestamp()
  where id=p_program_id and program_type='financial_points_program';
  if not found then raise exception 'Programa financeiro não encontrado' using errcode='P0002'; end if;
end; $$;

create or replace function public.get_admin_client_dashboard_preview(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id=p_client_id and status='active') then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  return public.build_public_client_dashboard_payload(p_client_id)||jsonb_build_object('savingsHistory',public.build_public_client_savings_history(p_client_id),'cashback',public.build_public_client_cashback(p_client_id));
end; $$;

revoke all on function public.get_bonus_transfer_admin() from public,anon;
revoke all on function public.upsert_bonus_transfer_campaign(uuid,uuid,uuid,numeric,timestamptz,timestamptz,bigint,bigint,text,text,boolean) from public,anon;
revoke all on function public.update_financial_program_conversion(uuid,text) from public,anon;
grant execute on function public.get_bonus_transfer_admin() to authenticated;
grant execute on function public.upsert_bonus_transfer_campaign(uuid,uuid,uuid,numeric,timestamptz,timestamptz,bigint,bigint,text,text,boolean) to authenticated;
grant execute on function public.update_financial_program_conversion(uuid,text) to authenticated;
revoke all on function public.get_admin_client_dashboard_preview(uuid) from public,anon;
grant execute on function public.get_admin_client_dashboard_preview(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
