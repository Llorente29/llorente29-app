-- supabase/vuelta-atras/20261109T2308_gd_al_dia_lecturas.down.sql
--
-- Vuelta atrás de la 2308: conta_gestoria_lectura sale de la publicación de
-- Realtime. La pantalla deja de ponerse al día sola (se recarga al volver a entrar).
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conta_gestoria_lectura') then
    execute 'alter publication supabase_realtime drop table public.conta_gestoria_lectura';
  end if;
end $$;
