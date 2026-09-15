begin;

-- Mantém compatibilidade com o PATCH 038 e adota o nome canônico do PATCH 039.
alter table public.mileage_cost_simulations rename to mileage_calculator_simulations;
alter table public.mileage_calculator_simulations rename column source_program_id to origin_program_id;
alter table public.mileage_calculator_simulations rename column target_program_id to destination_program_id;
alter table public.mileage_calculator_simulations rename column simulated_at to created_at;

alter table public.mileage_calculator_simulations
  add column if not exists origin_program_name text,
  add column if not exists destination_program_name text,
  add column if not exists updated_at timestamptz not null default now();

update public.mileage_calculator_simulations s
set origin_program_name=coalesce(s.origin_program_name,origin.name),
    destination_program_name=coalesce(s.destination_program_name,destination.name)
from public.loyalty_programs origin, public.loyalty_programs destination
where origin.id=s.origin_program_id and destination.id=s.destination_program_id
  and (s.origin_program_name is null or s.destination_program_name is null);

alter table public.mileage_calculator_simulations
  alter column origin_program_id drop not null,
  alter column destination_program_id drop not null;

alter index if exists public.mileage_cost_simulations_date_idx rename to mileage_calculator_simulations_date_idx;
alter index if exists public.mileage_cost_simulations_client_idx rename to mileage_calculator_simulations_client_idx;

drop policy if exists mileage_cost_simulations_select_staff on public.mileage_calculator_simulations;
drop policy if exists mileage_cost_simulations_insert_staff on public.mileage_calculator_simulations;
drop policy if exists mileage_calculator_simulations_select_staff on public.mileage_calculator_simulations;
create policy mileage_calculator_simulations_select_staff on public.mileage_calculator_simulations
  for select to authenticated using (public.is_staff());
drop policy if exists mileage_calculator_simulations_insert_staff on public.mileage_calculator_simulations;
create policy mileage_calculator_simulations_insert_staff on public.mileage_calculator_simulations
  for insert to authenticated with check (public.can_write_client_data() and created_by=auth.uid());

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
  actor uuid:=auth.uid();
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
  origin_name text;
  destination_name text;
begin
  if actor is null or not public.can_write_client_data() then raise exception 'Acesso não autorizado' using errcode='42501'; end if;
  if p_total_points is null or p_total_points<=0 then raise exception 'Total de pontos inválido' using errcode='22023'; end if;
  if p_points_used is null or p_points_used<0 or p_points_used>=p_total_points then raise exception 'Pontos usados inválidos' using errcode='22023'; end if;
  if p_cash_amount is null or p_cash_amount<=0 then raise exception 'Valor em dinheiro inválido' using errcode='22023'; end if;
  if p_bonus_percent is null or p_bonus_percent<0 then raise exception 'Bônus inválido' using errcode='22023'; end if;
  if p_pix_discount_percent is not null and (p_pix_discount_percent<0 or p_pix_discount_percent>100) then raise exception 'Desconto Pix inválido' using errcode='22023'; end if;
  if p_source_program_id=p_target_program_id then raise exception 'Origem e destino devem ser diferentes' using errcode='22023'; end if;
  if p_client_id is not null and not exists(select 1 from public.clients c where c.id=p_client_id and c.status='active') then raise exception 'Cliente inválido' using errcode='22023'; end if;
  select lp.name into origin_name from public.loyalty_programs lp where lp.id=p_source_program_id and lp.active and lp.is_transfer_source;
  select lp.name into destination_name from public.loyalty_programs lp where lp.id=p_target_program_id and lp.active and lp.is_transfer_target;
  if origin_name is null then raise exception 'Programa de origem inválido' using errcode='22023'; end if;
  if destination_name is null then raise exception 'Programa de destino inválido' using errcode='22023'; end if;

  purchased_points:=p_total_points-p_points_used;
  purchased_thousands:=purchased_points/1000.0;
  base_cost:=round(p_cash_amount/purchased_thousands,2);
  factor:=1+p_bonus_percent/100.0;
  final_points:=round(p_total_points*factor);
  final_cost:=round(base_cost/factor,2);
  pix_cost:=case when p_pix_discount_percent is null then null else round(final_cost*(1-p_pix_discount_percent/100.0),2) end;
  rated_cost:=coalesce(pix_cost,final_cost);
  result_rating:=case when rated_cost<=18 then 'excellent' when rated_cost<=22 then 'good' when rated_cost<=27 then 'attention' else 'expensive' end;

  insert into public.mileage_calculator_simulations(
    client_id,origin_program_id,destination_program_id,origin_program_name,destination_program_name,
    total_points,points_used,cash_amount,bonus_percent,pix_discount_percent,club_active,
    cash_purchased_points,cash_purchased_thousands,base_cost_per_thousand,bonus_factor,
    final_points_with_bonus,final_cost_per_thousand,final_cost_per_thousand_with_pix,rating,notes,created_by
  ) values (
    p_client_id,p_source_program_id,p_target_program_id,origin_name,destination_name,
    p_total_points,p_points_used,round(p_cash_amount,2),p_bonus_percent,p_pix_discount_percent,coalesce(p_club_active,false),
    purchased_points,purchased_thousands,base_cost,factor,final_points,final_cost,pix_cost,result_rating,
    nullif(trim(coalesce(p_notes,'')),''),actor
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
    'canWrite',public.can_write_client_data(),
    'simulations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'clientId',s.client_id,'clientName',c.full_name,
      'sourceProgramId',s.origin_program_id,'sourceProgramName',coalesce(s.origin_program_name,origin.name),
      'targetProgramId',s.destination_program_id,'targetProgramName',coalesce(s.destination_program_name,destination.name),
      'totalPoints',s.total_points,'pointsUsed',s.points_used,'cashAmount',s.cash_amount,
      'bonusPercent',s.bonus_percent,'pixDiscountPercent',s.pix_discount_percent,'clubActive',s.club_active,
      'finalCostPerThousand',s.final_cost_per_thousand,'finalCostPerThousandWithPix',s.final_cost_per_thousand_with_pix,
      'rating',s.rating,'notes',s.notes,'simulatedAt',s.created_at,'createdByName',p.full_name
    ) order by s.created_at desc)
    from (select * from public.mileage_calculator_simulations order by created_at desc limit 50) s
    left join public.loyalty_programs origin on origin.id=s.origin_program_id
    left join public.loyalty_programs destination on destination.id=s.destination_program_id
    left join public.clients c on c.id=s.client_id
    left join public.profiles p on p.id=s.created_by),'[]'::jsonb)
  );
end;
$$;

notify pgrst,'reload schema';
commit;
