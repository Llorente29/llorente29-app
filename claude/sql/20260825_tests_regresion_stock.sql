-- 20260825_tests_regresion_stock.sql
-- TESTS DE REGRESIÓN de la cadena de stock. Todos son SOLO LECTURA.
-- Regla: la columna `fallos` debe dar 0. Si da otra cosa, el bug volvió.
-- Ejecutar entero después de cada cambio en el motor de consumo o de conteo.

-- ══ T1 · (E3/D1) Combos sin mapear que no descuentan ══════════════════════
-- Bug 25-08: generate_sale_consumption exigía menu_item_id en la cabecera.
-- Un combo se resuelve por sus hijos; exigirlo dejaba el combo sin descontar.
-- Cuenta solo ventas POSTERIORES al fix (el histórico no se reprocesa solo).
select 'T1 combos sin consumo' as test,
       count(*) as fallos
from sale_line sl
join sale s on s.id = sl.sale_id
where coalesce(sl.line_type,'product') = 'product'
  and sl.menu_item_id is null
  and sl.ignored_at is null
  and exists (select 1 from sale_line c where c.parent_sale_line_id = sl.id and c.line_type='combo_item')
  and s.created_at > timestamptz '2026-08-25 06:30:00+00'   -- fecha del fix
  and coalesce(s.is_active,true) and coalesce(s.status,'') <> 'cancelled'
  and coalesce(s.order_status,'') not in ('cancelled','rejected')
  and not exists (select 1 from stock_movement sm
                   where sm.source_type='sale' and sm.movement_type='consumo' and sm.source_id = s.id);

-- ══ T2 · (E1/D2) Ventas anuladas que conservan consumo ════════════════════
-- Bug 25-08: solo cancel_sale() revertía; el webhook que mueve order_status a
-- 'cancelled' dejaba el stock descontado. Cuenta solo anulaciones posteriores
-- al fix (las 9 previas esperan autorización de limpieza).
select 'T2 anuladas con consumo' as test,
       count(distinct s.id) as fallos
from sale s
join stock_movement sm on sm.source_type='sale' and sm.movement_type='consumo' and sm.source_id = s.id
where (coalesce(s.status,'')='cancelled'
       or coalesce(s.order_status,'') in ('cancelled','rejected')
       or coalesce(s.is_active,true)=false)
  and coalesce(s.cancelled_at, s.updated_at) > timestamptz '2026-08-25 06:30:00+00';

-- ══ T3 · (E6/D3) Caché de stock desalineada del ledger ════════════════════
-- Bug 25-08: generate_sale_consumption era la única de 11 funciones que
-- escribía en el ledger sin refrescar recipe_item_location_stock.
-- Baseline ANTES del fix: 144 de 716 filas. Con el resync hecho debe ser 0;
-- sin el resync, lo que importa es que NO CREZCA.
with led as (
  select recipe_item_id, location_id, sum(qty_base) as ledger
  from stock_movement group by 1,2
)
select 'T3 cache desalineada' as test,
       count(*) filter (where abs(coalesce(ril.qty_on_hand,0) - coalesce(led.ledger,0)) > 0.0001) as fallos,
       count(*) as filas_totales
from recipe_item_location_stock ril
left join led on led.recipe_item_id = ril.recipe_item_id and led.location_id = ril.location_id;

