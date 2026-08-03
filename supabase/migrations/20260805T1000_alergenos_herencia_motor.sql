-- Alérgenos Capa 2 — motor de herencia plato←ingredientes.
--
-- CONTEXTO (legal, no cosmético): Julio ha pasado inspecciones sanitarias
-- reales que piden la tabla de alérgenos de TODOS los platos a la venta y el
-- ejercicio "coge un plato y demuestra sus alérgenos". Capa 1 construyó la
-- declaración manual (pestaña Etiquetado) pero no propaga nada — los ~580
-- platos siguen "sin declarar" pese a que 791 ingredientes ya tienen dato
-- (716 ai_enrich sin confirmar + 54 manual + 21 inherited).
--
-- REGLAS DE PROPAGACIÓN (aprobadas por Julio, 05/08 — decisiones de
-- seguridad alimentaria, no técnicas, NO se cambian sin su OK explícito).
-- Por cada uno de los 14 alérgenos, mirando TODOS los ingredientes reales
-- del escandallo (recursivo, sub-recetas incluidas, vía explode_recipe_to_raws):
--   · algún ingrediente 'contains'                    -> el plato 'contains' (gana siempre)
--   · si no, algún ingrediente 'may_contain'           -> el plato 'may_contain'
--   · si no, algún ingrediente 'unknown' O SIN FILA    -> el plato 'unknown'
--   · solo si TODOS declaran 'free' explícito          -> el plato 'free'
-- Caso borde (decisión propia, consistente con "nunca 'free' sin dato"):
-- escandallo con CERO ingredientes válidos tras filtrar tool/packaging ->
-- 'unknown' en los 14, nunca 'free' por vacuidad lógica.
--
-- EXCLUSIÓN EXPLÍCITA de 'tool' y 'packaging' del cómputo (decisión de
-- Julio): explode_recipe_to_raws incluye 'tool' mezclado con 'raw' en su
-- salida (verificado en el cuerpo de la función,
-- 20260609T1000_consumo_teorico_motor_puro.sql:109-114) — sin filtrar,
-- cualquier escandallo con una línea 'tool' heredaría 'unknown' en TODO (la
-- herramienta nunca tiene fila de alérgeno). 'packaging' queda fuera hoy por
-- cómo está modelado (sin recipe_line propias, la función no lo devuelve),
-- no por una exclusión explícita — se filtra igualmente aquí para no
-- depender de esa casualidad.
--
-- PRECEDENCIA MANUAL (decisión de Julio): la herencia escribe
-- source='inherited'. Una declaración source='manual' en el plato NUNCA se
-- pisa — fill-only POR CÓDIGO de alérgeno (un plato puede tener 2 alérgenos
-- manuales y 12 heredados a la vez). Implementado con
-- ON CONFLICT ... WHERE source <> 'manual'.
--
-- CÁLCULO POR PASADA COMPLETA, NO CASCADA CACHEADA (confirmado por Julio
-- tras RECON): cascadeFromItem (patrón de coste, 100% cliente) lee el
-- computed_cost YA CACHEADO del hijo directo — kitchen_ancestors_of devuelve
-- los ancestros del más lejano al más cercano (DESC) mientras el recompute
-- asume lo contrario; con anidamiento real (crudo→sub-receta→plato) un plato
-- se recalcularía con el coste VIEJO de su sub-receta. Nunca se ha disparado
-- (0 anidamiento en producción hoy) pero alérgenos SÍ le importa el
-- anidamiento real, así que aquí NO se reutiliza ese motor de cálculo — cada
-- plato afectado se recalcula con una EXPLOSIÓN COMPLETA vía
-- explode_recipe_to_raws en cada pasada, correcto por construcción, sin
-- depender del orden ni de un valor cacheado de un hermano. Sí se reutilizan
-- los PUNTOS DE DISPARO de cascadeFromItem (kitchen_ancestors_of) desde el
-- cliente (ver src/modules/kitchen/services/allergenCascadeService.ts).
--
-- PATRÓN "FRONTERA ÚNICA" (ya establecido en este proyecto, ver comentario
-- de explode_recipe_to_raws): el motor de cálculo/escritura no lleva guard
-- de usuario (funciones con prefijo _); la única entrada con guard es la RPC
-- pública que llama el cliente. El backfill de abajo llama directamente al
-- motor interno (se ejecuta a mano en el SQL Editor, contexto de confianza,
-- sin auth.uid() resuelto — llamar a la RPC guardada fallaría siempre ahí).
--
-- Aplicar por SQL Editor a mano (sin begin/commit). Verificar cada función
-- con una query aparte (no fiarse del "Success"). El backfill recorre ~580
-- platos/recetas — si el SQL Editor da timeout, avisar para partir en tandas
-- (por ejemplo, por rango de created_at o de account_id).

