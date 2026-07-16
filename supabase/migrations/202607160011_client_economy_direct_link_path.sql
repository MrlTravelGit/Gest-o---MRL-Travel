-- PATCH MRL 0.4.1 / 005
-- Novo link público direto para economia, sem sessão Supabase do cliente.

create or replace function public.create_client_direct_access_link(
  p_client_id uuid,
  p_expires_at timestamptz default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash text := encode(extensions.digest(token, 'sha256'), 'hex');
  link_row public.client_direct_access_links%rowtype;
begin
  if actor_id is null or not public.can_manage_security() then
    raise exception 'Somente gestores podem gerar links.' using errcode='42501';
  end if;

  if not exists(select 1 from public.clients c where c.id=p_client_id and c.status='active') then
    raise exception 'Cliente ativo não encontrado.' using errcode='P0002';
  end if;

  update public.client_direct_access_links
     set status='revoked',
         revoked_at=clock_timestamp(),
         revoked_by=actor_id
   where client_id=p_client_id
     and status='active';

  insert into public.client_direct_access_links(client_id, token_hash, expires_at, notes, created_by)
  values(p_client_id, token_hash, p_expires_at, nullif(trim(coalesce(p_notes,'')),''), actor_id)
  returning * into link_row;

  insert into public.audit_logs(actor_user_id, client_id, action, table_name, record_id, new_data)
  values(actor_id, p_client_id, 'create_direct_access_link', 'client_direct_access_links', link_row.id::text, jsonb_build_object('expiresAt', p_expires_at, 'pathVersion', 'economia_direct'));

  return jsonb_build_object('linkId', link_row.id, 'token', token, 'path', '/economia/' || token, 'expiresAt', p_expires_at);
end;
$$;

revoke all on function public.create_client_direct_access_link(uuid, timestamptz, text) from public, anon;
grant execute on function public.create_client_direct_access_link(uuid, timestamptz, text) to authenticated;

-- O cliente público não usa sessão Supabase nem RPC autenticada.
revoke all on function public.get_my_client_economy() from public, anon, authenticated;
revoke all on function public.get_my_client_dashboard() from public, anon, authenticated;
revoke all on function public.get_client_dashboard(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
