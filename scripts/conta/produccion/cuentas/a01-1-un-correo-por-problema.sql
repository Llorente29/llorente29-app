-- scripts/conta/produccion/cuentas/a01-1-un-correo-por-problema.sql
--
-- A01-1 (02/11) · LO QUE CUENTA LA TANDA (1936), antes y después. SOLO LEE, y
-- solo el catálogo de la base (huellas de funciones, tablas y la tarea): nada
-- crece solo. Antes: encolar_alerta 3e00b834 y last_catalog_watchdog c48e0f7b,
-- sin tablas ni tarea. Tras la tanda: otras huellas, las tres tablas y la
-- tarea avisos-resolver. Tras la vuelta atrás: como antes.
select clave, valor from (
  select 1 o, 'huella de encolar_alerta (antes 3e00b834)' clave,
    left(md5(pg_get_functiondef('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)'::regprocedure)), 8) valor union all
  select 2, 'huella de last_catalog_watchdog (antes c48e0f7b)',
    left(md5(pg_get_functiondef('public.last_catalog_watchdog()'::regprocedure)), 8) union all
  select 3, 'tablas nuevas que existen (antes 0, después 3)',
    ((to_regclass('public.aviso_tipo') is not null)::int + (to_regclass('public.aviso_problema') is not null)::int
      + (to_regclass('public.aviso_callado') is not null)::int)::text union all
  select 4, 'tarea avisos-resolver programada (antes 0, después 1)',
    (select count(*) from cron.job where jobname = 'avisos-resolver')::text
) t order by o;
