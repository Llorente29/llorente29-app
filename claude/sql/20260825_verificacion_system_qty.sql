-- 20260825_verificacion_system_qty.sql
-- Consultas de VERIFICACIÓN (solo lectura salvo el bloque 6, marcado).
-- Orden de uso:
--   A) 1 y 2 ANTES de aplicar nada  → foto del daño.
--   B) aplicar 20260825T1000_inventory_system_qty_desde_ledger.sql
--   C) 3 y 4                        → el motor ya reconstruye el teórico.
--   D) aplicar 20260825T1100_backfill_variance_historico.sql
--   E) 5                            → el histórico dejó de mentir.

-- ══ 1) INV-00181: informado vs real, línea a línea ════════════════════════
-- Antes del fix: 'variance_informada' es lo que ve el gestor;
-- 'variance_real' es lo que apply_inventory_count asentaría de verdad.
-- Si las dos columnas no coinciden, el informe y el asiento no cuadran.
with c as (
  select id, account_id, location_id,
         coalesce(started_at, closed_at, created_at) as v_instant
  from public.inventory_count where code = 'INV-00181'
)
select ri.name                                              as articulo,
       l.counted_at,
       l.system_qty                                         as teorico_informado,
       coalesce((select sum(sm.qty_base) from public.stock_movement sm
                  where sm.recipe_item_id = l.recipe_item_id
                    and sm.location_id    = c.location_id
                    and sm.occurred_at    < coalesce(l.counted_at, c.v_instant)), 0)
                                                            as teorico_real,
       l.counted_qty,
       l.variance_qty                                       as variance_informada,
       l.counted_qty - coalesce((select sum(sm.qty_base) from public.stock_movement sm
                  where sm.recipe_item_id = l.recipe_item_id
                    and sm.location_id    = c.location_id
                    and sm.occurred_at    < coalesce(l.counted_at, c.v_instant)), 0)
                                                            as variance_real
from public.inventory_count_line l
join c on c.id = l.inventory_count_id
join public.recipe_item ri on ri.id = l.recipe_item_id
order by l.position;

-- ══ 2) La prueba de que informe y asiento ya no cuadran ═══════════════════
-- Para los ajustes YA asentados por este conteo: qty_base (lo que se movió de
-- verdad) frente a variance_qty (lo que dice el informe). En INV-00181 sale
-- Cilantro: se asentó +8,1585 y el informe dice +4,4542.
select ri.name                as articulo,
       sm.qty_base            as ajuste_asentado,
       l.variance_qty         as variance_informada,
       sm.qty_base - l.variance_qty as descuadre
from public.stock_movement sm
join public.inventory_count ic on ic.id = sm.source_id
join public.inventory_count_line l
  on l.inventory_count_id = ic.id and l.recipe_item_id = sm.recipe_item_id
join public.recipe_item ri on ri.id = sm.recipe_item_id
where sm.source_type = 'inventory_count'
  and ic.code = 'INV-00181'
order by abs(sm.qty_base - l.variance_qty) desc;

-- ══ 3) Tras aplicar el fix del motor: el helper existe y cuadra ═══════════
select public.theoretical_qty_at(
         (select id from public.recipe_item
           where name = 'Pan Hamburguesa'
             and account_id = (select account_id from public.inventory_count where code='INV-00181')
           limit 1),
         (select location_id from public.inventory_count where code = 'INV-00181'),
         (select l.counted_at from public.inventory_count_line l
           join public.inventory_count ic on ic.id = l.inventory_count_id
           join public.recipe_item ri on ri.id = l.recipe_item_id
          where ic.code = 'INV-00181' and ri.name = 'Pan Hamburguesa')
       ) as teorico_pan_en_counted_at;   -- esperado: 137

-- ══ 4) Re-cerrar INV-00181 (está en 'en_revision', close es idempotente) ══
-- Ejecutar como gestor de la cuenta. Devuelve el resumen recalculado.
--   select * from public.close_inventory_count(
--     (select id from public.inventory_count where code = 'INV-00181'));
-- Después, repetir la consulta 1: teorico_informado y teorico_real deben ser
-- ya la misma columna, y Pan Hamburguesa debe quedar en variance -17
-- (NO 0: ver el punto 3 del informe — el resto es catálogo sin receta).

-- ══ 5) Histórico: qué cambió el backfill ═════════════════════════════════
select count(*)                                   as lineas,
       count(distinct inventory_count_id)         as conteos,
       round(sum(coalesce(old_variance_value,0)),2) as merma_antes_eur,
       round(sum(coalesce(new_variance_value,0)),2) as merma_despues_eur
from public.inventory_count_line_rebase_log
where batch = '20260825_system_qty_desde_ledger';

-- ══ 6) MANTENIMIENTO APARTE — desfase de la materialización de stock ══════
-- recipe_item_location_stock.qty_on_hand debería ser SUM(qty_base) del ledger
-- (es literalmente lo que calcula recompute_location_stock_core), pero el
-- motor de consumo asienta ventas sin recomputar. Medido hoy: 144 de 716
-- filas desalineadas. Esto NO afecta ya al conteo (system_qty pasa a salir
-- del ledger), pero sí a todo lo que enseña "stock actual" en la app.
-- (a) Medir:
with led as (
  select recipe_item_id, location_id, sum(qty_base) as ledger
  from public.stock_movement group by 1, 2
)
select count(*) filter (where abs(coalesce(ril.qty_on_hand,0) - coalesce(led.ledger,0)) > 0.0001) as desalineadas,
       count(*) as filas
from public.recipe_item_location_stock ril
left join led on led.recipe_item_id = ril.recipe_item_id and led.location_id = ril.location_id;
-- (b) Resincronizar (ESCRIBE: recalcula qty_on_hand / avg_unit_cost /
--     stock_value de TODA la tabla contra el ledger. Decisión de Julio.)
--   do $$
--   declare r record;
--   begin
--     for r in select recipe_item_id, location_id from public.recipe_item_location_stock loop
--       perform public.recompute_location_stock_core(r.recipe_item_id, r.location_id);
--     end loop;
--   end $$;
