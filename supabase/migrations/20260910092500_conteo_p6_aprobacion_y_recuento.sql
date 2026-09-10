-- 20260910092500_conteo_p6_aprobacion_y_recuento.sql
--
-- CONTAR POR FORMATOS · PASO 6 (§2.4) — LO QUE NO SE APLICA SOLO, Y PEDIR
-- QUE ALGUIEN LO VUELVA A CONTAR
--
-- Hoy `autoclose_daily_count` cierra y aplica en modo parcial todo lo que
-- cuadra o lleva motivo, y deja al gestor lo demás. Eso está bien y se
-- mantiene: lo que se extiende es la lista de lo que NO se aplica solo.
--
--   · `needs_review` — se contó dos veces y sigue sin cuadrar. Es el caso más
--     caro de todos: dos personas o dos intentos han dicho cosas distintas y el
--     sistema no tiene con qué desempatar. Aplicar eso solo es escribir en el
--     libro de stock una cifra que nadie ha confirmado.
--
-- Y «Recontar» deja de ser una intención y pasa a ser una fila: crea una línea
-- nueva, con `recount_of` apuntando a la original, en el siguiente
-- autoinventario y ASIGNADA A OTRA PERSONA. Volver a preguntarle a quien ya
-- contestó no es un segundo recuento: es la misma respuesta otra vez.

BEGIN;

-- ── Columnas de la petición de recuento ───────────────────────────────────
ALTER TABLE public.inventory_count_line
  ADD COLUMN IF NOT EXISTS recount_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS recount_requested_by uuid,
  ADD COLUMN IF NOT EXISTS recount_assign_to    uuid;

COMMENT ON COLUMN public.inventory_count_line.recount_requested_at IS
  'Quien aprueba ha pedido que se vuelva a contar este artículo. La petición '
  'está PENDIENTE mientras no exista una línea hija con recount_of = esta.';
COMMENT ON COLUMN public.inventory_count_line.recount_assign_to IS
  'A quién se le asigna el recuento. Nunca a quien contó la original (§2.4).';

