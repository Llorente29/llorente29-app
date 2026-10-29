-- scripts/conta/produccion/cuentas/s01c-facturas-solas.sql
--
-- S01c · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. De Foodint
-- (regla 9), sin nombres, NIF ni importes.
--
-- Lo que tiene que pasar (primer real, la 1012: solo la 1; segundo real, la 1013: de la 2 a la 5):
--   1. las seis funciones nuevas: de false a true;
--   2. FAC-00100: de «aprobada» a «anulada», y su asiento de «validado» a «anulado»;
--   3. el camino de ALB-00218: de «factura, consumido» a «pendiente_factura, sin consumir»;
--   4. Amirsa: «cuándo llegan» de «no está» a «inicio_mes_siguiente»; sus preguntas abiertas, de 1 a 0;
--   5. las direcciones de entrada de Foodint: de 3 a 2 (sin «documentos»).
select clave, valor from (
  select 1 o, 'funciones nuevas (casar / llegan / esperando / hueco / correo / disparador)' clave,
    concat_ws(' / ', (to_regprocedure('public._compras_casar_solo(uuid)') is not null)::text,
                     (to_regprocedure('public.compras_cuando_llegan_poner(uuid,text)') is not null)::text,
                     (to_regprocedure('public.compras_esperando_detalle(uuid,date)') is not null)::text,
                     (to_regprocedure('public.compras_hueco_recepcion(uuid,text)') is not null)::text,
                     (to_regprocedure('public.conta_correo_facturas(uuid)') is not null)::text,
                     (to_regprocedure('public.tg_supplier_invoice_casar_sola()') is not null)::text) valor union all
  select 2, 'FAC-00100 (factura / asiento)',
    -- quieta: una factura y su asiento por su código; solo los cambia la 1013 (ninguna pantalla anula FAC-00100 durante el ensayo)
    (select si.status || ' / ' || coalesce((select je.status from public.journal_entry je where je.source_type = 'supplier_invoice' and je.source_id = si.id order by je.created_at limit 1), '—')
       from public.supplier_invoice si where si.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and si.code = 'FAC-00100') union all
  select 3, 'camino de ALB-00218',
    -- quieta: el camino de un albarán por su código; solo lo cambia la 1013 o una factura que case con él, y a la dirección de facturas no ha llegado ninguna
    (select p.path || case when p.consumed_at is null then ', sin consumir' else ', consumido' end
       from public.goods_receipt_path p join public.goods_receipt g on g.id = p.goods_receipt_id
      where g.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and g.code = 'ALB-00218') union all
  select 4, 'Amirsa (cuándo llegan / preguntas abiertas)',
    -- quieta: «cuándo llegan» lo escribe solo la 1013 (la columna nace con la 1012); las preguntas, de sus recepciones de antes del corte
    (select coalesce((to_jsonb(s) ->> 'invoice_arrival'), case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'invoice_arrival') then 'al momento' else 'no está' end)
            || ' / ' || (select count(*) from public.goods_receipt_path p join public.goods_receipt g on g.id = p.goods_receipt_id
                          where g.supplier_id = s.id and g.created_at < timestamptz '2026-10-29 11:00:00+00' and p.consumed_at is null and p.question is not null and p.question_closed is distinct from p.question)
       from public.supplier s where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.archived_at is null and s.name ilike 'AMIRSA%') union all
  select 5, 'direcciones de entrada de Foodint',
    -- quieta: solo las crea un administrador desde Ajustes (conta_direccion_entrada); la 1013 borra la apagada
    (select count(*)::text from public.company_inbound_address where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) q order by o;
