-- 20260812T1740_list_stock_movements_materializado.sql
-- Aplicada: 2026-08-12 por MCP. Cuerpo IDENTICO al vivo en produccion
-- (extraido con pg_get_functiondef despues de aplicar).
--
-- INTENTO 4 de 4 contra el timeout de Almacen > Movimientos.
-- Es la version VIGENTE de list_stock_movements: sustituye a la 1710 y la 1730.
--
-- EL PROBLEMA NO ESTA RESUELTO. La funcion sigue en ~2 s / 51.640 buffers, por
-- encima del statement_timeout de anon: la pantalla puede seguir dando
-- "canceling statement due to statement timeout".
--
-- CAMINO DEL DIAGNOSTICO (12/08, medido paso a paso, para no repetirlo):
--   original ................ 1.211 ms · 4.974 buffers · temp 3.625
--   1710 paginar antes ...... 1.472 ms · sin cambio      -> el cuello no era ese
--   1720 indice nuevo ....... escaneo base 370 -> 25 ms  -> SI sirvio, se queda
--   1730 agregados 1 pasada . 1.952 ms · 51.642 buffers  -> temp 3.625->727
--   1740 as materialized .... 2.058 ms · 51.640 buffers  -> sin mejora neta
--
-- LO QUE NO CUADRA (aqui debe seguir quien lo retome): cada pieza medida POR
-- SEPARADO va rapida --escaneo base 25 ms, resolver sale_line 6 ms, resolver
-- referencia de venta 7 ms, filtro unaccent 16 ms, materializado+pagina 65 ms,
-- prueba suelta con as materialized 269 ms-- pero la funcion completa tarda 2 s.
-- Esa diferencia NO esta explicada.
--
-- PISTA SIN EXPLORAR: la pantalla mostraba "0 movimientos" en el filtro Salidas
-- existiendo 25 consumos ese dia. Es posible que el frontend llame con
-- parametros distintos a los medidos aqui. ANTES de seguir tocando SQL, hacer
-- RECON del frontend y capturar la llamada REAL.
--
-- NO reejecutar contra produccion: ya esta aplicada.

CREATE OR REPLACE FUNCTION public.list_stock_movements(p_account uuid, p_location uuid, p_types text[] DEFAULT NULL::text[], p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
with q as (
  select nullif(
           replace(replace(replace(unaccent(lower(btrim(coalesce(p_search, '')))),
             '\', '\\'), '%', '\%'), '_', '\_'),
           '') as term
),
-- MATERIALIZED: se calcula UNA vez. Sin esto Postgres lo recalcula en cada uso.
filtrado as materialized (
  select sm.id, sm.movement_type, sm.source_type, sm.source_id,
         sm.qty_base, sm.unit_cost, sm.occurred_at, sm.created_by_name, sm.notes,
         ri.name as item_name,
         ku.abbreviation as unit_abbr
  from stock_movement sm
  join recipe_item ri on ri.id = sm.recipe_item_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  cross join q
  where sm.account_id = p_account
    and sm.location_id = p_location
    and (p_types is null or sm.movement_type = any(p_types))
    and (p_from is null or sm.occurred_at >= p_from)
    and (p_to is null or sm.occurred_at < p_to)
    and (q.term is null
         or unaccent(lower(ri.name)) like '%' || q.term || '%' escape '\')
),
agregados as (
  select count(*)                                                          as total,
         coalesce(round(sum(qty_base) filter (where qty_base > 0), 3), 0)  as sum_in,
         coalesce(round(sum(-qty_base) filter (where qty_base < 0), 3), 0) as sum_out,
         coalesce(jsonb_agg(distinct coalesce(unit_abbr, '')), '[]'::jsonb) as units
  from filtrado
),
pagina as (
  select * from filtrado
  order by occurred_at desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0)
),
resolved as (
  select f.*,
    case f.source_type
      when 'sale' then coalesce(
        (select s.id from sale s where s.id = f.source_id),
        (select sl.sale_id from sale_line sl where sl.id = f.source_id)
      )
      else null
    end as sale_id,
    case f.source_type
      when 'sale' then (
        select trim(both ' ·' from
          coalesce(sc.name, initcap(s.external_channel_text), 'Venta')
          || coalesce(' · ' || nullif((case when left(btrim(s.raw_tab),1) = '{' then s.raw_tab::jsonb->>'code' else null end), ''), ''))
        from sale s
        left join sales_channel sc on sc.id = s.channel_id
        where s.id = coalesce(
          (select s2.id from sale s2 where s2.id = f.source_id),
          (select sl.sale_id from sale_line sl where sl.id = f.source_id)
        )
      )
      when 'goods_receipt_line' then (
        select coalesce(gr.code, 'Recepción')
          || coalesce(' · ' || nullif(gr.supplier_doc_number, ''), '')
        from goods_receipt_line grl
        join goods_receipt gr on gr.id = grl.goods_receipt_id
        where grl.id = f.source_id
      )
      when 'adjustment' then (
        select 'Ajuste · ' || sa.reason_code from stock_adjustment sa where sa.id = f.source_id
      )
      when 'waste' then (
        select 'Merma · ' || sw.reason_code from stock_waste sw where sw.id = f.source_id
      )
      when 'transfer' then (
        select case
          when st.from_location_id = p_location then '→ ' || coalesce(lt.name, 'otro local')
          else '← ' || coalesce(lf.name, 'otro local')
        end
        from stock_transfer st
        left join locations lf on lf.id = st.from_location_id
        left join locations lt on lt.id = st.to_location_id
        where st.id = f.source_id
      )
      else null
    end as reference
  from pagina f
)
select jsonb_build_object(
  'total',       (select total from agregados),
  'total_all',   (select total from agregados),
  'sum_in',      (select sum_in from agregados),
  'sum_out',     (select sum_out from agregados),
  'units',       (select units from agregados),
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id,
             'movement_type', r.movement_type,
             'source_type', r.source_type,
             'sale_id', r.sale_id,
             'item_name', r.item_name,
             'unit_abbr', r.unit_abbr,
             'qty_base', r.qty_base,
             'unit_cost', r.unit_cost,
             'cost_eur', round(abs(r.qty_base) * coalesce(r.unit_cost, 0), 2),
             'occurred_at', r.occurred_at,
             'created_by_name', r.created_by_name,
             'reference', r.reference,
             'notes', r.notes
           ) order by r.occurred_at desc)
    from resolved r
  ), '[]'::jsonb)
);
$function$;

notify pgrst, 'reload schema';
