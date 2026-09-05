-- 20260812T1740_list_stock_movements_materializado.sql
-- CIERRA el timeout de Almacen > Movimientos. Corrige la 1730 (que redujo los
-- temporales pero disparo los buffers a 51.642 al recalcular el CTE).
--
-- CAMINO COMPLETO DEL DIAGNOSTICO (12/08, medido en cada paso):
--   original ............... 1.211 ms · 4.974 buffers · temp 3.625
--   1710 paginar antes ..... 1.472 ms · sin cambio    -> el cuello no era ese
--   1720 indice nuevo ......   escaneo base 370 -> 25 ms (SI sirvio)
--   1730 agregados 1 pasada  1.952 ms · 51.642 buffers -> peor: recalculaba
--   ESTA (as materialized) ...  ~270 ms
--
-- CAUSA REAL: Postgres decide en linea el CTE `filtrado` y lo RECALCULA en cada
-- uso (agregados + pagina). Con 15.068 filas en Alcala eso son varios escaneos
-- completos. `as materialized` lo calcula UNA vez y lo reutiliza.
--
-- No cambia la firma, ni las claves del JSON, ni los valores devueltos.
--
-- NO reejecutar contra produccion: ya esta aplicada.

create or replace function public.list_stock_movements(
  p_account uuid,
  p_location uuid,
  p_types text[] default null::text[],
  p_from timestamp with time zone default null::timestamp with time zone,
  p_to timestamp with time zone default null::timestamp with time zone,
  p_limit integer default 200,
  p_offset integer default 0,
  p_search text default null::text
)
returns jsonb
language sql
set search_path to 'public'
as $function$
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