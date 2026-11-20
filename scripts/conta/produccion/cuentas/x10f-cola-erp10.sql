-- scripts/conta/produccion/cuentas/x10f-cola-erp10.sql
--
-- X10f · Lo validado sale solo a ERP10 (2010 y 2011) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda añade una columna, tres funciones y el cron, y cambia la guarda de conta_erp10_lote_apuntar.
-- Se mide que lo que ya salió sigue igual (tablas enteras, a propósito: regla 9, excepción). Corte fijo:
-- lo creado antes del 21/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · conta_erp10_envio por clase y estado' clave,
         coalesce(string_agg(x, ' · ' order by x), '0') valor
    from (select clase || ' ' || estado || ' ' || count(*) x from public.conta_erp10_envio
           where creado_en < timestamptz '2026-11-21 00:00:00+01' group by clase, estado) t
  union all
  select 2, 'tabla entera · conta_erp10_salida_partida salidas', count(*)::text
    from public.conta_erp10_salida_partida where estado = 'salida' and creado_en < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 3, 'tabla entera · conta_erp10_salida_empresa encendidas', count(*)::text
    from public.conta_erp10_salida_empresa where encendida
) t order by o, clave;
