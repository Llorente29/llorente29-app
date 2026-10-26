-- scripts/conta/produccion/cuentas/pc01-sin-delete-sin-where.sql
--
-- PC01 · arreglo urgente (26/10) · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. Solo funciones: la huella de las tres que cambia la 0642 y cuántas
-- firmas tiene cada una (regla 2: una). No toca datos, así que no cuenta filas.
-- Medido en producción el 26/10 a las 06:40 UTC, antes: 14c49321 · dc7b79cf ·
-- e117089e · 1 · 1 · 1.
select clave, valor from (
  select 1 o, 'huella de _conta_liquidacion_cobros' clave, (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_conta_liquidacion_cobros') valor union all
  select 2, 'huella de _compras_fin_de_mes', (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_compras_fin_de_mes') union all
  select 3, 'huella de recost_sales_for_product', (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'recost_sales_for_product') union all
  select 4, 'firmas de _conta_liquidacion_cobros', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_conta_liquidacion_cobros')::text union all
  select 5, 'firmas de _compras_fin_de_mes', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_compras_fin_de_mes')::text union all
  select 6, 'firmas de recost_sales_for_product', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'recost_sales_for_product')::text
) t order by o;
