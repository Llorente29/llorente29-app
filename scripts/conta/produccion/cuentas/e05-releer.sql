-- scripts/conta/produccion/cuentas/e05-releer.sql
--
-- E05 · LO QUE CUENTA LA TANDA «VOLVER A LEER LOS PDF DE CATCHER» (0480), antes
-- y después. SOLO LEE. Antes: sin tabla, y las dos funciones de cruzar con su
-- md5 de producción (7586a749… y 79a57d0b…). Después: con la tabla vacía (la
-- tanda no toca filas) y las dos con su md5 nuevo. Y que no se mueve ninguna
-- factura de Catcher de Foodint, ni su confianza, ni lo que hay por aclarar.
-- Lo de Foodint, con su cuenta (regla 9).
select clave, valor from (
  select 1 o, 'tabla conta_lote_relectura' clave, (to_regclass('public.conta_lote_relectura') is not null)::text valor union all
  select 2, 'filas de conta_lote_relectura',
         case when to_regclass('public.conta_lote_relectura') is not null
              then (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.conta_lote_relectura', false, true, '')))[1]::text
              else 'sin tabla' end union all
  select 3, 'md5 conta_lote_pedidos_app', (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure('public.conta_lote_pedidos_app(uuid)')) union all
  select 4, 'md5 conta_lote_cruce_guardar', (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure('public.conta_lote_cruce_guardar(uuid,jsonb,text)')) union all
  select 5, 'facturas de Catcher de Foodint', (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and batch_id is not null)::text union all
  select 6, 'de ellas, seguras', (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and batch_id is not null and reading_confidence = 'seguro')::text union all
  select 7, 'cosas por aclarar abiertas de Foodint', (select count(*) from public.supplier_batch_issue where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'abierta')::text
) t order by o;
