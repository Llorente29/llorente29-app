-- ============================================================================
-- RENDIMIENTO DE BATCH EN SUB-RECETAS (batch_yield)
--
-- PROBLEMA: una sub-receta se escribe como un BATCH ("este arroz criollo lleva
-- 2 kg de arroz largo, 120 g de aceite…"), pero el motor la trataba como si esa
-- receta describiera UNA unidad base. Al usarla en un plato, multiplicaba las
-- líneas del batch entero por la cantidad pedida en vez de repartirlas.
--
-- MEDIDO EN PRODUCCIÓN (23/08/2026), Birria Beef Bowl (AMB) con 0,15 kg de
-- Arroz Criollo (batch: 2.000 g arroz + 120 aceite + 60 caldo + 40 sal + 2
-- colorante = 2.222 g):
--     explode_recipe_to_raws(bowl, 1) -> Arroz Largo 300 g
--     lo correcto ................... -> Arroz Largo 135 g   (150 / 2222 * 2000)
-- Factor de error 2,222x = el rendimiento del batch expresado en kg. Lo mismo
-- en el coste, porque computed_cost del Arroz Criollo era el coste del batch
-- entero (2,37 €) usado como si fuera el precio de 1 kg.
--
-- SOLUCIÓN (patrón estándar de la industria — Apicbase "net measurement", meez
-- "Total Yield"): la sub-receta declara CUÁNTO PRODUCE, y el motor reparte:
--     proporción = cantidad_pedida / rendimiento_del_batch
--
-- ── LO QUE ESTE FICHERO HACE DISTINTO DEL ENCARGO, Y POR QUÉ ────────────────
-- El encargo proponía dividir directamente por `batch_yield`. Eso está 1.000x
-- mal en cuanto la unidad del rendimiento no coincide con la unidad base del
-- ítem, que es justo el caso real: Arroz Criollo tiene unidad base **kg** y su
-- rendimiento se teclea en **g**.
--     multiplicador que llega a explode = 0,15   (kg, la unidad base del ítem)
--     batch_yield tecleado .............. = 2222  (g)
--     0,15 / 2222 * 2000 = 0,135 g   <-- 1.000 veces menos de lo correcto
-- Por eso el rendimiento SIEMPRE se normaliza a la unidad base del ítem con
-- _qty_in_base() antes de dividir:
--     2222 g -> 2,222 kg ;  0,15 / 2,222 * 2000 = 135 g   <-- correcto
-- Mismo motivo en el auto-yield: se suma en la unidad base DEL PADRE, no en la
-- de cada hijo (sumar los `qty_in_base` de los hijos daría 2222 "en gramos"
-- contra un multiplicador en kg: el mismo error de 1.000x).
--
-- CUÁNDO SE APLICA (a propósito, para no tocar lo que hoy funciona):
--   - type='recipe' (preparaciones): siempre.
--   - cualquier tipo con batch_yield declarado a mano.
--   - los `dish` con batch_yield NULL NO se dividen -> los 530 platos de
--     producción salen EXACTAMENTE igual que antes de esta migración.
--   - las hojas (raw, tool, recipe stockable) ni se recorren: no aplica.
--
-- SUPERFICIE REAL (verificada en la BD viva antes de escribir esto): hay
-- UNA sola sub-receta no stockable en toda la base (Arroz Criollo) y UN solo
-- plato que la usa (Birria Beef Bowl). Todo lo demás queda intacto.
--
-- Firmas sin cambios (explode_recipe_to_raws(uuid,numeric) y
-- kitchen_recompute_item(uuid), sin overloads — comprobado en pg_proc), así que
-- CREATE OR REPLACE basta y evita romper dependencias por un DROP innecesario.
--
-- REVERSO: supabase/migrations/REVERT_20260823T2000_batch_yield.sql
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Columnas: cuánto produce el batch, y en qué unidad.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.recipe_item
  ADD COLUMN IF NOT EXISTS batch_yield         numeric,
  ADD COLUMN IF NOT EXISTS batch_yield_unit_id uuid REFERENCES public.kitchen_unit(id);

-- Un rendimiento de 0 o negativo no es un dato: es una división por cero
-- esperando su turno. Se prohíbe en la tabla, no solo en la UI.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recipe_item_batch_yield_positive'
      AND conrelid = 'public.recipe_item'::regclass
  ) THEN
    ALTER TABLE public.recipe_item
      ADD CONSTRAINT recipe_item_batch_yield_positive
      CHECK (batch_yield IS NULL OR batch_yield > 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.recipe_item.batch_yield IS
  'Rendimiento del batch: cuánto produce esta receta, expresado en '
  'batch_yield_unit_id (si es NULL, en la unidad base del propio ítem). '
  'NULL = auto-yield: el motor suma lo que pesan/miden sus líneas. '
  'Se aplica a type=recipe siempre, y a cualquier tipo que lo declare.';
COMMENT ON COLUMN public.recipe_item.batch_yield_unit_id IS
  'Unidad en la que está expresado batch_yield. El motor lo normaliza a la '
  'unidad base del ítem con _qty_in_base antes de dividir.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) _batch_yield_in_base: el rendimiento del ítem EN SU UNIDAD BASE.
--
--    Una sola fuente de verdad para el motor de stock, el de coste y la UI:
--    los tres tienen que dividir por el MISMO número o el coste y el consumo
--    dejan de contar la misma historia.
--
--    Devuelve NULL cuando no hay rendimiento aplicable (el llamador usa 1, que
--    es el comportamiento de siempre: sin división).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._batch_yield_in_base(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item  recipe_item%ROWTYPE;
  v_base  kitchen_unit%ROWTYPE;
  v_yield numeric;
BEGIN
  IF p_item_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- (a) DECLARADO: se normaliza a la unidad base del ítem. Si el usuario no
  --     dijo unidad, se entiende que ya está en la base.
  IF v_item.batch_yield IS NOT NULL AND v_item.batch_yield > 0 THEN
    v_yield := public._qty_in_base(
                 p_item_id,
                 v_item.batch_yield,
                 COALESCE(v_item.batch_yield_unit_id, v_item.base_unit_id));
    -- Declarado pero no convertible (p. ej. rendimiento en litros para una
    -- receta que se mide en unidades): NO se inventa un número. Sin rendimiento.
    IF v_yield IS NOT NULL AND v_yield > 0 THEN
      RETURN v_yield;
    END IF;
    RETURN NULL;
  END IF;

  -- (b) AUTO-YIELD: lo que pesan/miden sus líneas, sumado EN LA UNIDAD BASE
  --     DEL PADRE. Solo entran las líneas de la misma dimensión que esa base
  --     (sumar gramos con unidades sueltas no significa nada). Si no entra
  --     ninguna -> NULL -> sin división, que es lo correcto para una receta
  --     medida en 'ud' cuyas líneas van en gramos: describe 1 unidad.
  SELECT * INTO v_base FROM kitchen_unit WHERE id = v_item.base_unit_id;
  IF v_base.id IS NULL THEN RETURN NULL; END IF;

  SELECT SUM(COALESCE(rl.quantity_gross, rl.quantity_net)
             * lu.factor_to_base / v_base.factor_to_base)
    INTO v_yield
  FROM recipe_line rl
  JOIN kitchen_unit lu ON lu.id = rl.unit_id
  WHERE rl.parent_item_id = p_item_id
    AND lu.dimension = v_base.dimension;

  IF v_yield IS NOT NULL AND v_yield > 0 THEN
    RETURN v_yield;
  END IF;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public._batch_yield_in_base(uuid) IS
  'Rendimiento del batch expresado en la unidad base del ítem. Declarado '
  '(batch_yield + su unidad, normalizado con _qty_in_base) o automático (suma '
  'de las líneas medibles en esa base). NULL = sin rendimiento aplicable.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) explode_recipe_to_raws: repartir el batch en vez de multiplicarlo entero.
--    Único cambio de comportamiento: el multiplicador con el que se baja a los
--    hijos se divide por el rendimiento del nodo. Todo lo demás (parada en las
--    hojas, líneas no convertibles, orden) queda igual.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.explode_recipe_to_raws(p_item_id uuid, p_multiplier numeric)
 RETURNS TABLE(raw_item_id uuid, qty_base numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item  recipe_item%ROWTYPE;
  v_line  recipe_line%ROWTYPE;
  v_qb    numeric;
  v_yield numeric := NULL;
BEGIN
  IF p_item_id IS NULL OR p_multiplier IS NULL THEN RETURN; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Condicion de parada: hoja del arbol de consumo.
  IF v_item.type IN ('raw', 'tool')
     OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
    raw_item_id := p_item_id;
    qty_base    := p_multiplier;
    RETURN NEXT;
    RETURN;
  END IF;

  -- NUEVO: rendimiento del batch. Solo para preparaciones o para quien lo
  -- declare a mano: un `dish` sin batch_yield sale exactamente como antes.
  IF v_item.type = 'recipe' OR v_item.batch_yield IS NOT NULL THEN
    v_yield := public._batch_yield_in_base(p_item_id);
  END IF;
  IF v_yield IS NULL OR v_yield <= 0 THEN
    v_yield := 1;   -- sin rendimiento aplicable = comportamiento de siempre
  END IF;

  -- Nodo compuesto (recipe no-stockable o dish): recurrir por cada linea.
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
    ORDER BY position ASC, created_at ASC
  LOOP
    v_qb := public._qty_in_base(
              v_line.child_item_id,
              COALESCE(v_line.quantity_gross, v_line.quantity_net),
              v_line.unit_id);
    IF v_qb IS NULL THEN
      CONTINUE;  -- no convertible -> 0, exactamente como el coste
    END IF;
    RETURN QUERY
      SELECT * FROM public.explode_recipe_to_raws(
                      v_line.child_item_id,
                      (p_multiplier / v_yield) * v_qb);
  END LOOP;
  RETURN;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) kitchen_recompute_item: el coste, por unidad de rendimiento.
--    Si el stock reparte el batch, el coste tiene que repartirlo igual, o el
--    plato descontaría 135 g de arroz cobrándose 2 kg. Mismo criterio de
--    aplicación que explode (misma función de rendimiento), a propósito.
--    packaging_cost se divide con el total para que siga cumpliéndose
--    total = comida + packaging.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kitchen_recompute_item(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item            recipe_item%ROWTYPE;
  v_line            recipe_line%ROWTYPE;
  v_child           recipe_item%ROWTYPE;
  v_line_unit       kitchen_unit%ROWTYPE;
  v_child_base_unit kitchen_unit%ROWTYPE;
  v_qty             numeric;
  v_qty_in_base     numeric;
  v_child_cost      numeric;
  v_conv            numeric;
  v_line_cost       numeric;
  v_total           numeric := 0;
  v_packaging       numeric := 0;
  v_incomplete      boolean := false;
  v_yield           numeric := NULL;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_item: item % no existe', p_item_id;
  END IF;
  -- GUARD DE TENANCY: admin de plataforma (CEO) O admin/manager de la cuenta.
  -- SECURITY DEFINER salta RLS, así que validamos acceso explícitamente.
  IF NOT public.belongs_to_account(v_item.account_id) THEN
    RAISE EXCEPTION 'kitchen_recompute_item: sin acceso al item %', p_item_id;
  END IF;
  -- Raw/tool/packaging: UNA sola verdad del coste -> función dedicada
  -- (fixed / last_purchase + fallback honesto + needs_review).
  IF v_item.type IN ('raw', 'tool', 'packaging') THEN
    RETURN public.kitchen_recompute_raw_cost(p_item_id);
  END IF;
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
  LOOP
    SELECT * INTO v_child           FROM recipe_item  WHERE id = v_line.child_item_id;
    SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = v_line.unit_id;
    SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;
    v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
    IF v_line_unit.dimension = v_child_base_unit.dimension THEN
      v_qty_in_base := v_qty * v_line_unit.factor_to_base / v_child_base_unit.factor_to_base;
    ELSE
      SELECT qty_in_base INTO v_conv
        FROM recipe_item_unit_conversion
        WHERE item_id = v_child.id AND from_unit_id = v_line.unit_id
        LIMIT 1;
      IF v_conv IS NOT NULL THEN
        v_qty_in_base := v_qty * v_conv;
      ELSE
        v_incomplete := true;
        v_qty_in_base := 0;
      END IF;
    END IF;
    v_line_cost := v_child_cost * v_qty_in_base;
    v_total := v_total + v_line_cost;
    -- Desglose: solo líneas DIRECTAS de packaging (no propaga de sub-recetas).
    IF v_child.type = 'packaging' THEN
      v_packaging := v_packaging + v_line_cost;
    END IF;
  END LOOP;

  -- NUEVO: coste POR UNIDAD DE RENDIMIENTO. Mismo criterio que explode.
  IF v_item.type = 'recipe' OR v_item.batch_yield IS NOT NULL THEN
    v_yield := public._batch_yield_in_base(p_item_id);
    IF v_yield IS NOT NULL AND v_yield > 0 THEN
      v_total     := v_total / v_yield;
      v_packaging := v_packaging / v_yield;
    END IF;
  END IF;

  UPDATE recipe_item
    SET computed_cost   = v_total,
        packaging_cost  = v_packaging,
        cost_updated_at = now(),
        needs_review    = CASE WHEN v_incomplete THEN true ELSE needs_review END,
        -- CAMBIO: estado de completitud del coste (merge, no pisa otras claves).
        -- computed_cost queda como PARCIAL (no se nula); la ficha lo presenta como
        -- "incompleto" en vez de un número limpio mentiroso.
        completeness    = COALESCE(completeness, '{}'::jsonb)
                          || jsonb_build_object(
                               'cost_incomplete', v_incomplete,
                               'cost_incomplete_reason',
                                 CASE WHEN v_incomplete THEN 'unmeasurable_line' ELSE NULL END)
    WHERE id = p_item_id;
  RETURN v_total;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) kitchen_batch_yield: el mismo rendimiento, para la pantalla.
--    La UI tiene que enseñar EL NÚMERO POR EL QUE DIVIDE EL MOTOR, no una copia
--    de la fórmula en TypeScript que se desincronice a la primera. Añade dos
--    cosas que la pantalla necesita y el motor no: si el rendimiento es
--    declarado o automático, y cuántas líneas se quedaron fuera del automático
--    por no ser medibles en la unidad base (para poder avisar en vez de mentir).
--    Guard de tenancy calcado de kitchen_recipe_breakdown.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kitchen_batch_yield(p_item_id uuid)
 RETURNS TABLE(yield_in_base numeric, base_unit_id uuid, is_declared boolean, unmeasured_lines integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item recipe_item%ROWTYPE;
  v_base kitchen_unit%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_batch_yield: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_batch_yield: sin acceso al item %', p_item_id;
  END IF;

  SELECT * INTO v_base FROM kitchen_unit WHERE id = v_item.base_unit_id;

  yield_in_base := public._batch_yield_in_base(p_item_id);
  base_unit_id  := v_item.base_unit_id;
  is_declared   := (v_item.batch_yield IS NOT NULL AND v_item.batch_yield > 0);

  SELECT COUNT(*) INTO unmeasured_lines
  FROM recipe_line rl
  JOIN kitchen_unit lu ON lu.id = rl.unit_id
  WHERE rl.parent_item_id = p_item_id
    AND (v_base.id IS NULL OR lu.dimension <> v_base.dimension);

  RETURN NEXT;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- kitchen_recipe_breakdown NO se toca, y es correcto que no se toque:
-- calcula cada línea como coste_del_hijo * cantidad_en_base_del_hijo. Cuando el
-- hijo es una preparación, su computed_cost ya viene dividido por el
-- rendimiento (paso 4), así que la línea del plato sale bien sola.
-- Dentro de la preparación, en cambio, sus líneas siguen mostrando el BATCH
-- entero — que es lo que se quiere ver al editarla: la receta es del batch.
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD: que quede aplicado lo que se cree que se ha aplicado.
-- ────────────────────────────────────────────────────────────────────────────
DO $guard$
DECLARE
  v_missing text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='recipe_item'
      AND column_name IN ('batch_yield','batch_yield_unit_id')
    HAVING count(*) = 2
  ) THEN
    v_missing := v_missing || 'columnas batch_yield/batch_yield_unit_id; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='_batch_yield_in_base'
  ) THEN
    v_missing := v_missing || '_batch_yield_in_base; ';
  END IF;

  -- El motor tiene que estar DIVIDIENDO de verdad, no solo tener la columna.
  IF regexp_replace(
       pg_get_functiondef('public.explode_recipe_to_raws(uuid,numeric)'::regprocedure),
       '--[^\n]*', '', 'g') NOT ILIKE '%_batch_yield_in_base%' THEN
    v_missing := v_missing || 'explode_recipe_to_raws sin rendimiento; ';
  END IF;
  IF regexp_replace(
       pg_get_functiondef('public.kitchen_recompute_item(uuid)'::regprocedure),
       '--[^\n]*', '', 'g') NOT ILIKE '%_batch_yield_in_base%' THEN
    v_missing := v_missing || 'kitchen_recompute_item sin rendimiento; ';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'MIGRACIÓN INCOMPLETA: %', v_missing;
  END IF;
  RAISE NOTICE 'OK — rendimiento de batch activo (columnas + _batch_yield_in_base + los dos motores).';
END
$guard$;

-- ============================================================================
-- VERIFICACIÓN (en transacción APARTE de esta migración):
--
--   -- 1) El rendimiento del Arroz Criollo, en su unidad base (kg). Espera 2.222
--   SELECT public._batch_yield_in_base('4868d63c-6933-440e-a9e2-0aeb3aec5d66');
--
--   -- 2) El plato que la usa. Espera Arroz Largo = 135 g (antes: 300 g)
--   SELECT ri.name, e.qty_base
--     FROM public.explode_recipe_to_raws('d9c6fc3b-d37c-4d48-845e-6646c9521669', 1) e
--     JOIN recipe_item ri ON ri.id = e.raw_item_id
--    ORDER BY e.qty_base DESC;
--
--   -- 3) Coste por kg de la preparación, y recosteo del plato que la usa.
--   SELECT public.kitchen_recompute_item('4868d63c-6933-440e-a9e2-0aeb3aec5d66');
--   SELECT public.kitchen_recompute_item('d9c6fc3b-d37c-4d48-845e-6646c9521669');
--
--   -- 4) Los platos SIN sub-recetas no se han movido ni un gramo (esperado: 0)
--   --    (contrastar contra el snapshot tomado ANTES de aplicar).
-- ============================================================================
