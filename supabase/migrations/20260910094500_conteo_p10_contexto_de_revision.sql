-- 20260910094500_conteo_p10_contexto_de_revision.sql
--
-- CONTAR POR FORMATOS · PASO 10 (§2.4) — LA FRASE DE LA CONTRADICCIÓN
--
-- La pantalla de aprobación tiene que poder escribir, con nombres propios:
--
--   «Pamela contó 9 kg el 03/09 a las 21:00. Desde entonces no ha entrado
--    peperoni y se han vendido 125 g.»
--
-- Eso son cuatro datos por línea (quién, cuándo, cuánto, y qué se ha movido
-- desde entonces) que no están en `inventory_count_line`. Sacarlos con una
-- consulta por línea sería 36 viajes para pintar una tabla; esta RPC los trae
-- todos de una.
--
-- ES DE LECTURA. No escribe nada, no decide nada y no marca nada: la pantalla
-- decide qué contar como contradicción con los umbrales de `supply_settings`.
-- Aquí sólo salen los hechos.
--
-- REGLA 9 · todo va anclado por `account_id` y `location_id`, nunca por nombre.
-- Las tres cuentas comparten nombres de artículo Y de local.

BEGIN;

CREATE OR REPLACE FUNCTION public.count_review_context(p_count_id uuid)
RETURNS TABLE(
  line_id          uuid,
  prev_qty         numeric,
  prev_counted_at  timestamptz,
  prev_by_name     text,
  moved_since      numeric,   -- suma con signo de lo movido (sin inventario)
  received_since   numeric,   -- sólo lo que ENTRÓ por recepción o traspaso
  sold_since       numeric    -- sólo lo que salió por consumo de venta
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cab AS (
    SELECT ic.id, ic.account_id, ic.location_id
      FROM public.inventory_count ic
     WHERE ic.id = p_count_id
       AND public.belongs_to_account(ic.account_id)
  ),
  lineas AS (
    SELECT l.id, l.recipe_item_id, c.account_id, c.location_id
      FROM public.inventory_count_line l
      JOIN cab c ON c.id = l.inventory_count_id
  ),
  anterior AS (
    SELECT ln.id AS line_id, p.counted_qty, p.counted_at, p.counted_by_name,
           ln.recipe_item_id, ln.location_id
      FROM lineas ln
      LEFT JOIN LATERAL (
        SELECT prev.counted_qty, prev.counted_at, prev.counted_by_name
          FROM public.inventory_count_line prev
          JOIN public.inventory_count pic ON pic.id = prev.inventory_count_id
         WHERE prev.recipe_item_id = ln.recipe_item_id
           AND prev.account_id     = ln.account_id
           AND pic.location_id     = ln.location_id
           AND pic.status          = 'aprobado'
           AND prev.counted_qty IS NOT NULL
           AND prev.counted_at  IS NOT NULL
           AND prev.id <> ln.id
         ORDER BY prev.counted_at DESC
         LIMIT 1
      ) p ON true
  )
  SELECT a.line_id,
         a.counted_qty,
         a.counted_at,
         a.counted_by_name,
         COALESCE(m.movido, 0),
         COALESCE(m.entrado, 0),
         COALESCE(m.vendido, 0)
    FROM anterior a
    LEFT JOIN LATERAL (
      SELECT SUM(sm.qty_base) AS movido,
             SUM(sm.qty_base) FILTER (
               WHERE sm.source_type = 'goods_receipt_line'
                  OR sm.movement_type IN ('recepcion','traspaso_entrada','apertura')) AS entrado,
             -SUM(sm.qty_base) FILTER (WHERE sm.movement_type = 'consumo') AS vendido
        FROM public.stock_movement sm
       WHERE sm.recipe_item_id = a.recipe_item_id
         AND sm.location_id    = a.location_id
         AND sm.source_type   <> 'inventory_count'
         AND sm.occurred_at    > a.counted_at
    ) m ON a.counted_at IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.count_review_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_review_context(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.count_review_context(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.count_review_context(uuid) TO authenticated;

COMMENT ON FUNCTION public.count_review_context(uuid) IS
  'Los hechos que necesita la pantalla de aprobación para explicar una '
  'contradicción con nombres, fecha y cantidad: el recuento anterior aprobado y '
  'lo que se ha movido desde entonces (§2.4, 10/09/2026). Sólo lectura.';

COMMIT;
