-- scripts/conta/produccion/cuentas/x10e-erp10-envio-dia.sql
--
-- X10e · Los días del TPV por la conexión (1140) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda solo añade tres columnas a conta_erp10_envio. Se mide que lo que ya salió por la
-- conexión sigue igual (tabla entera, a propósito: regla 9, excepción). Corte fijo: lo creado antes
-- del 21/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · conta_erp10_envio por clase y estado' clave,
         coalesce(string_agg(x, ' · ' order by x), '0') valor
    from (select clase || ' ' || estado || ' ' || count(*) x from public.conta_erp10_envio
           where creado_en < timestamptz '2026-11-21 00:00:00+01' group by clase, estado) t
  union all
  select 2, 'tabla entera · conta_erp10_envio en ERP10 con su número', count(*)::text
    from public.conta_erp10_envio where estado = 'en_erp10' and erp10_documento is not null and creado_en < timestamptz '2026-11-21 00:00:00+01'
) t order by o, clave;
