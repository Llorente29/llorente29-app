-- scripts/conta/produccion/cuentas/s01p-bloques.sql
--
-- S01p · 3 · LO QUE CUENTA LA TANDA (1720), antes y después. SOLO LEE.
select clave, valor from (
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 1 o, 'Funciones de los bloques de «Cerrar el mes» (antes 0, después 10)' clave,
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'conta_cierre_bloque_%' or p.proname = 'conta_cierre_mes')) valor
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 2, 'De ellas, las que no son stable (antes 0, después 0)',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'conta_cierre_bloque_%' or p.proname in ('conta_cierre_mes', '_s01p_cuenta_de')) and p.provolatile <> 's')
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 3, 'Ayudantes _s01p_bloque, _s01p_cuenta_de y _s01p_euros (antes 0, después 3)',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('_s01p_bloque', '_s01p_cuenta_de', '_s01p_euros'))
) t order by o;
