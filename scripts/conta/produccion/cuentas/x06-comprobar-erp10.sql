-- scripts/conta/produccion/cuentas/x06-comprobar-erp10.sql
--
-- X06 · El paso 3 de la salida a ERP10 (0515) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda solo añade dos tablas y cuatro funciones: no cambia ni una fila ni ninguna función que exista.
-- Se mide que la salida a ERP10 sigue igual (tabla entera, a propósito: regla 9, excepción). Corte fijo
-- (el #241): lo creado antes del 19/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · conta_erp10_salida_empresa encendidas' clave, count(*)::text valor
    from public.conta_erp10_salida_empresa where encendida and cambiado_en < timestamptz '2026-11-19 00:00:00+01'
  union all
  select 2, 'tabla entera · conta_erp10_salida_lote', count(*)::text
    from public.conta_erp10_salida_lote where creado_en < timestamptz '2026-11-19 00:00:00+01'
  union all
  select 3, 'tabla entera · conta_erp10_salida_partida vivas', count(*)::text
    from public.conta_erp10_salida_partida where estado = 'salida' and creado_en < timestamptz '2026-11-19 00:00:00+01'
  union all
  select 4, 'funciones · las de la salida a ERP10 (firmas)', count(*)::text
    from pg_proc where pronamespace = 'public'::regnamespace and proname like 'conta\_erp10\_%'
      and proname not in ('conta_erp10_comprobar', 'conta_erp10_a_mano_poner', 'conta_erp10_volver_a_sacar', 'conta_erp10_igualado_poner')
) t order by o, clave;
