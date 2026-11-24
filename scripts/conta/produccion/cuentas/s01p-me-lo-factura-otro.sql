-- scripts/conta/produccion/cuentas/s01p-me-lo-factura-otro.sql
--
-- S01p·20·2 · LO QUE CUENTA LA TANDA (1910 y 0033), antes y después. SOLO LEE: el catálogo, y MANUFACTURAS
-- CATOR y su recepción de noviembre (ALB-00251) por su id. La tanda no toca ningún dato.
select clave, valor from (
  -- quieta: la ficha de MANUFACTURAS CATOR en Foodint, por su id: la tanda no la cambia (se elige en la pantalla)
  select 1 o, 'Foodint · MANUFACTURAS CATOR (forma · tiene quién le factura)' clave,
    (select coalesce(s.invoicing_mode, 'sin forma') || ' · ' ||
            (case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'invoiced_by_supplier_id')
                  then (to_jsonb(s)->>'invoiced_by_supplier_id' is not null)::text else 'sin columna' end)
       from public.supplier s where s.id = 'f2651061-eaae-4e29-a1ee-a6a99397c9ae' and s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor
  union all
  -- quieta: el camino de su recepción confirmada (ALB-00251), por la recepción: la tanda no lo recalcula
  select 2, 'Foodint · el camino de su recepción confirmada',
    (select string_agg(p.path || ' · ' || coalesce(p.question, 'sin pregunta'), ', ')
       from public.goods_receipt_path p join public.goods_receipt g on g.id = p.goods_receipt_id
      where g.supplier_id = 'f2651061-eaae-4e29-a1ee-a6a99397c9ae' and g.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and g.status = 'confirmado')
  union all
  select 3, 'supplier.invoiced_by_supplier_id existe (antes 0, después 1)',
    (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'invoiced_by_supplier_id'))::int::text
  union all
  select 4, 'compras_lo_factura_otro existe (antes 0, después 1)',
    (to_regprocedure('public.compras_lo_factura_otro(uuid,uuid)') is not null)::int::text
  union all
  select 5, 'El camino de una recepción mira quién le factura (antes 0, después 1)',
    (strpos(pg_get_functiondef('public._compras_camino_calcula(uuid)'::regprocedure), 'S01p·20·2') > 0)::int::text
) t order by o;
