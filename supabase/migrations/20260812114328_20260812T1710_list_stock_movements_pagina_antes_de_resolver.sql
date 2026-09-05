-- 20260812T1710_list_stock_movements_pagina_antes_de_resolver.sql
-- ARREGLA: "No se pudo cargar el historico: canceling statement due to statement
-- timeout" en Almacen > Movimientos (visto por Julio el 12/08 con solo 25
-- movimientos en el dia).
--
-- CAUSA (medida): 1.211 ms / 4.974 buffers para devolver 25 filas. El CTE
-- `resolved` calcula la columna `reference` para TODAS las filas del periodo y
-- solo despues aplica limit/offset. Y esa columna hace, por cada fila de venta,
-- DOS subconsultas a sale mas una a sale_line (26.425 filas). Con el filtro
-- "Hoy" ya se pasa del statement_timeout de anon desde el navegador; con un
-- rango mas amplio es inviable.
--
-- SOLUCION: paginar ANTES de resolver. Se introduce el CTE `pagina` (orden +
-- limit + offset sobre `filtrado`) y `resolved` pasa a construirse sobre esa
-- pagina. Los agregados (total, sums, units) siguen calculandose sobre
-- `filtrado` completo, asi que las cifras de cabecera NO cambian.
--
-- No cambia la firma, ni las claves del JSON, ni el orden de salida.
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
base as (
  select sm.id, sm.movement_type, sm.source_type, sm.source_id,
         sm.qty_base, sm.unit_cost, sm.occurred_at, sm.created_by_name, sm.notes,
         ri.name as item_name,
         ku.abbreviation as unit_abbr
  from stock_movement sm
  join recipe_item ri on ri.id = sm.recipe_item_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  where sm.account_id = p_account
    and sm.location_id = p_location
    and (p_types is null or sm.movement_type = any(p_types))
    and (p_from is null or sm.occurred_at >= p_from)
    and (p_to is null or sm.occurred_at < p_to)
),
todos as (select count(*) as n from base),
filtrado as (
  select b.* from base b, q
  where q.term is null
     or unaccent(lower(b.item_name)) like '%' || q.term || '%' escape '\'
),
-- CLAVE DEL ARREGLO: paginar ANTES de resolver referencias.
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
  'total',       (select count(*) from filtrado),
  'total_all',   (select n from todos),
  'sum_in',      coalesce((select round(sum(qty_base) filter (where qty_base > 0), 3) from filtrado), 0),
  'sum_out',     coalesce((select round(sum(-qty_base) filter (where qty_base < 0), 3) from filtrado), 0),
  'units', coalesce((select jsonb_agg(distinct coalesce(unit_abbr, '')) from filtrado), '[]'::jsonb),
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