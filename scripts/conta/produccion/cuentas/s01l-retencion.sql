-- scripts/conta/produccion/cuentas/s01l-retencion.sql
--
-- S01l · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Sin comas en los valores. Todo de Foodint.
--
-- Lo que tiene que pasar: la llegada de «LLORENTE29-FOOD-S.L.pdf» pasa de sin
-- factura a con factura, y las recibidas de Foodint con retención leída, de 0 a 1.
select clave, valor from (
  select 1 o, 'la función pone el tipo de la retención' clave,
    (position('withholding_rate_id' in (select prosrc from pg_proc where oid = 'public.conta_factura_desde_lectura(uuid,uuid)'::regprocedure)) > 0)::text valor union all
  select 2, 'la llegada del 01/11 tiene su factura',
    -- quieta: una sola fila, por su id; solo la cambia la 0921
    (select (supplier_invoice_id is not null)::text from public.document_inbox where id = '55541602-d1bc-4fc4-97da-041a1822c205' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  -- quieta: solo crecería con facturas leídas nuevas, y la tanda crea una
  select 3, 'recibidas leídas de Foodint con retención',
    (select count(*)::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'ocr' and withholding_amount is not null and created_at < timestamptz '2026-11-01 09:20+00')
) q order by o;
