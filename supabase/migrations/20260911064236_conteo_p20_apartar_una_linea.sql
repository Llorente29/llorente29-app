-- 20260911064236_conteo_p20_apartar_una_linea.sql
--
-- LA ÚLTIMA PALABRA ES LA DE LA PERSONA
--
-- LO QUE PASÓ (§3 del encargo del 11/09). Julio corrigió a mano a las 07:53 el
-- stock de cinco productos de Alcalá que estaban en INV-00218, sin aprobar. Al
-- aprobar el recuento se aplicaron TAMBIÉN sus ajustes, con la hora de cuando
-- se contó, y las dos correcciones se sumaron:
--
--   Lima .................. 1.000 -> 1.360,7 g
--   Albahaca .................. 250 -> 261,8 g
--   Mantequilla con ajo ....... 500 -> 510 g
--   Colorador amarillo ........ 500 -> 500,8 g
--   SALSA Yogur ............. 2.000 -> 2.000 g
--
-- Y no es que «gane el último»: el movimiento del recuento lleva `occurred_at`
-- del momento en que se contó, así que al recalcular el saldo el orden ni
-- siquiera favorece a quien corrigió después.
--
-- QUÉ CAMBIA
--   1. `inventory_count_line.excluded_at` + quién y por qué. Una línea apartada
--      NO se aplica al aprobar (`apply_inventory_count`) y NO pide motivo
--      (`count_lines_requiring_reason`): su motivo es el de haberla apartado.
--   2. `set_count_line_excluded(linea, motivo)` — la acción «No aplicar esta
--      línea» de la revisión. Exige motivo, y no deja tocar un recuento ya
--      aprobado o anulado.
--   3. `trg_ajuste_aparta_la_linea_pendiente` sobre `stock_adjustment`: si
--      alguien corrige a mano el stock de un artículo con recuento pendiente,
--      esa línea se aparta sola, con el nombre de quien corrigió. Va en un
--      TRIGGER y no dentro de `register_adjustment` a propósito: así vale para
--      cualquier camino que escriba un ajuste, hoy y mañana.
--   4. `pending_count_line_for_item(...)` para que la pantalla de corregir
--      stock AVISE ANTES de escribir. Regla 8: el botón dice lo que va a pasar
--      antes de pulsarlo, no después.
--
-- ENSAYO POR SUS CAMINOS (regla 32), sobre INV-00221 de Alcalá y revertido:
--   0 · el aviso previo encuentra la línea ......... sí
--   A · apartada a mano ........................... sí · «La cifra no es de
--       fiar, se recuenta mañana»
--   B · corrección a mano (delta = −160) .......... la línea queda apartada ·
--       «Se corrigió a mano el stock de este producto»
--   C · aprobar ................................... 0 ajustes sobre 0 artículos
--   D · Alubias rojas (apartada, contada 123) ..... antes 22.870, después 22.870
--   E · Bacon Ahumado (corregido a mano a 2.000) .. después 2.000
--   1 · cerrar una venta .......................... OK
--   2 · recibir un albarán ........................ OK
--   3 · apuntar una merma ......................... es el propio camino B
--   4 · aprobar un recuento ....................... es el propio camino C
--
-- Y UN ERROR MÍO DE CAMINO, QUE VA DICHO: el primer ensayo daba «la línea queda
-- DENTRO (mal)». No fallaba el trigger: yo había fijado el local a Carabanchel
-- y INV-00221 es de Alcalá, así que el ajuste y el recuento estaban en locales
-- distintos. Es la regla 9 un piso más abajo — anclé por un `location_id` que
-- no había verificado. El ensayo de arriba lee el local DEL PROPIO CONTEO.
--
-- md5 de `prosrc` tras aplicar:
--   set_count_line_excluded ............. e2768e792d775b06ca4462c5ffd5a913 (1.430)
--   pending_count_line_for_item ......... 0952d62ece668aaacbe7c94d97e525c3 (457)
--   tg_ajuste_aparta_la_linea_pendiente . 6fe709fb518e7b7022c3cc46bbdd4bc1 (1.265)
--   count_lines_requiring_reason ........ 98cbcd9bd1edd74729799926f0cc77c8 (2.899)
--   apply_inventory_count ............... 3c7dd188e9bbc23b0fa75fbb9f1ef565 (6.481)
--
-- `apply_inventory_count` va como TRANSFORMACIÓN, no como cuerpo literal: se
-- define en un fichero del formato viejo, igual que la p16, la p17 y la p18.

BEGIN;

ALTER TABLE public.inventory_count_line
  ADD COLUMN IF NOT EXISTS excluded_at      timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_by      uuid,
  ADD COLUMN IF NOT EXISTS excluded_by_name text,
  ADD COLUMN IF NOT EXISTS excluded_reason  text;

COMMENT ON COLUMN public.inventory_count_line.excluded_at IS
  'Linea apartada: NO se aplica al aprobar. La aparta una persona («No aplicar '
  'esta linea») o el trigger del ajuste a mano. 11/09/2026: antes solo se podia '
  'aprobar todo, y las dos correcciones se sumaban.';

