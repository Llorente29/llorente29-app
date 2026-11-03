-- scripts/conta/produccion/cuentas/s01q-mes-rapido.sql
--
-- S01q·11 · LO QUE CUENTA LA TANDA (1527), antes y después. SOLO LEE, y solo
-- el catálogo: nada crece solo.
-- quieta: las dos funciones cambian de cuerpo con la misma firma; no hay filas que cuenten.
select clave, valor from (
  select 1 o, 'conta_liquidaciones calcula «filas» una vez (antes 0, después 1)' clave,
    (strpos(pg_get_functiondef('public.conta_liquidaciones(uuid,date,date)'::regprocedure), 'filas as materialized (') > 0)::int::text valor
  union all
  select 2, 'conta_liquidaciones_mes calcula «g» una vez (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_liquidaciones_mes(uuid,date)'::regprocedure), 'g as materialized (') > 0)::int::text
  union all
  select 3, 'conta_liquidaciones_mes calcula «k» una vez (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_liquidaciones_mes(uuid,date)'::regprocedure), 'k as materialized (') > 0)::int::text
  union all
  select 4, 'Respaldos de la 1527 (antes 0, después 2)',
    (select count(*)::text from public.funcion_respaldo where migracion = '20261103T1527_s01q_mes_rapido')
) t order by o;
