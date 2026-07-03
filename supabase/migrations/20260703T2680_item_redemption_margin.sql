-- 20260703T2680_item_redemption_margin.sql
-- Aplicada: (pendiente)
--
-- G2e.2 (DEUDA DEL MOTOR, no de escandallo) — Guardar margin_after REAL al registrar
-- el canje de las campañas de item (free_delivery / item_percent-bogo / free_item),
-- no NULL. Los datos existen: v_subtotal (post-oferta) y v_cost_known ya se calculan
-- en el bucle de líneas (mismo patrón que el cupón de subtotal). Así el ROI del
-- dashboard (G2e) funciona en TODOS los tipos, no solo en los de subtotal.
--
-- margin_after (atribución a nivel de ORDEN, como el cupón de subtotal):
--   item_percent/bogo : v_subtotal - v_cost_known           (la oferta ya está en v_subtotal)
--   free_delivery      : v_subtotal - v_cost_known - v_fd_discount   (el envío lo come el local)
--   free_item          : v_subtotal - v_cost_known - coste_regalo    (null-propaga si el regalo
--                        no tiene escandallo -> honesto: no se inventa el neto)
-- En todos, NULL si v_cost_has_null (alguna línea sin escandallo) — deuda REAL de
-- escandallo, la única honesta.
--
-- Vía fiel sin transcribir: regenera place_shop_order del texto VIVO (post-2640) +
-- replace() anclados en las 3 líneas de canje (cada una única por su importe), con
-- guardas (aborta si falta un ancla) e idempotencia. Solo cambia el valor grabado en
-- margin_after; NO toca el total cobrado. Requiere 2640. No se prueba en la tx.

begin;

do $mig$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.place_shop_order(text, jsonb, boolean)'::regprocedure);

  if position('round(v_subtotal - v_cost_known, 2) end, true)' in v_def) > 0 then
    raise notice 'G2e.2: margin_after de item ya presente; nada que hacer.';
    return;
  end if;

  -- (1) free_delivery: margin = v_subtotal - v_cost_known - v_fd_discount.
  v_def := replace(v_def,
$a1$        round(v_fd_discount,2), round(v_subtotal,2), null, true);$a1$,
$r1$        round(v_fd_discount,2), round(v_subtotal,2), case when v_cost_has_null then null else round(v_subtotal - v_cost_known - v_fd_discount, 2) end, true);$r1$);
  if position('round(v_subtotal - v_cost_known - v_fd_discount, 2) end, true)' in v_def) = 0 then
    raise exception 'G2e.2: ancla 1 (canje free_delivery) no encontrada';
  end if;

  -- (2) item_percent / bogo: margin = v_subtotal - v_cost_known (oferta ya en v_subtotal).
  v_def := replace(v_def,
$a2$          round(v_promo_du,2), round(v_subtotal,2), null, true);$a2$,
$r2$          round(v_promo_du,2), round(v_subtotal,2), case when v_cost_has_null then null else round(v_subtotal - v_cost_known, 2) end, true);$r2$);
  if position('round(v_subtotal - v_cost_known, 2) end, true)' in v_def) = 0 then
    raise exception 'G2e.2: ancla 2 (canje item_percent/bogo) no encontrada';
  end if;

  -- (3) free_item: margin = v_subtotal - v_cost_known - coste del regalo (null si no costeado).
  v_def := replace(v_def,
$a3$        round(v_gift_price, 2), round(v_subtotal, 2), null, true);$a3$,
$r3$        round(v_gift_price, 2), round(v_subtotal, 2), case when v_cost_has_null then null else round(v_subtotal - v_cost_known - (select ri.computed_cost + coalesce(mi.packaging_cost, 0) from menu_item mi join recipe_item ri on ri.id = mi.recipe_item_id where mi.id = v_gift_id and ri.computed_cost is not null), 2) end, true);$r3$);
  if position('where mi.id = v_gift_id and ri.computed_cost is not null), 2) end, true)' in v_def) = 0 then
    raise exception 'G2e.2: ancla 3 (canje free_item) no encontrada';
  end if;

  execute v_def;
  raise notice 'G2e.2: margin_after real grabado en los canjes de item.';
end
$mig$;

commit;
