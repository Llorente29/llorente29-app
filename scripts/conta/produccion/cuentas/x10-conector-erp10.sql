-- scripts/conta/produccion/cuentas/x10-conector-erp10.sql
--
-- X10 · El conector «ERP10 (despacho)» (1250) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda añade una fila al catálogo de conectores (global, sin account_id: regla 9,
-- excepción) y no cambia ninguna otra. Se mide que Diez sigue igual. Corte fijo (el #241): lo
-- creado antes del 20/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'catálogo · conectores' clave, count(*)::text valor from public.connector
  union all
  select 2, 'catálogo · erp10', count(*)::text from public.connector where code = 'erp10'
  union all
  select 3, 'tabla entera · conexiones con diez', count(*)::text
    from public.account_connector ac join public.connector c on c.id = ac.connector_id where c.code = 'diez'
      and ac.created_at < timestamptz '2026-11-20 00:00:00+01'
  union all
  select 4, 'tabla entera · conexiones con erp10', count(*)::text
    from public.account_connector ac join public.connector c on c.id = ac.connector_id where c.code = 'erp10'
      and ac.created_at < timestamptz '2026-11-20 00:00:00+01'
) t order by o, clave;
