-- scripts/conta/produccion/cuentas/x05-emitidas-erp10.sql
--
-- X05 · Las emitidas salen a ERP10 (2230 y 2231) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda reemplaza una función que solo lee, con la misma firma, y añade otra que solo lee: no cambia
-- ni una fila. Se mide que la salida a ERP10 sigue igual (tabla entera, a propósito: regla 9, excepción)
-- y que conta_erp10_por_salir sigue teniendo una sola firma (regla 2). Corte fijo (el #241): lo creado
-- antes del 18/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · conta_erp10_salida_empresa encendidas' clave, count(*)::text valor
    from public.conta_erp10_salida_empresa where encendida and cambiado_en < timestamptz '2026-11-18 00:00:00+01'
  union all
  select 2, 'tabla entera · conta_erp10_salida_lote', count(*)::text
    from public.conta_erp10_salida_lote where creado_en < timestamptz '2026-11-18 00:00:00+01'
  union all
  select 3, 'tabla entera · conta_erp10_salida_partida', count(*)::text
    from public.conta_erp10_salida_partida where creado_en < timestamptz '2026-11-18 00:00:00+01'
  union all
  select 4, 'funciones · conta_erp10_por_salir (firmas)', count(*)::text
    from pg_proc where pronamespace = 'public'::regnamespace and proname = 'conta_erp10_por_salir'
) t order by o, clave;
