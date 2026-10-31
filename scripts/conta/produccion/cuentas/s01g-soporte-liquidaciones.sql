-- scripts/conta/produccion/cuentas/s01g-soporte-liquidaciones.sql
--
-- S01g · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. De Foodint
-- (regla 9), sin nombres ni importes. Sin comas en los valores.
--
-- Lo que tiene que pasar:
--   1. las recepciones de soporte salen «soporte»: de false a true;
--   2. la liquidación del socio guarda su proveedor: de false a true;
--   3. las liquidaciones de Foodint sin proveedor: de 3 a 0;
--   4. las recepciones de Foodint con la ruta «liquidacion»: las mismas (la tanda no las toca);
--   5. las liquidaciones de Foodint: las mismas (la tanda no da ninguna de alta).
select clave, valor from (
  select 1 o, 'recepciones de soporte en Facturas recibidas' clave,
    (position('soporte' in pg_get_functiondef('public.conta_documentos_recibidos(uuid,date,date)'::regprocedure)) > 0)::text valor union all
  select 2, 'la liquidación del socio guarda su proveedor',
    (position('v_prov' in pg_get_functiondef('public.brand_partner_settlement_prepare(uuid,uuid,date,date,text)'::regprocedure)) > 0)::text union all
  select 3, 'liquidaciones de Foodint sin proveedor',
    (select count(*)::text from public.licensed_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and supplier_id is null) union all
  select 4, 'recepciones de Foodint con la ruta liquidacion',
    -- quieta: la ruta la decide Compras; la tanda no la cambia
    (select count(*)::text from public.goods_receipt_path where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and path = 'liquidacion') union all
  select 5, 'liquidaciones de Foodint',
    -- quieta: la tanda no da ninguna de alta
    (select count(*)::text from public.licensed_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) q order by o;
