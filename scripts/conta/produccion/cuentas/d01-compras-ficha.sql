-- scripts/conta/produccion/cuentas/d01-compras-ficha.sql
--
-- D01 · LO QUE CUENTA LA TANDA DE COMPRAS Y LA FICHA (0100 del 18), antes y
-- después. SOLO LEE. Recuentos de Foodint (regla 9); ningún nombre ni importe.
-- La tanda no toca datos: cambia dos funciones con la misma firma. Los
-- recuentos tienen que salir IGUALES antes y después; lo que cambia es la
-- huella de las dos funciones.
-- Medido en producción el 16/10 a las 15:33 UTC, antes: 4 / 2 / 3 /
-- compras_ficha_le_falta=5dbcedf7 compras_mirar=1d4795ca. Después: 4 / 2 / 3 y
-- otra huella en las dos.
select clave, valor from (
  select 1 o, 'preguntas «¿cómo factura?» abiertas, usadas y con la ficha ya contestada' clave,
    (select count(*) from public.goods_receipt_path p join public.goods_receipt g on g.id = p.goods_receipt_id join public.supplier s on s.id = g.supplier_id
      where p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and p.question = 'ficha_sin_forma' and p.question is distinct from p.question_closed
        and g.status = 'confirmado' and p.consumed_at is not null and s.invoicing_mode is not null)::text valor union all
  select 2, 'de cuántos proveedores',
    (select count(distinct g.supplier_id) from public.goods_receipt_path p join public.goods_receipt g on g.id = p.goods_receipt_id join public.supplier s on s.id = g.supplier_id
      where p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and p.question = 'ficha_sin_forma' and p.question is distinct from p.question_closed
        and g.status = 'confirmado' and p.consumed_at is not null and s.invoicing_mode is not null)::text union all
  select 3, 'proveedores sin tipo de gasto y con su cuenta de facturas',
    (select count(*) from public.supplier s where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.expense_category_id is null
      and exists (select 1 from public.company_account_link l where l.account_id = s.account_id and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'gasto'))::text union all
  select 4, 'huella de compras_mirar y compras_ficha_le_falta',
    (select string_agg(p.proname || '=' || left(md5(p.prosrc), 8), ' ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('compras_mirar', 'compras_ficha_le_falta'))
) t order by o;
