-- scripts/conta/produccion/cuentas/x04-pantalla-erp10.sql
--
-- X04 · La pantalla de la salida a ERP10 (1530) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda solo añade una columna que admite nulos y dos funciones nuevas: no cambia ni una fila ni
-- ninguna función que exista (la X02 y su arreglo, X04a, siguen igual). Tabla entera, a propósito
-- (regla 9, excepción: la huella de «esto no se ha movido» es más fuerte así). Corte fijo (el #241):
-- lo creado antes del 18/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · conta_erp10_salida_empresa' clave, count(*)::text valor
    from public.conta_erp10_salida_empresa where cambiado_en < timestamptz '2026-11-18 00:00:00+01'
  union all
  select 2, 'tabla entera · conta_erp10_salida_lote', count(*)::text
    from public.conta_erp10_salida_lote where creado_en < timestamptz '2026-11-18 00:00:00+01'
  union all
  select 3, 'funciones · las de la X02 (firmas)', count(*)::text
    from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('conta_erp10_subcuenta', 'conta_erp10_salida_poner', 'conta_erp10_por_salir', 'conta_erp10_cambiadas', 'conta_erp10_lote_apuntar')
) t order by o, clave;