CREATE OR REPLACE FUNCTION public.set_count_line_excluded(
  p_line_id uuid, p_reason text, p_excluded boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_account uuid; v_status text; v_actor uuid := auth.uid(); v_nom text;
BEGIN
  SELECT l.account_id, ic.status INTO v_account, v_status
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.id = p_line_id;
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'set_count_line_excluded: la línea % no existe', p_line_id;
  END IF;
  IF NOT public.belongs_to_account(v_account) THEN
    RAISE EXCEPTION 'set_count_line_excluded: sin acceso a la cuenta';
  END IF;
  IF v_status IN ('aprobado', 'anulado') THEN
    RAISE EXCEPTION 'set_count_line_excluded: el recuento está % y ya no se puede tocar', v_status;
  END IF;
  IF NOT p_excluded THEN
    UPDATE public.inventory_count_line
       SET excluded_at = NULL, excluded_by = NULL,
           excluded_by_name = NULL, excluded_reason = NULL
     WHERE id = p_line_id;
    RETURN;
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'set_count_line_excluded: apartar una línea necesita un motivo. Sin él, mañana nadie sabrá por qué no se aplicó.';
  END IF;
  SELECT up.display_name INTO v_nom FROM public.user_profiles up
   WHERE up.user_id = v_actor AND up.account_id = v_account LIMIT 1;
  UPDATE public.inventory_count_line
     SET excluded_at = now(), excluded_by = v_actor,
         excluded_by_name = v_nom, excluded_reason = trim(p_reason)
   WHERE id = p_line_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.pending_count_line_for_item(
  p_account_id uuid, p_location_id uuid, p_recipe_item_id uuid)
RETURNS TABLE(line_id uuid, count_id uuid, count_code text, count_status text,
              counted_qty numeric, counted_at timestamptz, counted_by_name text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $fn$
  SELECT l.id, ic.id, ic.code, ic.status,
         l.counted_qty, l.counted_at, l.counted_by_name
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.account_id     = p_account_id
     AND ic.location_id   = p_location_id
     AND l.recipe_item_id = p_recipe_item_id
     AND ic.status IN ('contando', 'en_revision')
     AND l.excluded_at IS NULL
   ORDER BY ic.created_at DESC
   LIMIT 1;
$fn$;

COMMENT ON FUNCTION public.pending_count_line_for_item(uuid, uuid, uuid) IS
  'La linea de recuento sin aprobar que tiene este articulo en este local, si '
  'la hay. La pantalla de corregir stock a mano la usa para avisar ANTES de '
  'escribir, no despues.';

CREATE OR REPLACE FUNCTION public.tg_ajuste_aparta_la_linea_pendiente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_line uuid;
BEGIN
  -- LA ULTIMA PALABRA ES LA DE LA PERSONA (11/09/2026). Si alguien corrige a
  -- mano el stock de un articulo que esta en un recuento sin aprobar, las dos
  -- cosas se sumarian al aprobar: el ajuste del recuento lleva la hora de
  -- cuando se conto, asi que ni siquiera «gana el ultimo». Paso el 11/09 con
  -- cinco productos de Alcala (Lima 1.000 -> 1.360,7 g, y cuatro mas).
  --
  -- No se toca el recuento entero: se aparta ESA linea, con su motivo y su
  -- nombre, y se ve apartada en la pantalla de revision.
  SELECT l.id INTO v_line
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.account_id     = NEW.account_id
     AND ic.location_id   = NEW.location_id
     AND l.recipe_item_id = NEW.recipe_item_id
     AND ic.status IN ('contando', 'en_revision')
     AND l.excluded_at IS NULL
   ORDER BY ic.created_at DESC
   LIMIT 1;
  IF v_line IS NULL THEN RETURN NEW; END IF;
  UPDATE public.inventory_count_line
     SET excluded_at      = now(),
         excluded_by      = NEW.created_by,
         excluded_by_name = NEW.created_by_name,
         excluded_reason  = 'Se corrigió a mano el stock de este producto'
   WHERE id = v_line;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ajuste_aparta_la_linea_pendiente ON public.stock_adjustment;
CREATE TRIGGER trg_ajuste_aparta_la_linea_pendiente
  AFTER INSERT ON public.stock_adjustment
  FOR EACH ROW EXECUTE FUNCTION public.tg_ajuste_aparta_la_linea_pendiente();

DO $patch$
DECLARE v_def text; v_a text; v_n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='apply_inventory_count';
  v_a := $q$     WHERE l.inventory_count_id = p_count_id
       AND l.counted_qty IS NOT NULL$q$;
  v_n := (length(v_def) - length(replace(v_def, v_a, ''))) / greatest(length(v_a),1);
  IF v_n <> 1 THEN RAISE EXCEPTION 'apartadas: % coincidencias', v_n; END IF;
  v_def := replace(v_def, v_a, $q$     WHERE l.inventory_count_id = p_count_id
       AND l.counted_qty IS NOT NULL
       -- CAMBIO 11/09: una linea apartada NO se aplica. La aparta una persona
       -- o el trigger del ajuste a mano. Es lo unico que decide por encima
       -- del recuento.
       AND l.excluded_at IS NULL$q$);
  EXECUTE v_def;
END;
$patch$;

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
       -- Una linea apartada no se aplica, asi que tampoco pide motivo: su
       -- motivo es el de haberla apartado (11/09/2026).
       AND l.excluded_at IS NULL
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

COMMIT;
