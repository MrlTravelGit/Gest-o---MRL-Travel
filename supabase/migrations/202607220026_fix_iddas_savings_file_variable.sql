begin;

-- Evita colisão entre a variável PL/pgSQL e a coluna import_staging_rows.file_id.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.admin_prepare_iddas_savings_import()'::regprocedure) into definition;
  definition:=replace(definition,'file_id uuid; src public.iddas_savings_source_rows%rowtype','v_file_id uuid; src public.iddas_savings_source_rows%rowtype');
  definition:=replace(definition,'returning id into file_id;','returning id into v_file_id;');
  definition:=replace(definition,'values(batch_row.id,file_id,src.row_number','values(batch_row.id,v_file_id,src.row_number');
  execute definition;
end $$;

notify pgrst,'reload schema';
commit;
