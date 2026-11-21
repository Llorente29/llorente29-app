-- scripts/conta/produccion/cuentas/x10b-erp10-envio.sql
--
-- X10b · Lo que Sumied escribe en ERP10 (1433) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda añade una tabla y una función nuevas y no cambia ninguna otra. Se mide que la
-- salida a ERP10 sigue igual (tabla entera, a propósito: regla 9, excepción). Corte fijo (el
-- #241): lo creado antes del 21/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · conta_erp10_salida_lote' clave, count(*)::text valor
    from public.conta_erp10_salida_lote where creado_en < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 2, 'tabla entera · conta_erp10_salida_partida vivas', count(*)::text
    from public.conta_erp10_salida_partida where estado = 'salida' and creado_en < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 3, 'funciones · las de la salida a ERP10 (firmas)', count(*)::text
    from pg_proc where pronamespace = 'public'::regnamespace and proname like 'conta\_erp10\_%'
      and proname not in ('conta_erp10_envio_tomar')
) t order by o, clave;
