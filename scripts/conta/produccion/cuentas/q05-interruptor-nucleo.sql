-- scripts/conta/produccion/cuentas/q05-interruptor-nucleo.sql
--
-- Q05 · «Pantallas nuevas» en la ficha de la cuenta · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0.
--   1. De las dos funciones de la ficha, las que aún no conocen conta_nucleo: 2 → 0.
select clave, valor from (
  select 1 o, 'funciones de la ficha que aún no conocen conta_nucleo' clave,
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      -- quieta: el catálogo de funciones solo cambia con una migración, no con el uso
      where n.nspname = 'public' and p.proname in ('conta_interruptores_de_cuenta', 'conta_interruptor_cambiar')
        and position('conta_nucleo' in pg_get_functiondef(p.oid)) = 0) valor
) x order by o, clave;
