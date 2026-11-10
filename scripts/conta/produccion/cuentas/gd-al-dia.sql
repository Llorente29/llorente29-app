-- scripts/conta/produccion/cuentas/gd-al-dia.sql
--
-- GD · Clientes y cuotas al día con Realtime · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 09/11 a las 22:15 UTC (solo lectura). Lo que tiene que pasar:
--   1. conta_gestoria_lectura en supabase_realtime: false → true.
--   2. Tablas en supabase_realtime: 13 → 14.
--   3. La política de lectura de conta_gestoria_lectura: la misma antes y después (no se toca).
-- Y la vuelta atrás deja todo como antes (el ensayo lo mide).
select clave, valor from (
  select 1 o, 'conta_gestoria_lectura en supabase_realtime' clave,
    -- quieta: la publicación solo cambia con una migración
    (exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conta_gestoria_lectura'))::text valor union all
  select 2, 'Tablas en supabase_realtime',
    -- quieta: la publicación solo cambia con una migración
    (select count(*) from pg_publication_tables where pubname = 'supabase_realtime')::text union all
  select 3, 'La política de lectura de conta_gestoria_lectura',
    -- quieta: las políticas solo cambian con una migración
    (select string_agg(polname::text || ' · ' || pg_get_expr(polqual, polrelid), ' | ') from pg_policy where polrelid = 'public.conta_gestoria_lectura'::regclass)
) q order by o;
