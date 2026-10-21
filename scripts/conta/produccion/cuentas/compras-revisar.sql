-- scripts/conta/produccion/cuentas/compras-revisar.sql
--
-- Compras · LO QUE CUENTA LA TANDA DE LA 0350, LA 0360 Y LA 0370 (las
-- preguntas de la ficha, también en las recepciones que ya tienen factura, y
-- los textos sin «papel»), antes y después.
-- SOLO LEE. Recuentos y huellas de Foodint (regla 9).
--
-- Lo que tiene que pasar: las dos funciones cambian de cuerpo (una firma cada
-- una); en Foodint, las consumidas con «la ficha no dice cómo factura» pasan
-- de 5 a 0 y las consumidas con «no dicen lo mismo» de 0 a 1 (ALB-00218); el
-- camino, la factura, la fecha de consumo y el motivo de todas las recepciones
-- de Foodint, IGUAL antes y después (la tanda solo toca la pregunta); las 12
-- funciones de textos de la 0370 cambian de cuerpo, una firma cada una (12).
select clave, valor from (
  select 1 o, 'funciones de compras (nombre:md5 del cuerpo)' clave,
    (select string_agg(proname || ':' || md5(prosrc), ' · ' order by proname)
       from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('_compras_camino_guarda', '_compras_forma_facturar')) valor union all
  select 2, 'Foodint · preguntas abiertas (consumida/pregunta:n)',
    (select coalesce(string_agg(k || ':' || n, ' · ' order by k), 'ninguna') from (
       select case when p.consumed_at is null then 'sin_consumir' else 'consumida' end || '/' || p.question k, count(*) n
         from public.goods_receipt_path p
        where p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
          and p.question is not null and p.question is distinct from p.question_closed
        group by 1) x) union all
  select 3, 'Foodint · caminos sin la pregunta (md5)',
    (select md5(coalesce(string_agg(p.goods_receipt_id || p.path || coalesce(p.supplier_invoice_id::text, '') || coalesce(p.consumed_at::text, '')
                                    || coalesce(p.reason, '') || coalesce(p.decided_at::text, ''), '|' order by p.goods_receipt_id), ''))
       from public.goods_receipt_path p where p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 4, 'las 12 funciones de textos (firmas · md5 de sus cuerpos juntos)',
    (select count(*) || ' · ' || md5(string_agg(proname || md5(prosrc), '|' order by proname, oid))
       from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('_compras_camino_calcula', '_compras_factura_desde_papel', 'compras_factura_desde_papel', 'compras_sin_iva',
                        'tg_goods_receipt_path_factura', 'compras_camino_de', 'conta_documentos_recibidos', 'company_chart_import_apply',
                        'company_chart_import_undo', 'party_add_role', 'party_misma_cuenta', '_party_merge'))
) x order by o;
