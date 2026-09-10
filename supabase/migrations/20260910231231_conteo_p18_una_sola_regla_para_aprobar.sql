-- 20260910231231_conteo_p18_una_sola_regla_para_aprobar.sql
--
-- UNA SOLA REGLA PARA DECIDIR QUÉ HAY QUE MIRAR ANTES DE APROBAR
--
-- Había DOS, y no coincidían:
--
--   La pantalla ...... «Para revisar» = diferencia ≥ 25 % Y ≥ 5 €. Lo demás
--                      «cuadra» y se aprueba de una vez.
--   apply_inventory_  pedía motivo a toda línea con `within_tolerance = false`
--   count ............ o `needs_review`, y la tolerancia la pone
--                      `close_inventory_count` por clase ABC: 2 / 3 / 5 %.
--
-- Resultado en INV-00218 (Alcalá, 10/09, 35 productos, 28 contados): la
-- pantalla ofrecía «Aprobar los 28 que cuadran» y la base contestaba
-- «apply_inventory_count: 13 línea(s) a revisar sin motivo». Un botón que la
-- base iba a rechazar, y ninguna forma de arreglarlo desde la pantalla.
--
-- MEDIDO ANTES DE TOCAR NADA, sobre INV-00218:
--   · 18 de las 28 contadas tienen `within_tolerance = false`.
--   · 5 de esas 18 ya llevaban motivo → 13 sin motivo. Coincide exactamente con
--     el error y con la lista de Julio: Patatas Bastón (+6,7 %, +13,62 €),
--     Sweet Potato Fries, Focaccia XXL, Bacon Ahumado, Salsa Tzatziki,
--     Hamburguesa Mixta, Pan Hamburguesa, Queso Mozarela, Milanesa Ternera,
--     Lechuga Romana, Pepinillos, Salsa Mil Islas y Tortilla Maíz.
--   · Las siete que la pantalla SÍ enseña son las siete que Julio rellenó.
--
-- QUÉ CAMBIA
--   1. `count_lines_requiring_reason(p_count_id)` es la regla, y es una. Devuelve
--      línea, nombre del artículo y sus razones: `desviacion`, `needs_review`,
--      `sin_referencia`, `contradiccion`, `a_ojo`. Umbrales de `supply_settings`
--      (25 % / 5 € / 40 %), no del código.
--   2. `apply_inventory_count` la usa para rechazar — y para decidir qué entra
--      en el modo parcial del autocierre nocturno.
--   3. La pantalla la lee para repartir en «Para revisar» y «Cuadran». El umbral
--      ya no está escrito en el front: si estuviera en los dos sitios volvería a
--      separarse.
--   4. El mensaje, en palabras de la calle y con nombres:
--        «Faltan motivos en 2 productos: Carne de Birria, Coca-Cola Original Lata.»
--
-- LO QUE NO CAMBIA. La tolerancia 2/3/5 % por clase ABC sigue exactamente igual
-- y sigue midiendo la precisión del recuento (KPI y fiabilidad de autoconteos).
-- Lo único que pierde es el poder de decidir si hace falta motivo para aprobar.
-- Dos preguntas distintas, dos columnas.
--
-- POR QUÉ UN `_core` DEL CONTEXTO. `count_review_context` lleva dentro su propio
-- `belongs_to_account`. La regla la invoca también `apply_inventory_count`, y a
-- ésa la llama `autoclose_daily_count` desde pg_cron: no quiero que la razón
-- `contradiccion` dependa de qué identidad tenga el cron. El `_core` no lleva
-- guarda y la pública la conserva; una sola definición de la consulta.
--
-- ENSAYO (regla 10: por sus CAMINOS), todo dentro de transacciones revertidas:
--   Regla nueva sobre INV-00218 ... 7 líneas piden motivo, 0 sin motivo:
--     Caldo de Birria [desviacion+contradiccion] · Carne de Birria
--     [desviacion+contradiccion] · Coca-Cola Original Lata
--     [desviacion+needs_review+contradiccion] · Humus [contradiccion] ·
--     Milanesa de Pollo Rebozado [desviacion] · Relish Pepinillo y Cebolla
--     [sin_referencia] · Solomillo de Pollo Prefrito Piri-piri [desviacion]
--   A · aprobar tal cual ......... OK: 25 ajustes sobre 28 artículos
--   B · quitando dos motivos ..... frena: «Faltan motivos en 2 productos:
--                                  Carne de Birria, Coca-Cola Original Lata.»
--   B2 · quitando uno ............ frena: «Faltan motivos en 1 producto:
--                                  Coca-Cola Original Lata.»
--   C · parcial (autocierre) ..... OK: 24 ajustes
--   1 · cerrar una venta ......... OK
--   2 · recibir un albarán ....... OK
--   3 · apuntar una merma ........ OK (delta = −1)
--   4 · aprobar un recuento ...... OK
-- NO se ha aprobado INV-00218: eso lo hace Julio.
--
-- md5 de `prosrc` tras aplicar:
--   _count_review_context_core ..... 41af190fc00455262fa652bbdc8652d0 (1.877)
--   count_review_context ........... 38d3d83dde6c09fea8b693a7de4f55f5 (214)
--   count_lines_requiring_reason ... a03969f20bf111114ce82e5acc25b9bd (2.734)
--   apply_inventory_count .......... 01edc4697bff9043cf8bec4eb9353df3 (6.269)
--
-- `apply_inventory_count` va como TRANSFORMACIÓN, no como cuerpo literal: se
-- define en un fichero del formato viejo, igual que la p16 y la p17.

