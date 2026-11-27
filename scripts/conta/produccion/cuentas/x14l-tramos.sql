-- scripts/conta/produccion/cuentas/x14l-tramos.sql
--
-- X14 · 2 · Tramos de IVA por casilla de ERP10 (20261127T2205) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. SOLO
-- NÚMEROS (T11). Al aplicarse no cambia ningún dato: una columna nueva (vacía), su disparador y el índice que sustituye a la
-- regla de un tramo por factura y tipo. Corte fijo (W06): tramos creados antes del 27/11/2026 a las 23:00 de Madrid.
--   1. Por cuenta (regla 9): cuántos tramos, y cuántas recibidas con dos tramos al mismo tipo (antes y después: ninguna).
--   2. Los tramos con casilla (to_jsonb: antes de la tanda la columna no existe): ninguno.
with t as (select * from public.supplier_invoice_tax where created_at < timestamptz '2026-11-27 23:00:00+01')
select clave, valor from (
  select 1 o, 'cuenta ' || t.account_id || ' · tramos · recibidas con dos al mismo tipo' clave,
         count(*) || ' · ' || (select count(distinct d.supplier_invoice_id) from (select z.supplier_invoice_id from t z
                                where z.account_id = t.account_id group by z.supplier_invoice_id, z.vat_pct having count(*) > 1) d) valor
    from t group by t.account_id
  union all
  select 2, 'tabla entera · tramos con casilla de ERP10', count(*) filter (where to_jsonb(t)->>'import_position' is not null)::text from t
) x order by o, clave;
