-- scripts/conta/produccion/cuentas/compras-preguntas.sql
--
-- Compras · LO QUE CUENTA LA TANDA DE LA 0350 Y LA 0360 (las preguntas de la
-- ficha, también en las recepciones que ya tienen factura), antes y después.
-- SOLO LEE. Recuentos y huellas de Foodint (regla 9).
--
-- Lo que tiene que pasar: las dos funciones cambian de cuerpo (una firma cada
-- una); en Foodint, las consumidas con «la ficha no dice cómo factura» pasan
-- de 5 a 0 y las consumidas con «no dicen lo mismo» de 0 a 1 (ALB-00218); el
-- camino, la factura, la fecha de consumo y el motivo de todas las recepciones
-- de Foodint, IGUAL antes y después (la tanda solo toca la pregunta).
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
       from public.goods_receipt_path p where p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) x order by o;
