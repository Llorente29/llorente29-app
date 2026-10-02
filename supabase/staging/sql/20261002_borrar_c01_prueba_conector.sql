-- SOLO STAGING-CONTA. Quita del historial de migraciones la fila que dejó el
-- 01/10/2026 a las 22:44 (UTC) una prueba del conector de Supabase
-- (`apply_migration` con un `select 1`). No corresponde a ninguna migración y
-- no cambió nada más. Exactamente esa fila: si hubiera más de una, aborta.
do $$
declare n int;
begin
  delete from supabase_migrations.schema_migrations
   where version = '20261001224408' and name = 'c01_prueba_conector';
  get diagnostics n = row_count;
  if n > 1 then
    raise exception 'Borrado ABORTADO: % filas con ese nombre y versión; esperaba una.', n;
  end if;
  raise notice 'Fila de prueba del conector: % borrada(s).', n;
end $$;