-- Índice de la cola de peticiones pendientes.
CREATE INDEX IF NOT EXISTS idx_icl_recount_pendiente
  ON public.inventory_count_line (account_id, recount_requested_at)
  WHERE recount_requested_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_icl_recount_of
  ON public.inventory_count_line (recount_of)
  WHERE recount_of IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- apply_inventory_count · lo que NO se aplica solo
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.apply_inventory_count(
  p_count_id uuid,
  p_user_id uuid DEFAULT NULL::uuid,
  p_user_name text DEFAULT NULL::text,
  p_partial boolean DEFAULT false
)
RETURNS TABLE(adjustments integer, items_recomputed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_status text;
  v_is_opening boolean;
  v_instant timestamptz;
  v_missing integer;
  v_adj integer := 0;
  v_rec integer := 0;
  v_mtype text;
  v_note text;
  v_delta numeric;
  r RECORD;
  v_kind text;
  v_assigned uuid;
  v_require_sep boolean;
  v_actor_emp uuid;
BEGIN
  -- H8: FOR UPDATE serializa aprobaciones concurrentes del MISMO conteo.
  SELECT account_id, location_id, status, is_opening, kind, assigned_employee_id,
         COALESCE(started_at, closed_at, created_at, now())
    INTO v_account_id, v_location_id, v_status, v_is_opening, v_kind, v_assigned, v_instant
    FROM public.inventory_count WHERE id = p_count_id
    FOR UPDATE;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'apply_inventory_count: conteo % no existe', p_count_id;
  END IF;

  -- H7: el llamante debe pertenecer a la cuenta del conteo.
  IF NOT belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'apply_inventory_count: sin acceso a la cuenta %', v_account_id;
  END IF;

  -- C3: APROBACIÓN de conteos MANUALES (full/audit).
  IF v_kind IN ('full','audit') THEN
    IF NOT (public.current_user_is_admin()
            OR public.current_user_is_admin_or_manager_of(v_account_id)) THEN
      RAISE EXCEPTION 'apply_inventory_count: solo un gestor puede aprobar un inventario';
    END IF;
    SELECT COALESCE(require_separate_approval, true) INTO v_require_sep
      FROM public.supply_settings WHERE account_id = v_account_id;
    v_require_sep := COALESCE(v_require_sep, true);
    IF v_require_sep AND v_assigned IS NOT NULL THEN
      SELECT up.employee_id INTO v_actor_emp
        FROM public.user_profiles up
        WHERE up.user_id = auth.uid() AND up.account_id = v_account_id
        LIMIT 1;
      IF v_actor_emp IS NOT NULL AND v_actor_emp = v_assigned THEN
        RAISE EXCEPTION 'apply_inventory_count: quien contó el inventario no puede aprobarlo (separación de funciones). Debe aprobarlo otro gestor.';
      END IF;
    END IF;
  END IF;

  IF v_status = 'aprobado' THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  IF v_status <> 'en_revision' THEN
    RAISE EXCEPTION 'apply_inventory_count: el conteo debe estar en revisión (está en %)', v_status;
  END IF;

  -- CAMBIO 10/09: lo pendiente ya no es sólo «fuera de tolerancia sin motivo».
  -- Una línea `needs_review` sin motivo también lo está: se contó dos veces y
  -- sigue sin cuadrar, así que hasta que una persona diga por qué, no entra.
  SELECT COUNT(*) INTO v_missing
    FROM public.inventory_count_line
    WHERE inventory_count_id = p_count_id
      AND counted_qty IS NOT NULL
      AND (within_tolerance = false OR needs_review = true)
      AND (reason_code IS NULL OR reason_code = '');

  IF NOT v_is_opening AND NOT p_partial AND v_missing > 0 THEN
    RAISE EXCEPTION 'apply_inventory_count: % línea(s) a revisar sin motivo. Asigna un motivo antes de aprobar.', v_missing;
  END IF;

  IF v_is_opening THEN
    v_mtype := 'apertura';
    v_note  := 'Inventario de apertura (stock inicial)';
  ELSE
    v_mtype := 'ajuste';
    v_note  := 'Ajuste por conteo de inventario';
  END IF;

  -- Idempotencia: elimina cualquier asiento previo generado por ESTE conteo.
  DELETE FROM public.stock_movement
    WHERE source_type = 'inventory_count'
      AND source_id   = p_count_id;

  FOR r IN
    SELECT l.recipe_item_id,
           l.counted_qty,
           COALESCE(l.counted_at, v_instant) AS line_instant,
           COALESCE((
             SELECT SUM(sm.qty_base)
               FROM public.stock_movement sm
              WHERE sm.recipe_item_id = l.recipe_item_id
                AND sm.location_id    = v_location_id
                AND sm.occurred_at    < COALESCE(l.counted_at, v_instant)
           ), 0) AS ledger_before,
           COALESCE(ril.avg_unit_cost, 0) AS unit_cost
      FROM public.inventory_count_line l
      LEFT JOIN public.recipe_item_location_stock ril
        ON ril.recipe_item_id = l.recipe_item_id
       AND ril.location_id = v_location_id
       AND ril.account_id  = v_account_id
     WHERE l.inventory_count_id = p_count_id
       AND l.counted_qty IS NOT NULL
       AND (
         NOT p_partial
         -- CAMBIO 10/09: en modo parcial, `needs_review` NUNCA entra sola.
         -- Con motivo puesto por una persona, sí: el motivo ES la decisión.
         OR (l.needs_review = false AND l.within_tolerance = true)
         OR (l.reason_code IS NOT NULL AND l.reason_code <> '')
       )
     ORDER BY l.recipe_item_id
  LOOP
    v_delta := r.counted_qty - r.ledger_before;
    IF abs(v_delta) > 0.0000001 THEN
      INSERT INTO public.stock_movement (
        account_id, location_id, recipe_item_id, movement_type, qty_base,
        unit_cost, cost_provisional, source_type, source_id, occurred_at,
        created_by, created_by_name, notes
      ) VALUES (
        v_account_id, v_location_id, r.recipe_item_id, v_mtype, v_delta,
        r.unit_cost, false, 'inventory_count', p_count_id, r.line_instant,
        p_user_id, p_user_name, v_note
      );
      v_adj := v_adj + 1;
    END IF;
    PERFORM public.recompute_location_stock(r.recipe_item_id, v_location_id);
    v_rec := v_rec + 1;
  END LOOP;

  IF v_missing > 0 AND p_partial THEN
    UPDATE public.inventory_count
      SET updated_at = now()
      WHERE id = p_count_id;
  ELSE
    UPDATE public.inventory_count
      SET status = 'aprobado',
          approved_at = now(),
          approved_by = p_user_id,
          approved_by_name = p_user_name,
          updated_at = now()
      WHERE id = p_count_id;
  END IF;

  RETURN QUERY SELECT v_adj, v_rec;
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════
-- autoclose_daily_count · el recuento de lo que queda pendiente
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.autoclose_daily_count(p_count_id uuid)
RETURNS TABLE(closed boolean, applied integer, pending_anomalies integer, final_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_status text;
  v_applied integer := 0;
  v_pending integer := 0;
  v_final text;
BEGIN
  SELECT account_id, status INTO v_account_id, v_status
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'autoclose_daily_count: conteo % no existe', p_count_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR v_account_id = ANY(public.current_user_account_ids())) THEN
    RAISE EXCEPTION 'autoclose_daily_count: sin acceso';
  END IF;

  IF v_status = 'aprobado' OR v_status = 'anulado' THEN
    RETURN QUERY SELECT false, 0, 0, v_status;
    RETURN;
  END IF;

  IF v_status = 'contando' OR v_status = 'abierto' THEN
    PERFORM public.close_inventory_count(p_count_id);
  END IF;

  SELECT adjustments INTO v_applied
    FROM public.apply_inventory_count(p_count_id, NULL, 'Autoinventario', true);

  -- CAMBIO 10/09: cuenta también las `needs_review` sin motivo. Si no, el
  -- conteo pasaría a 'aprobado' con líneas contadas dos veces esperando a
  -- alguien, que es exactamente el éxito silencioso de la regla 8.
  SELECT COUNT(*) INTO v_pending
    FROM public.inventory_count_line
    WHERE inventory_count_id = p_count_id
      AND counted_qty IS NOT NULL
      AND (within_tolerance = false OR needs_review = true)
      AND (reason_code IS NULL OR reason_code = '');

  SELECT status INTO v_final FROM public.inventory_count WHERE id = p_count_id;

  RETURN QUERY SELECT true, v_applied, v_pending, v_final;
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════
-- request_recount · «que lo cuente otro»
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.request_recount(
  p_line_id   uuid,
  p_assign_to uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id  uuid;
  v_location_id uuid;
  v_item_id     uuid;
  v_conto       uuid;
  v_asignado    uuid;
  v_abierto     uuid;
  v_nueva       uuid;
  v_pos         integer;
  v_nombre      text;
BEGIN
  SELECT l.account_id, l.recipe_item_id, l.counted_by, ic.location_id
    INTO v_account_id, v_item_id, v_conto, v_location_id
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.id = p_line_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'request_recount: la línea % no existe', p_line_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'request_recount: sólo quien aprueba puede pedir un recuento';
  END IF;

  -- OTRA PERSONA, y esto no es una preferencia: preguntarle otra vez a quien ya
  -- contestó da la misma respuesta. Si el que se propone es el mismo que contó,
  -- se busca a cualquier otro con conteos en este local; si no hay nadie más,
  -- la línea se crea SIN asignar y la reparte el round-robin del día.
  v_asignado := p_assign_to;
  IF v_asignado IS NOT NULL AND v_conto IS NOT NULL AND v_asignado = v_conto THEN
    v_asignado := NULL;
  END IF;
  IF v_asignado IS NULL AND v_conto IS NOT NULL THEN
    SELECT l2.counted_by INTO v_asignado
      FROM public.inventory_count_line l2
      JOIN public.inventory_count ic2 ON ic2.id = l2.inventory_count_id
     WHERE ic2.location_id = v_location_id
       AND l2.account_id = v_account_id
       AND l2.counted_by IS NOT NULL
       AND l2.counted_by <> v_conto
       AND l2.counted_at > now() - interval '30 days'
     GROUP BY l2.counted_by
     ORDER BY max(l2.counted_at) DESC
     LIMIT 1;
  END IF;

  UPDATE public.inventory_count_line
     SET recount_requested_at = now(),
         recount_requested_by = auth.uid(),
         recount_assign_to    = v_asignado
   WHERE id = p_line_id;

  -- Si el autoinventario de HOY sigue abierto y el artículo no está ya dentro,
  -- la línea entra ahora mismo. Si no, espera al siguiente (paso 7).
  SELECT id INTO v_abierto
    FROM public.inventory_count
   WHERE account_id = v_account_id AND location_id = v_location_id
     AND kind = 'cycle' AND status IN ('abierto','contando')
     AND created_at::date = current_date
   ORDER BY created_at DESC LIMIT 1;

  IF v_abierto IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.inventory_count_line x
                      WHERE x.inventory_count_id = v_abierto AND x.recipe_item_id = v_item_id) THEN
    SELECT COALESCE(max(position), 0) + 1 INTO v_pos
      FROM public.inventory_count_line WHERE inventory_count_id = v_abierto;

    INSERT INTO public.inventory_count_line
      (account_id, inventory_count_id, recipe_item_id, position, system_qty,
       abc_class, assigned_to, recount_of)
    SELECT v_account_id, v_abierto, v_item_id, v_pos,
           public.theoretical_qty_at(v_item_id, v_location_id, now()),
           l.abc_class, v_asignado, p_line_id
      FROM public.inventory_count_line l WHERE l.id = p_line_id
    RETURNING id INTO v_nueva;
  END IF;

  SELECT e.name INTO v_nombre FROM public.employees e WHERE e.id = v_asignado;

  -- Regla 8: la confirmación lleva CONTENIDO. Quien pulsa «Recontar» tiene que
  -- poder leer a quién le ha caído y para cuándo, sin ir a mirar la BBDD.
  RETURN jsonb_build_object(
    'requested',    true,
    'new_line_id',  v_nueva,
    'when',         CASE WHEN v_nueva IS NOT NULL THEN 'hoy' ELSE 'proximo' END,
    'assigned_to',  v_asignado,
    'assigned_name', v_nombre
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_recount(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_recount(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.request_recount(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.request_recount(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.request_recount(uuid, uuid) IS
  'Pide que otra persona vuelva a contar este artículo: crea la línea con '
  'recount_of en el autoinventario de hoy si sigue abierto, o la deja en cola '
  'para el siguiente (§2.4, 10/09/2026).';

COMMIT;