-- ══ T4 · (E4) Líneas de escandallo que el motor salta en silencio ═════════
-- Bug del Arroz Criollo (#83): _qty_in_base devuelve NULL y explode_recipe_to_raws
-- hace CONTINUE sin avisar. Baseline 25-08: 0 de 1.758.
select 'T4 escandallo no convertible' as test,
       count(*) filter (where qb is null) as fallos,
       count(*) as lineas_totales
from (select public._qty_in_base(rl.child_item_id,
                                 coalesce(rl.quantity_gross, rl.quantity_net),
                                 rl.unit_id) as qb
      from recipe_line rl) t;

-- ══ T5 · (E4) Cantidades de escandallo que descuentan 0 ═══════════════════
select 'T5 cantidades cero/nulas' as test,
       count(*) as fallos
from recipe_line rl join recipe_item p on p.id = rl.parent_item_id and p.is_active
where coalesce(rl.quantity_gross, rl.quantity_net) is null
   or coalesce(rl.quantity_gross, rl.quantity_net) = 0
   or rl.unit_id is null;

-- ══ T6 · (E5) Salud del ledger ═══════════════════════════════════════════
select 'T6 ledger corrupto' as test,
       count(*) filter (where qty_base is null or qty_base = 0
                          or occurred_at is null or location_id is null
                          or occurred_at > now() + interval '1 day') as fallos,
       count(*) as movs_totales
from stock_movement;

-- ══ T7 · (E7) Recepciones duplicadas ═════════════════════════════════════
-- Misma línea de recepción con más de un movimiento del mismo artículo.
-- Baseline 25-08: 19 (histórico, pendiente de decisión).
select 'T7 recepciones duplicadas' as test, count(*) as fallos
from (select sm.source_id, sm.recipe_item_id
      from stock_movement sm where sm.source_type='goods_receipt_line'
      group by 1,2 having count(*) > 1) x;

-- ══ T8 · (E8/E9) Informe de conteo vs asiento de conteo ══════════════════
-- El informe (variance_qty) y el ajuste realmente asentado tienen que dar el
-- mismo número. Si no, el teórico del informe no sale del ledger.
select 'T8 informe != asiento' as test, count(*) as fallos
from stock_movement sm
join inventory_count ic on ic.id = sm.source_id
join inventory_count_line l on l.inventory_count_id = ic.id and l.recipe_item_id = sm.recipe_item_id
where sm.source_type = 'inventory_count'
  and ic.status in ('aprobado','en_revision')
  and ic.closed_at > timestamptz '2026-08-25 06:00:00+00'   -- conteos cerrados ya con el fix
  and abs(sm.qty_base - coalesce(l.variance_qty,0)) > 0.0001;

-- ══ T9 · (E3) Ventas vivas con producto con receta y CERO consumo ════════
-- No es un bug de motor por sí solo: si el escandallo se da de alta DESPUÉS de
-- la venta, esa venta no se reprocesa nunca. Vigila que no crezca.
-- Baseline 25-08: 75 ventas / 2.131,78 € en 30 días.
select 'T9 ventas sin consumo 30d' as test,
       count(*) as fallos
from sale s
where s.sold_at >= now() - interval '30 days'
  and coalesce(s.is_active,true) and coalesce(s.status,'') <> 'cancelled'
  and coalesce(s.order_status,'') not in ('cancelled','rejected')
  and exists (select 1 from sale_line sl join menu_item mi on mi.id = sl.menu_item_id
               where sl.sale_id = s.id and coalesce(sl.line_type,'product')='product'
                 and mi.recipe_item_id is not null and sl.ignored_at is null)
  and not exists (select 1 from stock_movement sm
                   where sm.source_type='sale' and sm.movement_type='consumo' and sm.source_id = s.id);

-- ══ T10 · (E5) Latencia del asiento de consumo ═══════════════════════════
-- No es un fallo: es el retraso estructural entre la venta y su asiento (el
-- pedido tarda en llegar a 'completed'). Manda sobre CUÁNDO se puede cerrar un
-- conteo. Baseline 25-08: p50 123 min, p90 129 min, max 912 min.
select 'T10 latencia consumo (min)' as test,
       round(percentile_cont(0.5) within group (order by extract(epoch from (created_at - occurred_at))/60)::numeric, 1) as p50,
       round(percentile_cont(0.9) within group (order by extract(epoch from (created_at - occurred_at))/60)::numeric, 1) as p90,
       round(max(extract(epoch from (created_at - occurred_at))/60)::numeric, 1) as max
from stock_movement
where source_type='sale' and movement_type='consumo' and occurred_at >= now() - interval '14 days';

-- ══ T11 · (tope de cordura) Cantidades imposibles en conteos ══════════════
-- Desde el 25-08 hay un trigger (trg_inventory_count_line_sanity) que rechaza
-- >1.000× el teórico, o el tope absoluto si no hay teórico, salvo confirmación
-- explícita del contador para ESE valor exacto. Baseline tras la limpieza: 0.
-- Si esto crece sin una confirmación detrás, el tope se ha caído.
select 'T11 cantidades imposibles' as test,
       count(*) filter (where l.counted_qty > 1000000
                          and l.counted_qty_confirmed is distinct from l.counted_qty) as fallos,
       count(*) filter (where l.counted_qty_confirmed = l.counted_qty) as confirmadas_a_mano,
       count(*) filter (where l.counted_qty < 0) as negativas
from public.inventory_count_line l
where l.counted_qty is not null;

-- ══ T12 · computed_cost = 0 tapando un fixed_cost válido ═════════════════
-- El motor usa COALESCE(computed_cost, fixed_cost, 0) y 0 no es NULL, así que
-- un cero guardado esconde el precio real de compra.
-- Baseline 26-08: 0
select count(*) as t12_cero_tapando_fijo
from recipe_item
where archived_at is null
  and computed_cost = 0
  and coalesce(fixed_cost,0) > 0;
