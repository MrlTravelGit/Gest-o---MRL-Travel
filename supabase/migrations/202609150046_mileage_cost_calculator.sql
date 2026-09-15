begin;

create table if not exists public.mileage_cost_simulations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  source_program_id uuid not null references public.loyalty_programs(id) on delete restrict,
  target_program_id uuid not null references public.loyalty_programs(id) on delete restrict,
  total_points bigint not null,
  points_used bigint not null default 0,
  cash_amount numeric(14,2) not null,
  bonus_percent numeric(8,4) not null default 0,
  pix_discount_percent numeric(6,3),
  club_active boolean not null default false,
  cash_purchased_points bigint not null,
  cash_purchased_thousands numeric(16,3) not null,
  base_cost_per_thousand numeric(14,2) not null,
  bonus_factor numeric(10,4) not null,
  final_points_with_bonus bigint not null,
  final_cost_per_thousand numeric(14,2) not null,
  final_cost_per_thousand_with_pix numeric(14,2),
  rating text not null,
  notes text,
  simulated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint mileage_simulation_programs_different check (source_program_id <> target_program_id),
  constraint mileage_simulation_total_positive check (total_points > 0),
  constraint mileage_simulation_used_valid check (points_used >= 0 and points_used < total_points),
  constraint mileage_simulation_cash_positive check (cash_amount > 0),
  constraint mileage_simulation_bonus_valid check (bonus_percent >= 0),
  constraint mileage_simulation_pix_valid check (pix_discount_percent is null or pix_discount_percent between 0 and 100),
  constraint mileage_simulation_rating_valid check (rating in ('excellent','good','attention','expensive')),
  constraint mileage_simulation_notes_length check (notes is null or char_length(notes) <= 2000)
);

create index if not exists mileage_cost_simulations_date_idx on public.mileage_cost_simulations(simulated_at desc);
create index if not exists mileage_cost_simulations_client_idx on public.mileage_cost_simulations(client_id, simulated_at desc);

alter table public.mileage_cost_simulations enable row level security;
alter table public.mileage_cost_simulations force row level security;

drop policy if exists mileage_cost_simulations_select_staff on public.mileage_cost_simulations;
create policy mileage_cost_simulations_select_staff on public.mileage_cost_simulations
  for select to authenticated using (public.is_staff());

drop policy if exists mileage_cost_simulations_insert_staff on public.mileage_cost_simulations;
create policy mileage_cost_simulations_insert_staff on public.mileage_cost_simulations
  for insert to authenticated with check (public.can_write_client_data() and created_by = auth.uid());

