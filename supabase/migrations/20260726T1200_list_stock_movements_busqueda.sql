-- ============================================================================
-- Folvy · Almacén › Movimientos — la BÚSQUEDA pasa al servidor
-- Encargo: ENCARGO_CODE buscador de movimientos (26/07/2026) · reclamación abierta
--
-- Síntoma: buscar "pan hambur" (Alcalá, 7 días) devolvía 1 movimiento cuando en
-- BBDD hay ~30. La pantalla hacía creer que el almacén no registra los consumos.
--
-- Causa: `list_stock_movements` nunca supo buscar. El tipo y el rango de fechas
-- SÍ viajaban como parámetros, pero el texto se filtraba en el navegador sobre
-- las 300 filas ya descargadas. Los movimientos de Pan Hamburguesa ocupan las
-- posiciones 61, 568, 624, 739… del orden por fecha: sólo el primero entraba.
--
-- Arreglo: p_search filtra por nombre de artículo DENTRO de `base`, es decir,
-- antes del recorte por limit/offset y antes de contar. Además el retorno gana:
--   · total      → resultados del filtro activo (búsqueda incluida) → paginar bien
--   · total_all  → los del filtro SIN la búsqueda → permite decir "31 de 3287"
--   · sum_in / sum_out / units → entradas y salidas POR SEPARADO. Una suma única
--     mentiría: en "Todos", los 31 movimientos de Pan Hamburguesa mezclan 240 de
--     recepción, 492 de ajuste y 58 de consumo. Separadas se pueden contrastar
--     contra la BBDD de un vistazo. Sólo se enseñan si todas las filas comparten
--     unidad (nunca sumar kilos con unidades).
--
-- Búsqueda insensible a mayúsculas y acentos (unaccent, ya instalada): "limon"
-- encuentra "Limón", igual que hacía el filtro en cliente. Comodines escapados:
-- un '%' escrito por el usuario busca un '%' literal, no "todo".
--
-- FIRMA: se sustituye la de 7 argumentos por una de 8 (p_search al final, con
-- DEFAULT). Se hace DROP + CREATE para no dejar dos sobrecargas (PostgREST no
-- sabría cuál elegir). La web ya desplegada llama con argumentos NOMBRADOS y sin
-- p_search → sigue funcionando exactamente igual mientras no se despliegue el
-- front nuevo. Orden de despliegue seguro: primero esta migración, luego Vercel.
--
-- NO se toca la definición del rango de fechas (7 días = hoy + 6 anteriores).
-- IDEMPOTENTE y transaccional. Aplicar a mano en el SQL Editor.
-- ============================================================================

begin;

drop function if exists public.list_stock_movements(uuid, uuid, text[], timestamptz, timestamptz, integer, integer);

create or replace function public.list_stock_movements(
  p_account  uuid,
  p_location uuid,
  p_types    text[]      default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_limit    integer     default 200,
  p_offset   integer     default 0,
  p_search   text        default null
)
returns jsonb
language sql
set search_path to 'public'
as $function$
with q as (
  -- Término normalizado (sin acentos, minúsculas) y con los comodines de LIKE
  -- escapados. Vacío o sólo espacios = sin búsqueda.
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
-- Universo del filtro SIN búsqueda: es el "de 3287" del contador.
todos as (
  select count(*) as n from base
),
-- Lo que de verdad se está mirando (búsqueda aplicada, si la hay).
filtrado as (
  select b.* from base b, q
  where q.term is null
     or unaccent(lower(b.item_name)) like '%' || q.term || '%' escape '\'
),
resolved as (
  select f.*,
    case f.source_type
      when 'sale' then (
        select trim(both ' ·' from
          coalesce(sc.name, initcap(s.external_channel_text), 'Venta')
          || coalesce(' · ' || nullif((case when left(btrim(s.raw_tab),1) = '{' then s.raw_tab::jsonb->>'code' else null end), ''), ''))
        from sale_line sl
        join sale s on s.id = sl.sale_id
        left join sales_channel sc on sc.id = s.channel_id
        where sl.id = f.source_id
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
  from filtrado f
)
select jsonb_build_object(
  'total',       (select count(*) from filtrado),
  'total_all',   (select n from todos),
  'sum_in',      coalesce((select round(sum(qty_base) filter (where qty_base > 0), 3) from filtrado), 0),
  'sum_out',     coalesce((select round(sum(-qty_base) filter (where qty_base < 0), 3) from filtrado), 0),
  -- Unidades distintas presentes en el resultado: la pantalla sólo enseña el
  -- total de unidades cuando hay UNA, para no sumar kg con uds.
  'units', coalesce((
    select jsonb_agg(distinct coalesce(unit_abbr, '')) from filtrado
  ), '[]'::jsonb),
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id,
             'movement_type', r.movement_type,
             'source_type', r.source_type,
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
    from (
      select * from resolved order by occurred_at desc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) r
  ), '[]'::jsonb)
);
$function$;

comment on function public.list_stock_movements(uuid, uuid, text[], timestamptz, timestamptz, integer, integer, text) is
  'Libro mayor del almacén. p_search filtra por nombre de artículo EN SERVIDOR (sin acentos), antes de contar y de paginar. total = resultados de la búsqueda; total_all = del filtro sin búsqueda.';

commit;

-- ============================================================================
-- VERIFICACIÓN (fuera de la transacción)
-- ============================================================================
-- 1) El caso de la reclamación — debe devolver TODOS los de Pan Hamburguesa,
--    no 1. (La cifra exacta sube cada día: contrástala con la consulta 2.)
--    select jsonb_build_object(
--             'total',     r->'total',
--             'total_all', r->'total_all',
--             'sum_abs',   r->'sum_qty_abs',
--             'devueltos', jsonb_array_length(r->'items'))
--    from public.list_stock_movements(
--           (select account_id from public.locations where id='38158159-cd71-4056-950b-53425afac1ce'),
--           '38158159-cd71-4056-950b-53425afac1ce',
--           null, (current_date - 6)::timestamptz, null, 200, 0, 'pan hambur') r;
--
-- 2) Contraste directo contra la tabla (mismo criterio: occurred_at):
--    select count(*), sum(abs(qty_base))
--    from public.stock_movement sm join public.recipe_item ri on ri.id = sm.recipe_item_id
--    where sm.location_id='38158159-cd71-4056-950b-53425afac1ce'
--      and unaccent(lower(ri.name)) like '%pan hambur%'
--      and sm.occurred_at >= (current_date - 6);
--
-- 3) Volumen alto (paginación): idem con 'pan de pita'.
-- ============================================================================
