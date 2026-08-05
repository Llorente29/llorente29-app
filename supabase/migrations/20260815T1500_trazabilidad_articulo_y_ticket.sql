-- ============================================================================
-- TRAZABILIDAD DE ARTÍCULO — RPC de lectura para las dos pantallas nuevas.
--
-- Tres piezas, todas de SOLO LECTURA (ni una escritura):
--
--   1) list_stock_movements  (ARREGLO OBLIGATORIO, no cosmético)
--        Resolvía el origen legible de un consumo con
--            join sale_line sl on sl.id = f.source_id
--        es decir, SOLO para el motor legacy (source_id = sale_line.id). Tras
--        20260815T1300 todos los consumos son del motor A (source_id =
--        sale.id), así que sin este arreglo la columna "Origen" de la pantalla
--        de Movimientos se quedaría VACÍA para todas las ventas. Ahora resuelve
--        por los DOS caminos y además expone sale_id, que es lo que necesita el
--        "ojo" para abrir el ticket.
--
--   2) list_item_stock_movements  (NUEVA — Pantalla 1)
--        Movimientos de UN artículo en UN local, con saldo y coste ACUMULADOS
--        (running balance) calculados sobre el ledger COMPLETO, no sobre la
--        página: si se acumulase solo lo paginado, la columna "cantidad total"
--        mentiría en cuanto pasaras a la página 2. Devuelve además la serie
--        diaria por familia de movimiento para el gráfico apilado.
--
--   3) get_sale_ticket  (NUEVA — Pantalla 2)
--        Cabecera + líneas de una venta con coste, aportación y margen. NO
--        recalcula el coste: lee sale_line.computed_cost, que es lo que ya
--        sella compute_sale_line_cost. Un segundo cálculo aquí sería una
--        segunda verdad, que es justo lo que este encargo viene a arreglar.
--
-- SEGURIDAD: las tres son SECURITY INVOKER (sin SECURITY DEFINER) → la RLS de
-- stock_movement / sale / sale_line se aplica tal cual con el JWT del que
-- llama. No hace falta guard de cuenta propio: no se puede leer lo que la RLS
-- no deja leer. (list_stock_movements ya era invoker; se mantiene.)
--
-- Ninguna firma existente cambia: list_stock_movements conserva sus 8
-- parámetros y su tipo de retorno jsonb → CREATE OR REPLACE es suficiente.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) list_stock_movements — origen legible de ventas por AMBOS caminos.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.list_stock_movements(
  p_account uuid,
  p_location uuid,
  p_types text[] default null,
  p_from timestamp with time zone default null,
  p_to timestamp with time zone default null,
  p_limit integer default 200,
  p_offset integer default 0,
  p_search text default null
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
resolved as (
  select f.*,
    -- La venta a la que pertenece el movimiento, venga como venga el source_id:
    --   motor A     → source_id = sale.id
    --   legacy B    → source_id = sale_line.id  (se sube a su sale_id)
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
  from filtrado f
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
    from (
      select * from resolved order by occurred_at desc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) r
  ), '[]'::jsonb)
);
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) list_item_stock_movements — Pantalla 1 (ficha de trazabilidad).
--    Devuelve { item, total, series[], items[] }.
--    'series' es la serie diaria por familia para el gráfico apilado.
--    'running_qty'/'running_cost' se calculan sobre TODO el ledger del par
--    (item, local) hasta ese movimiento — independientes de la paginación.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.list_item_stock_movements(
  p_account uuid,
  p_item uuid,
  p_location uuid,
  p_from timestamp with time zone default null,
  p_to timestamp with time zone default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with todos as (
  -- Ledger COMPLETO del par (item, local): base del acumulado.
  select sm.id, sm.movement_type, sm.source_type, sm.source_id,
         sm.qty_base, sm.unit_cost, sm.occurred_at, sm.created_by_name, sm.notes,
         sum(sm.qty_base) over (order by sm.occurred_at, sm.id
                                rows between unbounded preceding and current row) as running_qty,
         sum(sm.qty_base * coalesce(sm.unit_cost, 0)) over (order by sm.occurred_at, sm.id
                                rows between unbounded preceding and current row) as running_cost
  from stock_movement sm
  where sm.account_id = p_account
    and sm.recipe_item_id = p_item
    and sm.location_id = p_location
),
-- Ventana visible (filtro de fechas). El acumulado ya viene calculado desde el
-- origen del ledger, así que filtrar aquí no lo falsea.
ventana as (
  select * from todos
  where (p_from is null or occurred_at >= p_from)
    and (p_to   is null or occurred_at <  p_to)
),
-- Familia de movimiento para el gráfico apilado (las 5 series del encargo).
fam as (
  select v.*,
    case v.movement_type
      when 'recepcion' then 'compras'
      when 'consumo' then 'ventas'
      when 'merma' then 'otros'
      when 'traspaso_entrada' then 'otros'
      when 'traspaso_salida' then 'otros'
      when 'ajuste' then 'inventarios'
      when 'recuento' then 'inventarios'
      when 'apertura' then 'inventarios'
      else 'otros'
    end as familia
  from ventana v
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
          coalesce(b.name, sc.name, initcap(s.external_channel_text), 'Venta')
          || coalesce(' · ' || nullif(s.platform_order_code, ''), '')
        )
        from sale s
        left join sales_channel sc on sc.id = s.channel_id
        left join brand b on b.id = s.brand_id
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
  from fam f
)
select jsonb_build_object(
  'item', (
    select jsonb_build_object(
      'id', ri.id, 'name', ri.name,
      'unit_abbr', ku.abbreviation,
      'qty_on_hand', coalesce(s.qty_on_hand, 0),
      'avg_unit_cost', s.avg_unit_cost,
      'stock_value', coalesce(s.stock_value, 0)
    )
    from recipe_item ri
    left join kitchen_unit ku on ku.id = ri.base_unit_id
    left join recipe_item_location_stock s
      on s.recipe_item_id = ri.id and s.location_id = p_location
    where ri.id = p_item
  ),
  'total', (select count(*) from ventana),
  'series', coalesce((
    select jsonb_agg(x order by x->>'dia')
    from (
      select jsonb_build_object(
        'dia', occurred_at::date,
        'familia', familia,
        'qty', round(sum(qty_base), 3)
      ) as x
      from fam
      group by occurred_at::date, familia
    ) t
  ), '[]'::jsonb),
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id,
             'movement_type', r.movement_type,
             'source_type', r.source_type,
             'sale_id', r.sale_id,
             'qty_base', r.qty_base,
             'unit_cost', r.unit_cost,
             'cost_eur', round(abs(r.qty_base) * coalesce(r.unit_cost, 0), 2),
             'running_qty', round(r.running_qty, 3),
             'running_cost', round(r.running_cost, 2),
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

-- ────────────────────────────────────────────────────────────────────────────
-- 3) get_sale_ticket — Pantalla 2 (detalle del ticket).
--    El coste sale de sale_line.computed_cost (sellado por
--    compute_sale_line_cost). Aquí NO se recalcula nada.
--    NOTA HONESTA: no hay trazabilidad de LOTE ni de zona de almacén por línea
--    de venta en el modelo actual — 'warehouse' y 'lots' se devuelven null a
--    propósito, como hueco preparado, en vez de inventar un dato.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_sale_ticket(p_sale_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
with s as (
  select * from sale where id = p_sale_id
),
lineas as (
  select sl.id, sl.product_name, sl.quantity, sl.unit_price, sl.line_total,
         sl.computed_cost, sl.line_type, sl.parent_sale_line_id,
         sl.discount_label, sl.original_unit_price, sl.map_needs_review,
         sl.unmapped_reason, sl.menu_item_id, sl.ignored_at,
         mi.name as menu_item_name
  from sale_line sl
  left join menu_item mi on mi.id = sl.menu_item_id
  where sl.sale_id = p_sale_id
),
tot as (
  select
    coalesce(sum(computed_cost) filter (where coalesce(line_type,'product')='product'), 0) as coste,
    count(*) filter (where coalesce(line_type,'product')='product' and computed_cost is null) as lineas_sin_coste
  from lineas
)
select jsonb_build_object(
  'sale', (
    select jsonb_build_object(
      'id', s.id,
      'sold_at', s.sold_at,
      'brand', coalesce(b.name, s.external_brand_text),
      'channel', coalesce(sc.name, initcap(s.external_channel_text)),
      'location', l.name,
      'order_status', s.order_status,
      'status', s.status,
      'source', s.source,
      'ticket_code', coalesce(nullif(s.platform_order_code,''), nullif(s.pos_short_code,''), s.external_ref),
      'total', s.total,
      'taxable_base', s.taxable_base,
      'tax', s.tax,
      'discount_amount', s.discount_amount,
      'service_type', s.service_type,
      -- Coste = suma de los computed_cost sellados de las líneas product.
      -- 'cost_complete' avisa de si esa suma está completa: con líneas sin
      -- escandallo resuelto el margen que se muestre es optimista, y hay que
      -- decirlo en pantalla en vez de pintar un número redondo mentiroso.
      'cost', (select round(coste, 2) from tot),
      'lines_without_cost', (select lineas_sin_coste from tot),
      'cost_complete', (select lineas_sin_coste = 0 from tot),
      'margin_eur', round(coalesce(s.taxable_base, s.total, 0) - (select coste from tot), 2),
      'margin_pct', case
        when coalesce(s.taxable_base, s.total, 0) > 0
        then round(((coalesce(s.taxable_base, s.total, 0) - (select coste from tot))
                    / coalesce(s.taxable_base, s.total)) * 100, 1)
        else null end
    )
    from s
    left join brand b on b.id = s.brand_id
    left join sales_channel sc on sc.id = s.channel_id
    left join locations l on l.id = s.location_id
  ),
  'lines', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', ln.id,
      'product_name', coalesce(ln.menu_item_name, ln.product_name),
      'raw_name', ln.product_name,
      'quantity', ln.quantity,
      'unit_price', ln.unit_price,
      'line_total', ln.line_total,
      'unit_cost', case when ln.quantity > 0 then round(ln.computed_cost / ln.quantity, 4) else null end,
      'computed_cost', ln.computed_cost,
      'contribution', case when ln.computed_cost is not null
                           then round(coalesce(ln.line_total, 0) - ln.computed_cost, 2) else null end,
      'margin_pct', case when ln.computed_cost is not null and coalesce(ln.line_total, 0) > 0
                         then round(((ln.line_total - ln.computed_cost) / ln.line_total) * 100, 1)
                         else null end,
      'line_type', coalesce(ln.line_type, 'product'),
      'parent_id', ln.parent_sale_line_id,
      'discount_label', ln.discount_label,
      'original_unit_price', ln.original_unit_price,
      'needs_review', coalesce(ln.map_needs_review, false),
      'unmapped_reason', ln.unmapped_reason,
      'ignored', ln.ignored_at is not null,
      -- Huecos preparados: el modelo no guarda zona ni lote por línea de venta.
      'warehouse', null,
      'lots', null
    ) order by ln.parent_sale_line_id nulls first, ln.product_name)
    from lineas ln
  ), '[]'::jsonb)
);
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — las tres existen y no son SECURITY DEFINER (la RLS debe aplicarse
-- con el JWT del que llama, no saltarse).
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_faltan text;
  v_definer text;