create or replace function public.save_mileage_cost_simulation(
  p_client_id uuid,
  p_source_program_id uuid,
  p_target_program_id uuid,
  p_total_points bigint,
  p_points_used bigint,
  p_cash_amount numeric,
  p_bonus_percent numeric,
  p_pix_discount_percent numeric,
  p_club_active boolean,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  actor uuid := auth.uid();
  result_id uuid;
  purchased_points bigint;
  purchased_thousands numeric;
  base_cost numeric;
  factor numeric;
  final_points bigint;
  final_cost numeric;
  pix_cost numeric;
  rated_cost numeric;
  result_rating text;
begin
  if actor is null or not public.can_write_client_data() then
    raise exception 'Acesso não autorizado' using errcode='42501';
  end if;
  if p_total_points is null or p_total_points <= 0 then raise exception 'Total de pontos inválido' using errcode='22023'; end if;
  if p_points_used is null or p_points_used < 0 or p_points_used >= p_total_points then raise exception 'Pontos usados inválidos' using errcode='22023'; end if;
  if p_cash_amount is null or p_cash_amount <= 0 then raise exception 'Valor em dinheiro inválido' using errcode='22023'; end if;
  if p_bonus_percent is null or p_bonus_percent < 0 then raise exception 'Bônus inválido' using errcode='22023'; end if;
  if p_pix_discount_percent is not null and (p_pix_discount_percent < 0 or p_pix_discount_percent > 100) then raise exception 'Desconto Pix inválido' using errcode='22023'; end if;
  if p_source_program_id = p_target_program_id then raise exception 'Origem e destino devem ser diferentes' using errcode='22023'; end if;
  if p_client_id is not null and not exists(select 1 from public.clients c where c.id=p_client_id and c.status='active') then raise exception 'Cliente inválido' using errcode='22023'; end if;
  if not exists(select 1 from public.loyalty_programs lp where lp.id=p_source_program_id and lp.active and lp.is_transfer_source) then raise exception 'Programa de origem inválido' using errcode='22023'; end if;
  if not exists(select 1 from public.loyalty_programs lp where lp.id=p_target_program_id and lp.active and lp.is_transfer_target) then raise exception 'Programa de destino inválido' using errcode='22023'; end if;

  purchased_points := p_total_points - p_points_used;
  purchased_thousands := purchased_points / 1000.0;
  base_cost := round(p_cash_amount / purchased_thousands, 2);
  factor := 1 + p_bonus_percent / 100.0;
  final_points := round(p_total_points * factor);
  final_cost := round(base_cost / factor, 2);
  pix_cost := case when p_pix_discount_percent is null then null else round(final_cost * (1 - p_pix_discount_percent / 100.0), 2) end;
  rated_cost := coalesce(pix_cost, final_cost);
  result_rating := case when rated_cost <= 18 then 'excellent' when rated_cost <= 22 then 'good' when rated_cost <= 27 then 'attention' else 'expensive' end;

  insert into public.mileage_cost_simulations (
    client_id,source_program_id,target_program_id,total_points,points_used,cash_amount,bonus_percent,
    pix_discount_percent,club_active,cash_purchased_points,cash_purchased_thousands,base_cost_per_thousand,
    bonus_factor,final_points_with_bonus,final_cost_per_thousand,final_cost_per_thousand_with_pix,
    rating,notes,created_by
  ) values (
    p_client_id,p_source_program_id,p_target_program_id,p_total_points,p_points_used,round(p_cash_amount,2),p_bonus_percent,
    p_pix_discount_percent,coalesce(p_club_active,false),purchased_points,purchased_thousands,base_cost,
    factor,final_points,final_cost,pix_cost,result_rating,nullif(trim(coalesce(p_notes,'')),''),actor
  ) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.get_mileage_calculator_admin()
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
begin
  if auth.uid() is null or not public.is_staff() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  return jsonb_build_object(
    'canWrite', public.can_write_client_data(),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('clientId',c.id,'fullName',c.full_name) order by c.full_name) from public.clients c where c.status='active'),'[]'::jsonb),
    'programs', coalesce((select jsonb_agg(jsonb_build_object(
      'id',lp.id,'slug',lp.slug,'name',lp.name,'category',lp.category,'programType',lp.program_type,
      'logoUrl',lp.logo_url,'conversionLabel',lp.conversion_label,'isTransferSource',lp.is_transfer_source,
      'isTransferTarget',lp.is_transfer_target,'isActive',lp.active
    ) order by lp.category,lp.name) from public.loyalty_programs lp where lp.active and (lp.is_transfer_source or lp.is_transfer_target)),'[]'::jsonb),
    'simulations', coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'clientId',s.client_id,'clientName',c.full_name,'sourceProgramId',s.source_program_id,
      'sourceProgramName',source.name,'targetProgramId',s.target_program_id,'targetProgramName',target.name,
      'totalPoints',s.total_points,'pointsUsed',s.points_used,'cashAmount',s.cash_amount,'bonusPercent',s.bonus_percent,
      'pixDiscountPercent',s.pix_discount_percent,'clubActive',s.club_active,'finalCostPerThousand',s.final_cost_per_thousand,
      'finalCostPerThousandWithPix',s.final_cost_per_thousand_with_pix,'rating',s.rating,'notes',s.notes,
      'simulatedAt',s.simulated_at,'createdByName',p.full_name
    ) order by s.simulated_at desc) from (select * from public.mileage_cost_simulations order by simulated_at desc limit 50) s
      join public.loyalty_programs source on source.id=s.source_program_id
      join public.loyalty_programs target on target.id=s.target_program_id
      left join public.clients c on c.id=s.client_id
      left join public.profiles p on p.id=s.created_by),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_mileage_cost_simulation(uuid,uuid,uuid,bigint,bigint,numeric,numeric,numeric,boolean,text) from public,anon;
revoke all on function public.get_mileage_calculator_admin() from public,anon;
grant execute on function public.save_mileage_cost_simulation(uuid,uuid,uuid,bigint,bigint,numeric,numeric,numeric,boolean,text) to authenticated;
grant execute on function public.get_mileage_calculator_admin() to authenticated;

notify pgrst,'reload schema';
commit;