-- ─────────────────────────────────────────────────────────────────────
-- 1) compute_recipe_item_allergens — función PURA (sin escritura).
-- Devuelve el estado que le correspondería heredar a un recipe_item para
-- cada uno de los 14 alérgenos, según la tabla de precedencia de arriba.
-- No aplica si el tipo no es 'dish'/'recipe' (un raw/tool/packaging no tiene
-- composición que heredar — su propia declaración ES la fuente).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_recipe_item_allergens(
  p_recipe_item_id uuid
) RETURNS TABLE (allergen_code text, computed_state text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_type text;
BEGIN
  SELECT type INTO v_type FROM recipe_item WHERE id = p_recipe_item_id;
  IF NOT FOUND OR v_type NOT IN ('dish', 'recipe') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH raw_ids AS (
    -- Ingredientes reales del árbol completo, excluyendo tool/packaging
    -- explícitamente (no depender de que explode_recipe_to_raws los deje
    -- fuera por casualidad).
    SELECT DISTINCT e.raw_item_id AS id
    FROM public.explode_recipe_to_raws(p_recipe_item_id, 1) e
    JOIN recipe_item ri ON ri.id = e.raw_item_id
    WHERE ri.type NOT IN ('tool', 'packaging')
  ),
  matrix AS (
    -- Cruce alérgeno × ingrediente real: NULL en state = ese ingrediente no
    -- tiene ninguna fila para ese alérgeno ("nadie lo ha mirado").
    SELECT
      a.code AS allergen_code,
      r.id   AS raw_id,
      ria.state AS state
    FROM allergen a
    CROSS JOIN raw_ids r
    LEFT JOIN recipe_item_allergen ria
      ON ria.recipe_item_id = r.id AND ria.allergen_code = a.code
  ),
  agg AS (
    SELECT
      m.allergen_code,
      bool_or(m.state = 'contains')                              AS any_contains,
      bool_or(m.state = 'may_contain')                           AS any_may_contain,
      bool_or(m.state = 'unknown')                                AS any_unknown,
      bool_or(m.state IS NULL)                                    AS any_missing,
      -- count(*) FILTER, no bool_and: bool_and ignora los NULL, lo que
      -- daría "todos libres" por vacuidad si hay ingredientes sin fila.
      -- Aquí, si falta una fila, el conteo filtrado no cuadra con el total.
      count(*) FILTER (WHERE m.state = 'free') = count(*)         AS all_free
    FROM matrix m
    GROUP BY m.allergen_code
  )
  SELECT
    a.code AS allergen_code,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM raw_ids) THEN 'unknown'
      WHEN g.any_contains THEN 'contains'
      WHEN g.any_may_contain THEN 'may_contain'
      WHEN g.any_unknown OR g.any_missing THEN 'unknown'
      WHEN g.all_free THEN 'free'
      ELSE 'unknown' -- red de seguridad, nunca debería alcanzarse
    END AS computed_state
  FROM allergen a
  LEFT JOIN agg g ON g.allergen_code = a.code
  ORDER BY a.position;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) _recompute_recipe_item_allergens — motor de escritura, SIN guard
-- (patrón "frontera única" ya establecido en este proyecto). Fill-only por
-- código: nunca pisa una fila source='manual'.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._recompute_recipe_item_allergens(
  p_recipe_item_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_type text;
  v_row  RECORD;
BEGIN
  SELECT type INTO v_type FROM recipe_item WHERE id = p_recipe_item_id;
  IF NOT FOUND OR v_type NOT IN ('dish', 'recipe') THEN
    RETURN; -- no aplica: un raw/tool/packaging no hereda, declara.
  END IF;

  FOR v_row IN SELECT * FROM public.compute_recipe_item_allergens(p_recipe_item_id) LOOP
    INSERT INTO recipe_item_allergen (recipe_item_id, allergen_code, state, source)
    VALUES (p_recipe_item_id, v_row.allergen_code, v_row.computed_state, 'inherited')
    ON CONFLICT (recipe_item_id, allergen_code) DO UPDATE
      SET state = EXCLUDED.state, source = 'inherited'
      WHERE recipe_item_allergen.source <> 'manual';
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) recompute_recipe_item_allergens — RPC PÚBLICA (frontera de la app),
-- con guard. Es lo que llama el cliente tras cambiar la composición de un
-- escandallo (ver allergenCascadeService.ts). Mismo guard que las RPC de
-- escritura de menu_item_link_rpcs (admin_or_manager_of, no admin puro: la
-- edición normal de recetas ya la hacen managers).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_recipe_item_allergens(
  p_recipe_item_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account uuid;
BEGIN
  SELECT account_id INTO v_account FROM recipe_item WHERE id = p_recipe_item_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'recompute_recipe_item_allergens: escandallo % no existe', p_recipe_item_id;
  END IF;
  IF NOT public.current_user_is_admin_or_manager_of(v_account) THEN
    RAISE EXCEPTION 'recompute_recipe_item_allergens: sin acceso a la cuenta %', v_account;
  END IF;

  PERFORM public._recompute_recipe_item_allergens(p_recipe_item_id);
END;
$$;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────
-- 4) Backfill — puebla los ~580 platos/recetas existentes. Llama al motor
-- interno directamente (sin guard: SQL Editor = contexto de confianza,
-- auth.uid() no resuelve aquí, la RPC guardada fallaría siempre).
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id    uuid;
  v_count int := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM recipe_item
    WHERE type IN ('dish', 'recipe') AND archived_at IS NULL
  LOOP
    PERFORM public._recompute_recipe_item_allergens(v_id);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfill de herencia de alérgenos: % platos/recetas recalculados', v_count;
END $$;

-- Guard: aborta si algo no quedó como debía.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'compute_recipe_item_allergens') THEN
    RAISE EXCEPTION 'MIGRACIÓN FALLIDA: falta compute_recipe_item_allergens';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_recompute_recipe_item_allergens') THEN
    RAISE EXCEPTION 'MIGRACIÓN FALLIDA: falta _recompute_recipe_item_allergens';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'recompute_recipe_item_allergens') THEN
    RAISE EXCEPTION 'MIGRACIÓN FALLIDA: falta recompute_recipe_item_allergens';
  END IF;
END $$;
