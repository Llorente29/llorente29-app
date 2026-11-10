-- scripts/conta/produccion/cuentas/g05-motivo-devuelto.sql
--
-- G05 · El motivo del devuelto, en el recibo (nº 77, punto 2) · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 10/11 a las 10:41 UTC. Lo que tiene que pasar:
--   1. La columna conta_recibo.motivo_devolucion existe: false → true.
--   2. La columna conta_gc_cobro.motivo_es existe: false → true.
--   3. conta_cobro_seguir guarda el motivo: false → true.
--   4. Recibos (todas las cuentas, hasta el corte): quieta (26).
select clave, valor from (
  select 1 o, 'La columna conta_recibo.motivo_devolucion existe' clave,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_recibo' and column_name = 'motivo_devolucion')::text valor union all
  select 2, 'La columna conta_gc_cobro.motivo_es existe',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_cobro' and column_name = 'motivo_es')::text union all
  select 3, 'conta_cobro_seguir guarda el motivo',
    (position('motivo_devolucion' in pg_get_functiondef('public.conta_cobro_seguir(uuid)'::regprocedure)) > 0)::text union all
  select 4, 'Recibos (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_recibo where preparado_at < timestamptz '2026-11-10 10:00:00+00')
) q order by o;
