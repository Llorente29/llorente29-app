-- ============================================================================
-- BUG CRÍTICO — DOBLE DESCUENTO DE STOCK: limpieza del histórico duplicado.
--
-- Hermana de 20260815T1300_fix_doble_consumo_venta_ddl.sql (que corta el grifo).
-- Esta borra lo YA escrito. Ficheros separados a propósito: el DDL redefine
-- funciones SECURITY DEFINER y no deben ejecutarse en la misma transacción que
-- las crea. APLICAR EL DDL PRIMERO.
--
-- QUÉ SE BORRA — y, sobre todo, QUÉ NO:
--   Se borra un movimiento 'consumo teorico' (motor legacy B, source_id =
--   sale_line.id) SOLO SI su venta tiene también consumo del motor A
--   ('Consumo por venta', source_id = sale.id). Es decir: solo se borra la
--   COPIA, nunca el único consumo de una venta.
--
--   Fotografía previa (BD viva, 2026-08-15):
--     Foodint        16.940 borrables (duplicados reales)
--                       977 huérfanos en 108 ventas  → SE QUEDAN
--     Folvy Interno       0 borrables
--                       247 huérfanos en  25 ventas  → SE QUEDAN
--   Los huérfanos son ventas anteriores a que existiera el motor A (Foodint
--   arranca A el 20/06; el legacy venía del 12/06 — y Folvy Interno, cuenta de
--   pruebas, murió el 11/06). Borrarlos dejaría esas ventas sin ningún consumo,
--   que es MENTIRA distinta pero mentira igual. Se quedan con su etiqueta
--   legacy, que además sirve de marca histórica de "esto viene del motor viejo".
--
-- CONSECUENCIA HONESTA SOBRE EL STOCK: tras esta limpieza el stock deja de
--   descontar el doble, pero NO queda "correcto" — queda MENOS malo. Sigue
--   arrastrando (a) el consumo no registrado de las 652 ventas de 30 días cuyas
--   líneas no tienen escandallo resuelto (computed_cost NULL) y (b) el sesgo ya
--   acumulado en los meses previos. La única vía de volver a la verdad es un
--   INVENTARIO FÍSICO que siente el saldo real. Esto se deja dicho aquí para que
--   nadie interprete el recálculo como "stock ya fiable".
--
-- El script corre ENTERO en una transacción (SQL Editor). Sin COMMIT/ROLLBACK
-- dentro: o cuadra todo o no se aplica nada.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 0) Guard de orden: exige que el DDL hermano ya esté aplicado. Si close_sale
--    sigue llamando al motor legacy, limpiar ahora sería tirar agua en un cubo
--    agujereado (la próxima venta vuelve a duplicar).
-- ────────────────────────────────────────────────────────────────────────────
do $guard_orden$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'close_sale'
      and pg_get_functiondef(p.oid) ilike '%compute_sale_line_consumption%'
  ) then
    raise exception
      'ABORTADO: close_sale todavía llama al motor legacy. Aplica primero 20260815T1300_fix_doble_consumo_venta_ddl.sql';
  end if;
  raise notice 'Orden OK: el DDL hermano ya está aplicado.';
end
$guard_orden$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Selección de víctimas + fotografía previa.
--    Tabla temporal (muere con la sesión) con los movimientos a borrar y los
--    pares (item, local) que habrá que recalcular después.
-- ────────────────────────────────────────────────────────────────────────────
create temporary table _dup_a_borrar on commit drop as
select sm.id, sm.account_id, sm.recipe_item_id, sm.location_id, sm.qty_base
from stock_movement sm
join sale_line sl on sl.id = sm.source_id
where sm.movement_type = 'consumo'
  and sm.source_type   = 'sale'
  and sm.notes         = 'consumo teorico'
  and exists (
    select 1 from stock_movement a
    where a.movement_type = 'consumo'
      and a.source_type   = 'sale'
      and a.notes         = 'Consumo por venta'
      and a.source_id     = sl.sale_id
  );

do $foto$
declare
  v_borrables   bigint;
  v_huerfanos   bigint;
  v_pares       bigint;
begin
  select count(*) into v_borrables from _dup_a_borrar;

  select count(*) into v_huerfanos
  from stock_movement sm
  where sm.movement_type = 'consumo' and sm.source_type = 'sale'
    and sm.notes = 'consumo teorico'
    and sm.id not in (select id from _dup_a_borrar);

  select count(*) into v_pares
  from (select distinct recipe_item_id, location_id from _dup_a_borrar) t;

  raise notice 'ANTES → duplicados a borrar: % | huérfanos que se conservan: % | pares (item,local) a recalcular: %',
    v_borrables, v_huerfanos, v_pares;
