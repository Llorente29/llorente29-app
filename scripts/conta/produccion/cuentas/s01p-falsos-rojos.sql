-- scripts/conta/produccion/cuentas/s01p-falsos-rojos.sql
--
-- S01p · 5 · LO QUE CUENTA LA TANDA (1905), antes y después. SOLO LEE.
select clave, valor from (
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 1 o, 'conta_cierre_mes cuenta lo sin medir de un bloque en rojo (antes 0, después 1)' clave,
    (strpos(pg_get_functiondef('public.conta_cierre_mes(uuid,date)'::regprocedure), '_s01p_sin_medir(b)') > 0)::int::text valor
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 2, 'Ayudante _s01p_sin_medir (antes 0, después 1)',
    (to_regprocedure('public._s01p_sin_medir(jsonb)') is not null)::int::text
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 3, 'Funciones de «Cerrar el mes» que no son stable (antes 0, después 0)',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'conta_cierre_bloque_%' or p.proname = 'conta_cierre_mes') and p.provolatile <> 's')
) t order by o;
