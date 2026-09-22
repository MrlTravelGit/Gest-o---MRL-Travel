begin;

-- Preserve the audited travel-sale engine and add a thin validation contract
-- that returns structured, actionable details without weakening its locks.
do $$
begin
  if to_regprocedure('public.record_travel_sale_legacy_062(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid,numeric)') is null then
    alter function public.record_travel_sale(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid,numeric)
      rename to record_travel_sale_legacy_062;
  end if;
end $$;

create or replace function public.record_travel_sale(
  p_client_id uuid,p_launched_on date,p_payment_mode text,p_travel_type public.redemption_type,p_details text,
  p_original_value numeric,p_paid_value numeric,p_account_id uuid default null,p_points_used bigint default null,
  p_operation_id uuid default gen_random_uuid(),p_cashback_percentage numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  actor uuid:=auth.uid();
  locked_account_id uuid;
  program_name text;
  available_points bigint:=0;
begin
  if actor is null or not public.can_write_client_data() then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;

  if p_payment_mode='miles' and p_account_id is not null and p_points_used is not null and p_points_used>0 then
    select pa.id,lp.name into locked_account_id,program_name
      from public.program_accounts pa
      join public.loyalty_programs lp on lp.id=pa.program_id
     where pa.id=p_account_id and pa.client_id=p_client_id and pa.active
     for update of pa;

    if locked_account_id is not null then
      select coalesce(bs.balance,0) into available_points
        from public.balance_snapshots bs
       where bs.account_id=locked_account_id
       order by bs.captured_at desc,bs.id desc
       limit 1;
      if not found then available_points:=0; end if;

      if p_points_used>available_points then
        raise exception 'INSUFFICIENT_POINTS'
          using errcode='23514',
                detail=jsonb_build_object(
                  'code','INSUFFICIENT_POINTS',
                  'program_name',program_name,
                  'available_points',available_points,
                  'requested_points',p_points_used
                )::text;
      end if;
    end if;
  end if;

  return public.record_travel_sale_legacy_062(
    p_client_id,p_launched_on,p_payment_mode,p_travel_type,p_details,
    p_original_value,p_paid_value,p_account_id,p_points_used,p_operation_id,p_cashback_percentage
  );
end;
$$;

revoke all on function public.record_travel_sale_legacy_062(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid,numeric) from public,anon,authenticated;
revoke all on function public.record_travel_sale(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid,numeric) from public,anon;
grant execute on function public.record_travel_sale(uuid,date,text,public.redemption_type,text,numeric,numeric,uuid,bigint,uuid,numeric) to authenticated;

notify pgrst,'reload schema';
commit;