begin
  select string_agg(x, ', ') into v_faltan
  from unnest(array['list_stock_movements','list_item_stock_movements','get_sale_ticket']) x
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = x
  );
  if v_faltan is not null then
    raise exception 'MIGRACIÓN FALLIDA: no se crearon: %', v_faltan;
  end if;

  select string_agg(p.proname, ', ') into v_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('list_stock_movements','list_item_stock_movements','get_sale_ticket');
  if v_definer is not null then
    raise exception 'MIGRACIÓN FALLIDA: % es SECURITY DEFINER y debe ser INVOKER (RLS)', v_definer;
  end if;

  raise notice 'OK — 3 RPC de trazabilidad creadas, todas SECURITY INVOKER.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, aparte):
--   OJO con el id del local: hay DOS locales llamados 'Foodint Alcalá' (uno en
--   la cuenta Foodint y otro en Folvy Interno), así que buscarlo por nombre en
--   una subconsulta escalar revienta con "more than one row returned". Se pasa
--   el uuid explícito de Foodint:
--
--   select public.list_item_stock_movements(
--     '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid,   -- cuenta Foodint
--     '52aa4147-d2de-4bfd-9679-5a757247c16c'::uuid,   -- Milanesa de Pollo Rebozado
--     '38158159-cd71-4056-950b-53425afac1ce'::uuid,   -- local Foodint Alcalá
--     now() - interval '7 days', null, 20, 0);
--   -- Probado ya contra datos reales (sin crear la función): devuelve
--   -- reference "Milanesa House · 101734473586" y running_qty acumulado.
--
--   select public.get_sale_ticket((
--     select sm.source_id from stock_movement sm
--     where sm.movement_type='consumo' and sm.notes='Consumo por venta'
--     order by sm.occurred_at desc limit 1));
--   -- Probado ya: marca 'Milanesa Haus', canal 'Glovo', base 27,47 €,
--   -- coste 9,32 €, margen 18,15 €, 2 líneas.
-- ============================================================================
