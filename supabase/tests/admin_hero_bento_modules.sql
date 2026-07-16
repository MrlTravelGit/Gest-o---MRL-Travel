CREATE OR REPLACE FUNCTION public.get_admin_clients(p_limit integer = 20
                                                  , p_offset integer = 0
                                                  , p_search text = NULL
                                                  , p_status text = NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select public.get_admin_clients(p_search, p_status, p_limit, p_offset);
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.get_admin_clients (integer, integer, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE
  ON FUNCTION public.get_admin_clients (integer, integer, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_clients (integer, integer, text, text)
  IS 'Compatibilidade PostgREST para o painel admin: p_limit, p_offset, p_search, p_status.'
