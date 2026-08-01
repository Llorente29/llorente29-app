-- 20260801T1600_inventory_count_permisos_c3.sql
-- Aplicada: 2026-08-01 (a mano por SQL Editor; la BD ya está en este estado = REGISTRO).
-- C3 — Permisos y segregación de funciones del inventario manual.
--   1) supply_settings += require_separate_approval boolean not null default true
--   2) can_operate_manual_count(uuid): manager/admin siempre; si no, actor
--      (auth.uid()->user_profiles.employee_id) == assigned_employee_id. Solo kind full/audit.
--   3) build_inventory_count  -> guard can_operate_manual_count (Empezar)
--   4) close_inventory_count  -> guard can_operate_manual_count (Terminar)
--   5) apply_inventory_count  -> aprobar conteos manuales exige manager/admin; si
--      require_separate_approval, aprobador != assigned_employee_id. (Foto por línea
--      de C2 conservada: COALESCE(l.counted_at, v_instant).)
--   6) reassign_inventory_count(uuid,uuid): solo gestor; si 'contando' REINICIA.
-- Cuerpos = copia LITERAL de pg_get_functiondef del vivo (no re-ejecutar; es registro).

-- (1) Flag DDL puro
alter table supply_settings
  add column if not exists require_separate_approval boolean not null default true;

