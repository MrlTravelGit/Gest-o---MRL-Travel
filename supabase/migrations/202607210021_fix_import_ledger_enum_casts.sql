begin;

-- A migration 019 já está aplicada no projeto remoto e permanece imutável.
-- PostgreSQL 17 exige coerção explícita do CASE textual para o enum financeiro.
do $migration$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('public.admin_commit_import_batch(uuid)'::regprocedure) into v_definition;
  v_patched:=replace(
    v_definition,
    'case when v_delta>0 then ''credit'' else ''adjustment'' end',
    'case when v_delta>0 then ''credit''::public.point_transaction_type else ''adjustment''::public.point_transaction_type end'
  );
  if v_patched=v_definition then raise exception 'IMPORT_COMMIT_ENUM_CAST_PATTERN_NOT_FOUND'; end if;
  execute v_patched;

  select pg_get_functiondef('public.admin_rollback_import_batch(uuid,text)'::regprocedure) into v_definition;
  v_patched:=replace(
    v_definition,
    'case when points_delta>0 then ''adjustment'' else ''credit'' end',
    'case when points_delta>0 then ''adjustment''::public.point_transaction_type else ''credit''::public.point_transaction_type end'
  );
  if v_patched=v_definition then raise exception 'IMPORT_ROLLBACK_ENUM_CAST_PATTERN_NOT_FOUND'; end if;
  execute v_patched;
end;
$migration$;

notify pgrst,'reload schema';
commit;