end
$foto$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) GUARD DE SEGURIDAD — ninguna venta puede quedarse sin consumo.
--    Comprueba, ANTES de borrar, que toda venta tocada por el borrado conserva
--    consumo del motor A. Por construcción del EXISTS de arriba debe ser
--    imposible que falle; se verifica igual porque el coste de equivocarse es
--    un inventario sin trazabilidad de ventas.
-- ────────────────────────────────────────────────────────────────────────────
do $guard_huerfanas$
declare
  v_sin_a bigint;
begin
  select count(distinct sl.sale_id) into v_sin_a
  from _dup_a_borrar d
  join stock_movement sm on sm.id = d.id
  join sale_line sl on sl.id = sm.source_id
  where not exists (
    select 1 from stock_movement a
    where a.movement_type = 'consumo' and a.source_type = 'sale'
      and a.notes = 'Consumo por venta' and a.source_id = sl.sale_id
  );

  if v_sin_a > 0 then
    raise exception 'ABORTADO: % ventas se quedarían sin consumo tras el borrado', v_sin_a;
  end if;
  raise notice 'Guard OK: ninguna venta se queda sin consumo.';
end
$guard_huerfanas$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Borrado de los duplicados.
-- ────────────────────────────────────────────────────────────────────────────
delete from stock_movement sm
using _dup_a_borrar d
where sm.id = d.id;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Recálculo del stock de cada par (item, local) tocado.
--    recompute_location_stock_core reconstruye qty_on_hand/avg_unit_cost/
--    stock_value sumando el ledger entero — no aplica deltas, así que es exacto
--    y repetible. NO se modifica en el DDL hermano, luego es seguro invocarla
--    aquí (no cae en la regla de "no ejecutar lo que acabas de crear").
-- ────────────────────────────────────────────────────────────────────────────
do $recalculo$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select distinct recipe_item_id, location_id
    from _dup_a_borrar
    where recipe_item_id is not null and location_id is not null
  loop
    perform public.recompute_location_stock_core(r.recipe_item_id, r.location_id);
    v_n := v_n + 1;
  end loop;
  raise notice 'Stock recalculado en % pares (item, local).', v_n;
end
$recalculo$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Fotografía posterior + guard final: no puede quedar ninguna venta con las
--    DOS etiquetas a la vez (que es, literalmente, la definición del bug).
-- ────────────────────────────────────────────────────────────────────────────
do $despues$
declare
  v_legacy   bigint;
  v_motor_a  bigint;
  v_dobles   bigint;
begin
  select count(*) into v_legacy
  from stock_movement
  where movement_type='consumo' and source_type='sale' and notes='consumo teorico';

  select count(*) into v_motor_a
  from stock_movement
  where movement_type='consumo' and source_type='sale' and notes='Consumo por venta';

  select count(*) into v_dobles
  from (
    select sl.sale_id
    from stock_movement sm join sale_line sl on sl.id = sm.source_id
    where sm.movement_type='consumo' and sm.source_type='sale' and sm.notes='consumo teorico'
    intersect
    select sm.source_id
    from stock_movement sm
    where sm.movement_type='consumo' and sm.source_type='sale' and sm.notes='Consumo por venta'
  ) t;

  raise notice 'DESPUÉS → legacy restante (huérfanos): % | motor A: % | ventas con doble consumo: %',
    v_legacy, v_motor_a, v_dobles;

  if v_dobles > 0 then
    raise exception 'MIGRACIÓN FALLIDA: siguen existiendo % ventas con consumo duplicado', v_dobles;
  end if;
end
$despues$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, en transacción APARTE):
--
--   -- El caso testigo del encargo debe bajar de 67 a 35 uds.
--   -- (uuid de local explícito: hay DOS 'Foodint Alcalá', uno por cuenta.)
--   select sm.notes, count(*) as movimientos, sum(abs(sm.qty_base)) as milanesas
--     from stock_movement sm
--    where sm.recipe_item_id = '52aa4147-d2de-4bfd-9679-5a757247c16c'
--      and sm.location_id = '38158159-cd71-4056-950b-53425afac1ce'
--      and sm.movement_type = 'consumo'
--      and sm.occurred_at >= (now()::date - interval '1 day')
--    group by 1;
--   -- Esperado: solo 'Consumo por venta' ≈ 35.
--
--   -- Stock resultante del testigo (los 3 locales de Foodint):
--   select l.name, s.qty_on_hand, s.avg_unit_cost, s.stock_value
--     from recipe_item_location_stock s join locations l on l.id = s.location_id
--    where s.recipe_item_id = '52aa4147-d2de-4bfd-9679-5a757247c16c'
--      and l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
-- ============================================================================