-- (2) can_operate_manual_count
CREATE OR REPLACE FUNCTION public.can_operate_manual_count(p_count_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_kind text;
  v_assigned uuid;
  v_actor_emp uuid;
begin
  select account_id, kind, assigned_employee_id
    into v_account_id, v_kind, v_assigned
    from public.inventory_count where id = p_count_id;
  if v_account_id is null then
    return false;
  end if;
  -- Solo restringimos conteos MANUALES (full/audit). Los 'cycle' del
  -- autoinventario no pasan por aquí como restricción.
  if v_kind not in ('full','audit') then
    return true;
  end if;
  -- Manager/admin de la cuenta: siempre puede.
  if public.current_user_is_admin()
     or public.current_user_is_admin_or_manager_of(v_account_id) then
    return true;
  end if;
  -- Sin empleado asignado: no hay a quién restringir (solo manager llegaría aquí,
  -- ya cubierto arriba) → por seguridad, denegar a un no-manager.
  if v_assigned is null then
    return false;
  end if;
  -- Resolver el empleado del actor por su sesión.
  select up.employee_id into v_actor_emp
    from public.user_profiles up
    where up.user_id = auth.uid() and up.account_id = v_account_id
    limit 1;
  return v_actor_emp is not null and v_actor_emp = v_assigned;
end;
$function$;

-- (3) build_inventory_count
CREATE OR REPLACE FUNCTION public.build_inventory_count(p_count_id uuid, p_area_ids uuid[] DEFAULT NULL::uuid[], p_full boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_n integer := 0;
  v_p90 numeric;
  v_p50 numeric;
  v_has_opening boolean;
BEGIN
  SELECT account_id, location_id INTO v_account_id, v_location_id
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'build_inventory_count: conteo % no existe', p_count_id;
  END IF;
  -- C3: solo el empleado asignado (o un manager/admin) puede EMPEZAR un conteo manual.
  IF NOT public.can_operate_manual_count(p_count_id) THEN
    RAISE EXCEPTION 'build_inventory_count: este inventario está asignado a otra persona';
  END IF;
  -- ¿El local ya tiene una apertura en el ledger? Si no, este conteo lo es.
  SELECT EXISTS (
    SELECT 1 FROM public.stock_movement
    WHERE account_id = v_account_id
      AND location_id = v_location_id
      AND movement_type = 'apertura'
  ) INTO v_has_opening;
  UPDATE public.inventory_count
    SET is_opening = NOT v_has_opening
    WHERE id = p_count_id;
  DELETE FROM public.inventory_count_line WHERE inventory_count_id = p_count_id;
  SELECT
    percentile_cont(0.90) WITHIN GROUP (ORDER BY COALESCE(qty_on_hand,0)*COALESCE(avg_unit_cost,0)),
    percentile_cont(0.50) WITHIN GROUP (ORDER BY COALESCE(qty_on_hand,0)*COALESCE(avg_unit_cost,0))
  INTO v_p90, v_p50
  FROM public.recipe_item_location_stock
  WHERE account_id = v_account_id AND location_id = v_location_id;
  INSERT INTO public.inventory_count_line (
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class
  )
  SELECT
    v_account_id,
    p_count_id,
    ri.id,
    risa.storage_area_id,
    COALESCE(sa.position, 9999) * 1000 + COALESCE(risa.position, 999),
    COALESCE(ril.qty_on_hand, 0),
    NULL,
    CASE
      WHEN v_p90 IS NULL OR COALESCE(ril.avg_unit_cost,0) = 0 THEN NULL
      WHEN COALESCE(ril.qty_on_hand,0)*COALESCE(ril.avg_unit_cost,0) >= v_p90 THEN 'A'
      WHEN COALESCE(ril.qty_on_hand,0)*COALESCE(ril.avg_unit_cost,0) >= v_p50 THEN 'B'
      ELSE 'C'
    END
  FROM public.recipe_item ri
  LEFT JOIN public.recipe_item_storage_area risa
    ON risa.recipe_item_id = ri.id AND risa.account_id = v_account_id
  LEFT JOIN public.storage_area sa
    ON sa.id = risa.storage_area_id AND sa.location_id = v_location_id
  LEFT JOIN public.recipe_item_location_stock ril
    ON ril.recipe_item_id = ri.id AND ril.location_id = v_location_id AND ril.account_id = v_account_id
  WHERE ri.account_id = v_account_id
    AND ri.type = 'raw'
    AND ri.is_active = true
    AND (
      p_full = true
      OR (p_area_ids IS NOT NULL AND risa.storage_area_id = ANY(p_area_ids))
      OR (p_area_ids IS NULL AND p_full = false AND sa.id IS NOT NULL)
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.inventory_count
    SET status = 'contando', started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = p_count_id;
  RETURN v_n;
END;
$function$;

-- (4) close_inventory_count
CREATE OR REPLACE FUNCTION public.close_inventory_count(p_count_id uuid)
 RETURNS TABLE(lines_total integer, lines_counted integer, lines_ok integer, lines_out integer, lines_uncounted integer, total_variance_value numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_status text;
  v_tol_a numeric; v_tol_b numeric; v_tol_c numeric;
BEGIN
  SELECT account_id, location_id, status INTO v_account_id, v_location_id, v_status
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'close_inventory_count: conteo % no existe', p_count_id;
  END IF;

  -- H7: el llamante debe pertenecer a la cuenta del conteo.
  IF NOT belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'close_inventory_count: sin acceso a la cuenta %', v_account_id;
  END IF;

  -- C3: solo el empleado asignado (o un manager/admin) puede TERMINAR un conteo manual.
  IF NOT public.can_operate_manual_count(p_count_id) THEN
    RAISE EXCEPTION 'close_inventory_count: este inventario está asignado a otra persona';
  END IF;

  -- H9: solo se cierra desde abierto/contando (o en_revision, idempotente).
  IF v_status NOT IN ('abierto', 'contando', 'en_revision') THEN
    RAISE EXCEPTION 'close_inventory_count: el conteo está en % y no se puede cerrar', v_status;
  END IF;

  SELECT COALESCE(tol_a_pct,2), COALESCE(tol_b_pct,3), COALESCE(tol_c_pct,5)
    INTO v_tol_a, v_tol_b, v_tol_c
    FROM public.supply_settings WHERE account_id = v_account_id;
  v_tol_a := COALESCE(v_tol_a,2); v_tol_b := COALESCE(v_tol_b,3); v_tol_c := COALESCE(v_tol_c,5);

  UPDATE public.inventory_count_line l
  SET
    variance_qty = l.counted_qty - l.system_qty,
    variance_pct = CASE WHEN COALESCE(l.system_qty,0) <> 0
                        THEN (l.counted_qty - l.system_qty) / l.system_qty * 100
                        ELSE NULL END,
    variance_value = (l.counted_qty - l.system_qty) * COALESCE(ril.avg_unit_cost, 0),
    within_tolerance = CASE
      WHEN l.counted_qty IS NULL THEN NULL
      WHEN COALESCE(l.system_qty,0) = 0 THEN (l.counted_qty = 0)
      ELSE abs((l.counted_qty - l.system_qty) / l.system_qty * 100) <=
           CASE l.abc_class WHEN 'A' THEN v_tol_a WHEN 'B' THEN v_tol_b ELSE v_tol_c END
    END
  FROM public.recipe_item_location_stock ril
  WHERE l.inventory_count_id = p_count_id
    AND ril.recipe_item_id = l.recipe_item_id
    AND ril.location_id = v_location_id
    AND ril.account_id = v_account_id;

  UPDATE public.inventory_count_line l
  SET
    variance_qty = l.counted_qty - l.system_qty,
    variance_pct = CASE WHEN COALESCE(l.system_qty,0) <> 0
                        THEN (l.counted_qty - l.system_qty) / l.system_qty * 100
                        ELSE NULL END,
    variance_value = 0,
    within_tolerance = CASE
      WHEN l.counted_qty IS NULL THEN NULL
      WHEN COALESCE(l.system_qty,0) = 0 THEN (l.counted_qty = 0)
      ELSE abs((l.counted_qty - l.system_qty) / l.system_qty * 100) <=
           CASE l.abc_class WHEN 'A' THEN v_tol_a WHEN 'B' THEN v_tol_b ELSE v_tol_c END
    END
  WHERE l.inventory_count_id = p_count_id
    AND l.counted_qty IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.recipe_item_location_stock ril
      WHERE ril.recipe_item_id = l.recipe_item_id
        AND ril.location_id = v_location_id AND ril.account_id = v_account_id
    );

  -- SANEAMIENTO: si el sistema estaba en NEGATIVO, el conteo lo corrige pero NO
  -- es merma del período: variación económica 0 y dentro de tolerancia.
  UPDATE public.inventory_count_line l
  SET variance_value = 0,
      within_tolerance = true
  WHERE l.inventory_count_id = p_count_id
    AND l.counted_qty IS NOT NULL
    AND COALESCE(l.system_qty, 0) < 0;

  UPDATE public.inventory_count
    SET status = 'en_revision', closed_at = now(), updated_at = now()
    WHERE id = p_count_id;

  RETURN QUERY
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE counted_qty IS NOT NULL)::integer,
    COUNT(*) FILTER (WHERE counted_qty IS NOT NULL AND within_tolerance = true)::integer,
    COUNT(*) FILTER (WHERE counted_qty IS NOT NULL AND within_tolerance = false)::integer,
    COUNT(*) FILTER (WHERE counted_qty IS NULL)::integer,
    COALESCE(SUM(variance_value) FILTER (WHERE counted_qty IS NOT NULL), 0)
  FROM public.inventory_count_line
  WHERE inventory_count_id = p_count_id;
END;
$function$;

-- (5) apply_inventory_count
CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text, p_partial boolean DEFAULT false)
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

  -- C3: APROBACIÓN de conteos MANUALES (full/audit). Los 'cycle' del
  -- autoinventario NO pasan por esta restricción.
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

  SELECT COUNT(*) INTO v_missing
    FROM public.inventory_count_line
    WHERE inventory_count_id = p_count_id
      AND counted_qty IS NOT NULL
      AND within_tolerance = false
      AND (reason_code IS NULL OR reason_code = '');

  IF NOT v_is_opening AND NOT p_partial AND v_missing > 0 THEN
    RAISE EXCEPTION 'apply_inventory_count: % línea(s) fuera de tolerancia sin motivo. Asigna un motivo antes de aprobar.', v_missing;
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
         OR l.within_tolerance = true
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

-- (6) reassign_inventory_count
CREATE OR REPLACE FUNCTION public.reassign_inventory_count(p_count_id uuid, p_employee_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_kind text;
  v_status text;
  v_reset boolean := false;
begin
  select account_id, kind, status
    into v_account_id, v_kind, v_status
    from public.inventory_count where id = p_count_id
    for update;
  if v_account_id is null then
    raise exception 'reassign_inventory_count: conteo % no existe', p_count_id;
  end if;
  -- Solo conteos MANUALES (los cycle del autoinventario no se reasignan a mano).
  if v_kind not in ('full','audit') then
    raise exception 'reassign_inventory_count: solo se reasignan inventarios manuales';
  end if;
  -- Solo gestor/admin (oficina).
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'reassign_inventory_count: solo un gestor puede reasignar un inventario';
  end if;
  -- El empleado nuevo debe existir en la cuenta y estar activo.
  if not exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.account_id = v_account_id and e.active = true
  ) then
    raise exception 'reassign_inventory_count: el empleado no es válido para esta cuenta';
  end if;
  -- No tiene sentido reasignar algo ya contado.
  if v_status in ('en_revision','aprobado','anulado') then
    raise exception 'reassign_inventory_count: el inventario está en % y ya no se puede reasignar', v_status;
  end if;
  -- Si ya se había EMPEZADO (contando) -> REINICIA: borra la hoja y vuelve a
  -- programado. El nuevo asignado pulsará "Empezar" y hará su propio snapshot.
  if v_status = 'contando' then
    delete from public.inventory_count_line where inventory_count_id = p_count_id;
    v_reset := true;
  end if;
  update public.inventory_count
    set assigned_employee_id = p_employee_id,
        assigned_at = now(),
        assigned_by = auth.uid(),
        status = 'abierto',
        started_at = null,
        updated_at = now()
    where id = p_count_id;
  return case when v_reset then 'reasignado_reiniciado' else 'reasignado' end;
end;
$function$;

notify pgrst, 'reload schema';

-- Guard de existencia (1ª red; la verdad la da la verificación con query independiente).
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name='supply_settings' and column_name='require_separate_approval') then
    raise exception 'Falta supply_settings.require_separate_approval';
  end if;
  if not exists (select 1 from pg_proc where proname='can_operate_manual_count') then
    raise exception 'Falta can_operate_manual_count';
  end if;
  if not exists (select 1 from pg_proc where proname='reassign_inventory_count') then
    raise exception 'Falta reassign_inventory_count';
  end if;
end $$;