BEGIN;

CREATE OR REPLACE FUNCTION public._count_review_context_core(p_count_id uuid)
RETURNS TABLE(line_id uuid, prev_qty numeric, prev_counted_at timestamptz,
              prev_by_name text, moved_since numeric, received_since numeric, sold_since numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  WITH cab AS (
    SELECT ic.id, ic.account_id, ic.location_id
      FROM public.inventory_count ic
     WHERE ic.id = p_count_id
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
  SELECT a.line_id, a.counted_qty, a.counted_at, a.counted_by_name,
         COALESCE(m.movido, 0), COALESCE(m.entrado, 0), COALESCE(m.vendido, 0)
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
$fn$;

CREATE OR REPLACE FUNCTION public.count_review_context(p_count_id uuid)
RETURNS TABLE(line_id uuid, prev_qty numeric, prev_counted_at timestamptz,
              prev_by_name text, moved_since numeric, received_since numeric, sold_since numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT c.* FROM public._count_review_context_core(p_count_id) c
   WHERE EXISTS (SELECT 1 FROM public.inventory_count ic
                  WHERE ic.id = p_count_id AND public.belongs_to_account(ic.account_id));
$fn$;

CREATE OR REPLACE FUNCTION public.count_lines_requiring_reason(p_count_id uuid)
RETURNS TABLE(line_id uuid, item_name text, reasons text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $fn$
  WITH cab AS (
    SELECT ic.id, ic.account_id FROM public.inventory_count ic WHERE ic.id = p_count_id
  ),
  umbral AS (
    SELECT COALESCE(ss.count_review_pct, 25)::numeric        AS u_pct,
           COALESCE(ss.count_review_eur, 5)::numeric         AS u_eur,
           COALESCE(ss.count_contradiction_pct, 40)::numeric AS u_contra
      FROM cab LEFT JOIN public.supply_settings ss ON ss.account_id = cab.account_id
  ),
  ctx AS (SELECT * FROM public._count_review_context_core(p_count_id)),
  ojo AS (
    SELECT e.line_id
      FROM public.inventory_count_entry e
      JOIN public.inventory_count_line l ON l.id = e.line_id
      JOIN (SELECT e2.line_id AS lid, max(e2.attempt) AS ult
              FROM public.inventory_count_entry e2
              JOIN public.inventory_count_line l2 ON l2.id = e2.line_id
             WHERE l2.inventory_count_id = p_count_id
             GROUP BY e2.line_id) m
        ON m.lid = e.line_id AND m.ult = e.attempt
     WHERE l.inventory_count_id = p_count_id AND e.method = 'fraccion'
     GROUP BY e.line_id
  ),
  base AS (
    SELECT l.id, ri.name,
           abs(COALESCE(l.variance_pct, 0)) AS pct,
           CASE WHEN l.variance_value IS NULL THEN NULL ELSE abs(l.variance_value) END AS eur,
           COALESCE(l.needs_review, false) AS needs_review,
           COALESCE(l.no_reference, false) AS no_reference,
           l.counted_qty,
           c.prev_qty, c.prev_counted_at,
           COALESCE(c.moved_since, 0) AS moved_since,
           COALESCE(c.received_since, 0) AS received_since,
           (o.line_id IS NOT NULL) AS a_ojo
      FROM public.inventory_count_line l
      JOIN public.recipe_item ri ON ri.id = l.recipe_item_id
      LEFT JOIN ctx c ON c.line_id = l.id
      LEFT JOIN ojo o ON o.line_id = l.id
     WHERE l.inventory_count_id = p_count_id AND l.counted_qty IS NOT NULL
  ),
  marcadas AS (
    SELECT b.id, b.name,
      array_remove(ARRAY[
        CASE WHEN b.pct >= u.u_pct AND b.eur IS NOT NULL AND b.eur >= u.u_eur
             THEN 'desviacion' END,
        CASE WHEN b.needs_review THEN 'needs_review' END,
        CASE WHEN b.no_reference AND b.counted_qty <> 0 THEN 'sin_referencia' END,
        CASE WHEN b.prev_qty IS NOT NULL AND b.prev_counted_at IS NOT NULL
              AND b.received_since = 0
              AND (b.prev_qty + b.moved_since) > 0
              AND abs(b.counted_qty - (b.prev_qty + b.moved_since))
                  / (b.prev_qty + b.moved_since) * 100 >= u.u_contra
             THEN 'contradiccion' END,
        CASE WHEN b.a_ojo AND b.pct >= u.u_pct THEN 'a_ojo' END
      ], NULL) AS reasons
    FROM base b CROSS JOIN umbral u
  )
  SELECT m.id, m.name, m.reasons FROM marcadas m WHERE cardinality(m.reasons) > 0;
$fn$;

COMMENT ON FUNCTION public.count_lines_requiring_reason(uuid) IS
  'UNA sola regla para «que hay que mirar antes de aprobar». La usa '
  'apply_inventory_count para rechazar y la pantalla para pintar. '
  '11/09/2026: antes la pantalla decia 25 % y 5 euros y la base pedia motivo '
  'por la tolerancia ABC de 2/3/5 %, y ofrecia un boton que la base rechazaba.';

DO $patch$
DECLARE v_def text; v_a text; v_b text; v_n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='apply_inventory_count';

  v_a := $q$  v_missing integer;$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  IF v_n <> 1 THEN RAISE EXCEPTION 'declaracion: % coincidencias', v_n; END IF;
  v_def := replace(v_def, v_a, $q$  v_missing integer;
  v_faltan text;
  v_need uuid[];$q$);

  v_a := $q$  SELECT COUNT(*) INTO v_missing
    FROM public.inventory_count_line
    WHERE inventory_count_id = p_count_id
      AND counted_qty IS NOT NULL
      AND (within_tolerance = false OR needs_review = true)
      AND (reason_code IS NULL OR reason_code = '');

  IF NOT v_is_opening AND NOT p_partial AND v_missing > 0 THEN
    RAISE EXCEPTION 'apply_inventory_count: % línea(s) a revisar sin motivo. Asigna un motivo antes de aprobar.', v_missing;
  END IF;$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / greatest(length(v_a),1);
  IF v_n <> 1 THEN RAISE EXCEPTION 'bloque A: % coincidencias', v_n; END IF;

  v_b := $q$  -- CAMBIO 11/09: UNA sola regla, y vive en count_lines_requiring_reason.
  -- La tolerancia ABC (2/3/5 %) sigue midiendo precision, pero ya no decide
  -- si hace falta motivo para aprobar. Son dos preguntas distintas.
  SELECT COALESCE(array_agg(q.line_id), '{}'::uuid[]) INTO v_need
    FROM public.count_lines_requiring_reason(p_count_id) q;

  SELECT COUNT(*), string_agg(q.item_name, ', ' ORDER BY q.item_name)
    INTO v_missing, v_faltan
    FROM public.count_lines_requiring_reason(p_count_id) q
    JOIN public.inventory_count_line l ON l.id = q.line_id
   WHERE l.reason_code IS NULL OR l.reason_code = '';

  IF NOT v_is_opening AND NOT p_partial AND v_missing > 0 THEN
    RAISE EXCEPTION 'Faltan motivos en % producto%: %.',
      v_missing, CASE WHEN v_missing = 1 THEN '' ELSE 's' END, v_faltan;
  END IF;$q$;
  v_def := replace(v_def, v_a, v_b);

  v_a := $q$         OR (l.needs_review = false AND l.within_tolerance = true)$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  IF v_n <> 1 THEN RAISE EXCEPTION 'bloque B: % coincidencias', v_n; END IF;
  v_def := replace(v_def, v_a, $q$         OR NOT (l.id = ANY(v_need))$q$);

  EXECUTE v_def;
END;
$patch$;

COMMIT;
