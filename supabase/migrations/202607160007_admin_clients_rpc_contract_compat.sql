-- PATCH MRL 0.3.1
-- Corrige o contrato PostgREST usado pelo painel administrativo em producao.
-- A assinatura abaixo corresponde ao payload observado no erro PGRST202:
-- public.get_admin_clients(p_limit, p_offset, p_search, p_status).

create or replace function public.get_admin_clients(
  p_limit integer default 20,
  p_offset integer default 0,
  p_search text default null,
  p_status text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_admin_clients(p_search, p_status, p_limit, p_offset);
$$;

revoke all on function public.get_admin_clients(integer, integer, text, text) from public, anon;
grant execute on function public.get_admin_clients(integer, integer, text, text) to authenticated;

comment on function public.get_admin_clients(integer, integer, text, text)
is 'Compatibilidade PostgREST para o painel admin: p_limit, p_offset, p_search, p_status.';
