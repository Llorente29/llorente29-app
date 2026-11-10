-- supabase/migrations/20261109T2308_gd_al_dia_lecturas.sql
--
-- GD · Clientes y cuotas, al día sin recargar (Julio, nº71; opción (a): Realtime).
-- AÑADE conta_gestoria_lectura a la publicación de Realtime (supabase_realtime).
-- Nada más: ni tablas, ni columnas, ni datos, ni políticas.
--
-- Cada lectura del CRM o de GoCardless (también la de un aviso «al instante»)
-- deja su fila en conta_gestoria_lectura y la cierra al acabar. La pantalla
-- (src/modules/conta/gestoria/useAlDia.ts) escucha solo esa tabla, solo de su
-- cuenta, y al acabar una lectura bien vuelve a pedir sus datos.
--
-- Seguridad por cuenta: Realtime aplica a cada suscriptor la RLS de la tabla
-- con su sesión (conta_gestoria_lectura_leer: belongs_to_account(account_id),
-- ya en producción), además del filtro por cuenta de la suscripción. Lo mide
-- supabase/staging/sql/20261110_gd_al_dia_prueba.sql: nadie lee una lectura de
-- otra cuenta.
--
-- Sin la publicación (una base local) o con la tabla ya dentro, no hace nada.
-- Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T2308_gd_al_dia_lecturas.down.sql

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conta_gestoria_lectura') then
    execute 'alter publication supabase_realtime add table public.conta_gestoria_lectura';
  end if;
end $$;
