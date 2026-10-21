-- supabase/migrations/20261129T0400_autoconteo_se_aplica_entero.sql
-- cambia: public.inventory_count · prueba: supabase/staging/sql/20261129_autoconteo_prueba.sql
-- cambia: public.close_inventory_count · prueba: supabase/staging/sql/20261129_autoconteo_prueba.sql
-- cambia: public.apply_inventory_count · prueba: supabase/staging/sql/20261129_autoconteo_prueba.sql
-- cambia: public.autoclose_daily_count · prueba: supabase/staging/sql/20261129_autoconteo_prueba.sql
-- cambia: public.cron_autoclose_daily_counts · prueba: supabase/staging/sql/20261129_autoconteo_prueba.sql
--
-- AUTOCONTEO · 2 de 2 · EL AUTOCONTEO SE APLICA SOLO, ENTERO Y CON CUALQUIER
-- DIFERENCIA (decisión de Julio, 21/10/2026, respuesta 3 del encargo).
--
-- El número lo dio Julio el 21/10 (después de la 0380 de P). Va DESPUÉS de la
-- 0390 (que anula los atascados): así esta noche el cron nuevo no encuentra ninguno.
--
-- LA REGLA, en las palabras de Julio:
--   · Se aplica en el momento en que quien cuenta lo termina en la tablet,
--     entero, con cualquier diferencia, sin motivos ni oficina.
--   · Si no se termina, se cierra y se aplica con lo contado antes de que se
--     genere el siguiente: el cron de las 03:10 UTC (antes del de las 04:00), y
--     el cierre de rezagados al generar se queda como red.
--   · La diferencia se sigue calculando y guardando, pero nunca frena.
--   · Las líneas apartadas a mano siguen sin aplicarse.
--   · Los conteos manuales y de seguridad (full, audit) NO cambian.
--
-- POR QUÉ NO APLICABA NADA (medido el 21/10): close_inventory_count y
-- apply_inventory_count empiezan comprobando que quien llama pertenece a la
-- cuenta. A las 03:10 no hay nadie: belongs_to_account() da false, el cron
-- cogía la excepción, la bajaba a `raise warning` y pg_cron contaba
-- «succeeded». Cero conteos aplicados en toda su vida.
--
-- LO QUE HACE:
--   1. Tres columnas en inventory_count: cómo se aplicó solo
--      (auto_applied_via: al_terminar | cron | rezagado) y el último fallo
--      (auto_apply_error, auto_apply_failed_at). Solo añaden.
--   2. Los NÚCLEOS sin guarda de cuenta: _close_inventory_count_core y
--      _apply_inventory_count_core, con el cuerpo de producción del 21/10
--      (copiado de pg_get_functiondef) menos las guardas. Solo los ejecutan
--      postgres y service_role. close_inventory_count y apply_inventory_count
--      quedan con sus guardas de siempre y llaman al núcleo: la pantalla y sus
--      permisos no cambian.
--   3. En el núcleo de aplicar, para kind = 'cycle', los motivos no frenan y
--      entran todas las líneas contadas (menos las apartadas). Para 'full' y
--      'audit' el cuerpo es el mismo de antes, línea a línea.
--   4. _autoconteo_aplicar: cierra si hace falta y aplica entero, y deja
--      escrito cómo. Si no hay nada contado, ANULA («nadie contó nada»): aprobar
--      un conteo vacío diría «aplicado» sin haber aplicado nada (regla 8).
--   5. autoclose_daily_count (lo llama la tablet al contar la última pieza, y
--      el generador para los rezagados) aplica entero por _autoconteo_aplicar.
--      Si el conteo es de hoy y no queda nada por contar, «al_terminar»; si
--      no, «rezagado».
--   6. autoconteo_cierre_nocturno(): PROCEDIMIENTO, con COMMIT por conteo, que
--      sustituye al cron de las 03:10. Lo aplicado se queda aunque otro falle;
--      cada fallo se apunta en la fila y en system_alert_queue, y al final, si
--      hubo alguno, LANZA UN ERROR: pg_cron lo marca en rojo (como
--      conta_cierre_del_dia_todas). cron_autoclose_daily_counts se queda sin
--      uso y, si alguien la llama, falla diciendo por qué (se borra en otra
--      tanda, cuando nada la nombre).
--   7. autoconteos_sin_aplicar(cuenta): lo que la pantalla de inventario avisa.
--   8. autoconteo_vigia(): lo que lee el vigía de GitHub, de todas las cuentas,
--      sin nombres. La puede ejecutar conta_lectura (solo lee).
--
-- LO QUE ROZA EL INVENTARIO (dicho a Julio el 21/10):
--   · Cada autoconteo aplicado pasa a ser «el último conteo aprobado» de sus
--     artículos: el corte para reprocesar consumo (regla 6) se moverá cada día.
--   · recompute_location_stock, el que usa cerrar una venta, se llama igual y
--     no se toca.
--   · Camino del pedido: estas funciones las llama un cron, así que el
--     analizador las cuenta como del camino y pide «autorizo». Ninguna venta,
--     cocina ni reparto las llama.
--
-- Vuelta atrás: supabase/vuelta-atras/20261129T0400_autoconteo_se_aplica_entero.down.sql

-- ── 1 · Las columnas ───────────────────────────────────────────────────────
alter table public.inventory_count
  add column auto_applied_via text check (auto_applied_via in ('al_terminar', 'cron', 'rezagado')),
  add column auto_apply_error text,
  add column auto_apply_failed_at timestamptz;

comment on column public.inventory_count.auto_applied_via is
  'Cómo se aplicó solo un autoconteo: al_terminar (la tablet, al contar la última pieza), cron (03:10 UTC) o rezagado (al generar el siguiente). NULL = no se aplicó solo.';
comment on column public.inventory_count.auto_apply_error is
  'El último error al aplicar solo este autoconteo. Se borra cuando se aplica.';

-- ── 2 · El núcleo de cerrar (el cuerpo de producción, sin las dos guardas) ──
create function public._close_inventory_count_core(p_count_id uuid)
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

  -- Las guardas de cuenta y de asignación viven en close_inventory_count.

  IF v_status NOT IN ('abierto', 'contando', 'en_revision') THEN
    RAISE EXCEPTION 'close_inventory_count: el conteo está en % y no se puede cerrar', v_status;
  END IF;

  PERFORM public.rebase_count_system_qty(p_count_id);

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
    -- CAMBIO 10/09: sin coste fiable, NULL. Nunca 0 callado.
    variance_value = (l.counted_qty - l.system_qty) * ril.avg_unit_cost,
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

  -- Sin fila de stock del artículo en el local: no hay con qué valorar. NULL,
  -- que es lo que es, y la pantalla lo dirá con palabras.
  UPDATE public.inventory_count_line l
  SET
    variance_qty = l.counted_qty - l.system_qty,
    variance_pct = CASE WHEN COALESCE(l.system_qty,0) <> 0
                        THEN (l.counted_qty - l.system_qty) / l.system_qty * 100
                        ELSE NULL END,
    variance_value = NULL,
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

  -- LA APERTURA NO CALCULA DIFERENCIAS (10/09, noche): NULL y no cero, y va
  -- el último a propósito para que el saneamiento de arriba no lo pise.
  UPDATE public.inventory_count_line l
     SET variance_qty      = NULL,
         variance_pct      = NULL,
         variance_value    = NULL,
         within_tolerance  = NULL
    FROM public.inventory_count ic
   WHERE ic.id = p_count_id
     AND l.inventory_count_id = p_count_id
     AND COALESCE(ic.is_opening, false);

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

revoke execute on function public._close_inventory_count_core(uuid) from public, anon, authenticated;
grant execute on function public._close_inventory_count_core(uuid) to service_role;

-- close_inventory_count: las dos guardas de siempre y el núcleo.
CREATE OR REPLACE FUNCTION public.close_inventory_count(p_count_id uuid)
 RETURNS TABLE(lines_total integer, lines_counted integer, lines_ok integer, lines_out integer, lines_uncounted integer, total_variance_value numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT account_id INTO v_account_id FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'close_inventory_count: conteo % no existe', p_count_id;
  END IF;

  IF NOT belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'close_inventory_count: sin acceso a la cuenta %', v_account_id;
  END IF;

  IF NOT public.can_operate_manual_count(p_count_id) THEN
    RAISE EXCEPTION 'close_inventory_count: este inventario está asignado a otra persona';
  END IF;

  RETURN QUERY SELECT * FROM public._close_inventory_count_core(p_count_id);
END;
$function$;

-- ── 3 · El núcleo de aplicar ───────────────────────────────────────────────
-- El cuerpo de producción del 21/10 sin H7 ni C3 (se quedan en
-- apply_inventory_count). Lo único nuevo: el bloque «AUTOCONTEO».
create function public._apply_inventory_count_core(p_count_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text, p_partial boolean DEFAULT false)
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
  v_faltan text;
  v_need uuid[];
  v_adj integer := 0;
  v_rec integer := 0;
  v_mtype text;
  v_note text;
  v_delta numeric;
  r RECORD;
  v_kind text;
BEGIN
  -- H8: FOR UPDATE serializa aprobaciones concurrentes del MISMO conteo.
  SELECT account_id, location_id, status, is_opening, kind,
         COALESCE(started_at, closed_at, created_at, now())
    INTO v_account_id, v_location_id, v_status, v_is_opening, v_kind, v_instant
    FROM public.inventory_count WHERE id = p_count_id
    FOR UPDATE;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'apply_inventory_count: conteo % no existe', p_count_id;
  END IF;

  IF v_status = 'aprobado' THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  IF v_status <> 'en_revision' THEN
    RAISE EXCEPTION 'apply_inventory_count: el conteo debe estar en revisión (está en %)', v_status;
  END IF;

  IF v_kind = 'cycle' THEN
    -- AUTOCONTEO (Julio, 21/10/2026): se aplica entero, con cualquier
    -- diferencia, sin motivos. La diferencia queda guardada en la línea
    -- (variance_*, la calcula el cierre) y nunca frena. Las apartadas siguen
    -- fuera por el filtro de excluded_at de abajo.
    v_need := '{}'::uuid[];
    v_missing := 0;
  ELSE
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
    END IF;
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
           -- `avg_unit_cost` a secas, sin COALESCE a 0 (corrección de Julio §1.1, 10/09).
           ril.avg_unit_cost AS unit_cost
      FROM public.inventory_count_line l
      LEFT JOIN public.recipe_item_location_stock ril
        ON ril.recipe_item_id = l.recipe_item_id
       AND ril.location_id = v_location_id
       AND ril.account_id  = v_account_id
     WHERE l.inventory_count_id = p_count_id
       AND l.counted_qty IS NOT NULL
       -- Una línea apartada NO se aplica (11/09): la aparta una persona o el
       -- trigger del ajuste a mano. Es lo único que decide por encima del recuento.
       AND l.excluded_at IS NULL
       AND (
         NOT p_partial
         OR NOT (l.id = ANY(v_need))
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

revoke execute on function public._apply_inventory_count_core(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public._apply_inventory_count_core(uuid, uuid, text, boolean) to service_role;

-- apply_inventory_count: H7 y C3 de siempre, y el núcleo.
CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text, p_partial boolean DEFAULT false)
 RETURNS TABLE(adjustments integer, items_recomputed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_kind text;
  v_assigned uuid;
  v_require_sep boolean;
  v_actor_emp uuid;
BEGIN
  SELECT account_id, kind, assigned_employee_id
    INTO v_account_id, v_kind, v_assigned
    FROM public.inventory_count WHERE id = p_count_id;

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

  RETURN QUERY SELECT * FROM public._apply_inventory_count_core(p_count_id, p_user_id, p_user_name, p_partial);
END;
$function$;

-- ── 4 · Aplicar solo un autoconteo ─────────────────────────────────────────
create function public._autoconteo_aplicar(p_count_id uuid, p_via text, p_user_id uuid, p_user_name text)
returns table(final_status text, adjustments integer, items_recomputed integer, counted_lines integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_kind text;
  v_status text;
  v_counted integer;
  v_adj integer := 0;
  v_rec integer := 0;
begin
  if p_via not in ('al_terminar', 'cron', 'rezagado') then
    raise exception '_autoconteo_aplicar: forma desconocida «%»', p_via;
  end if;

  select kind, status into v_kind, v_status
    from public.inventory_count where id = p_count_id
    for update;
  if v_kind is null then
    raise exception '_autoconteo_aplicar: conteo % no existe', p_count_id;
  end if;
  if v_kind <> 'cycle' then
    -- Un inventario manual o de seguridad no se aplica solo, nunca.
    raise exception '_autoconteo_aplicar: % no es un autoconteo (es %): no se aplica solo', p_count_id, v_kind;
  end if;
  if v_status in ('aprobado', 'anulado') then
    return query select v_status, 0, 0,
      (select count(*)::int from public.inventory_count_line l
        where l.inventory_count_id = p_count_id and l.counted_qty is not null and l.excluded_at is null);
    return;
  end if;

  select count(*)::int into v_counted
    from public.inventory_count_line l
   where l.inventory_count_id = p_count_id and l.counted_qty is not null and l.excluded_at is null;

  if v_counted = 0 then
    -- Nadie contó nada: no hay nada que aplicar, y aprobarlo diría «aplicado»
    -- sin haber tocado el stock. Se anula, y se dice por qué.
    update public.inventory_count
       set status = 'anulado',
           notes = concat_ws(E'\n', notes, 'Anulado solo: nadie contó nada antes de preparar el siguiente.'),
           auto_applied_via = p_via,
           auto_apply_error = null,
           auto_apply_failed_at = null,
           updated_at = now()
     where id = p_count_id;
    return query select 'anulado'::text, 0, 0, 0;
    return;
  end if;

  if v_status in ('abierto', 'contando') then
    perform public._close_inventory_count_core(p_count_id);
  end if;

  select a.adjustments, a.items_recomputed into v_adj, v_rec
    from public._apply_inventory_count_core(p_count_id, p_user_id, p_user_name, false) a;

  update public.inventory_count
     set auto_applied_via = p_via, auto_apply_error = null, auto_apply_failed_at = null
   where id = p_count_id;

  return query select (select status from public.inventory_count where id = p_count_id), v_adj, v_rec, v_counted;
end;
$function$;

revoke execute on function public._autoconteo_aplicar(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public._autoconteo_aplicar(uuid, text, uuid, text) to service_role;

-- ── 5 · La tablet al terminar, y la red de los rezagados ───────────────────
-- Misma firma y mismas columnas de vuelta. pending_anomalies es siempre 0:
-- un autoconteo ya no deja nada esperando a la oficina.
CREATE OR REPLACE FUNCTION public.autoclose_daily_count(p_count_id uuid)
 RETURNS TABLE(closed boolean, applied integer, pending_anomalies integer, final_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_status text;
  v_created timestamptz;
  v_faltan integer;
  v_via text;
  v_nombre text;
  r record;
BEGIN
  SELECT account_id, status, created_at INTO v_account_id, v_status, v_created
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

  -- «al_terminar» solo si es el de hoy (en Madrid) y ya no queda nada por
  -- contar: es la tablet al contar la última pieza. Lo demás es el generador
  -- cerrando un rezagado.
  SELECT count(*)::int INTO v_faltan
    FROM public.inventory_count_line l
   WHERE l.inventory_count_id = p_count_id AND l.counted_qty IS NULL AND l.excluded_at IS NULL;
  v_via := CASE
    WHEN v_faltan = 0
     AND (v_created AT TIME ZONE 'Europe/Madrid')::date = (now() AT TIME ZONE 'Europe/Madrid')::date
    THEN 'al_terminar' ELSE 'rezagado' END;

  SELECT up.display_name INTO v_nombre
    FROM public.user_profiles up
   WHERE up.user_id = auth.uid() AND up.account_id = v_account_id
   LIMIT 1;

  SELECT * INTO r FROM public._autoconteo_aplicar(
    p_count_id, v_via, auth.uid(),
    CASE WHEN v_via = 'al_terminar' THEN coalesce(v_nombre, 'Autoconteo') ELSE 'Folvy (rezagado)' END);

  RETURN QUERY SELECT true, r.adjustments, 0, r.final_status;
END;
$function$;

-- ── 6 · La noche: el procedimiento que sustituye al cron de las 03:10 ──────
-- Sin SECURITY DEFINER ni SET: un procedimiento con cualquiera de los dos no
-- puede hacer COMMIT. Lo llama pg_cron como postgres, sin argumentos.
-- p_prueba = true es para la prueba de staging, que corre dentro de una
-- transacción con ROLLBACK: ni COMMIT ni el error del final (que desharía lo
-- apuntado), para poder mirarlo. El COMMIT y el rojo se prueban aparte.
create procedure public.autoconteo_cierre_nocturno(p_prueba boolean default false)
language plpgsql
as $procedure$
declare
  r record;
  v_ok integer := 0;
  v_anulados integer := 0;
  v_fallos text[] := '{}';
  v_res record;
begin
  for r in
    select ic.id, ic.code
      from public.inventory_count ic
     where ic.kind = 'cycle'
       and ic.status in ('abierto', 'contando', 'en_revision')
       -- margen: no tocar lo que se está contando ahora mismo
       and coalesce(ic.started_at, ic.created_at) < now() - interval '2 hours'
     order by ic.created_at
  loop
    begin
      select * into v_res from public._autoconteo_aplicar(r.id, 'cron', null, 'Folvy (autocierre)');
      if v_res.final_status = 'anulado' then v_anulados := v_anulados + 1; else v_ok := v_ok + 1; end if;
    exception when others then
      v_fallos := v_fallos || format('%s: %s', coalesce(r.code, r.id::text), sqlerrm);
      update public.inventory_count
         set auto_apply_error = sqlerrm, auto_apply_failed_at = now()
       where id = r.id;
      perform public._queue_system_alert(
        'autoinventario',
        'Autoconteo: no se ha podido aplicar ' || coalesce(r.code, 'un conteo'),
        format('El autoconteo %s no se ha aplicado esta noche: %s. Sigue en la pantalla de inventario hasta que se aplique.',
               coalesce(r.code, r.id::text), sqlerrm),
        'autoconteo_cierre_nocturno');
    end;
    if not p_prueba then commit; end if;
  end loop;

  raise notice 'autoconteo_cierre_nocturno: % aplicados, % anulados sin nada contado, % fallos.',
    v_ok, v_anulados, cardinality(v_fallos);
  if cardinality(v_fallos) > 0 and not p_prueba then
    -- En rojo en pg_cron. Lo aplicado ya está confirmado (COMMIT por conteo).
    raise exception 'Autoconteo de la noche: % sin aplicar: %',
      cardinality(v_fallos), array_to_string(v_fallos, ' · ');
  end if;
end;
$procedure$;

revoke execute on procedure public.autoconteo_cierre_nocturno(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job(j.jobid, command := 'call public.autoconteo_cierre_nocturno()')
       from cron.job j where j.jobname = 'autoinventory-autoclose';
  end if;
end $$;

-- La de antes se queda sin uso; si alguien la llama, falla diciéndolo en vez
-- de volver a callar.
CREATE OR REPLACE FUNCTION public.cron_autoclose_daily_counts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'cron_autoclose_daily_counts está retirada desde la 0400: la noche la hace public.autoconteo_cierre_nocturno().';
end;
$function$;

-- ── 7 · Lo que avisa la pantalla de inventario ─────────────────────────────
-- Un autoconteo sin aplicar: con un fallo apuntado, o abierto con más de 24 h
-- (el cron de las 03:10 UTC tendría que haberlo cogido ya).
create function public.autoconteos_sin_aplicar(p_account_id uuid)
returns table(count_id uuid, code text, location_id uuid, location_name text, created_at timestamptz,
              status text, counted_lines integer, error text, failed_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  if not belongs_to_account(p_account_id) then
    raise exception 'autoconteos_sin_aplicar: sin acceso a la cuenta %', p_account_id;
  end if;
  return query
  select ic.id, ic.code, ic.location_id, l.name, ic.created_at, ic.status,
         (select count(*)::int from public.inventory_count_line x
           where x.inventory_count_id = ic.id and x.counted_qty is not null and x.excluded_at is null),
         ic.auto_apply_error, ic.auto_apply_failed_at
    from public.inventory_count ic
    left join public.locations l on l.id = ic.location_id
   where ic.account_id = p_account_id
     and ic.kind = 'cycle'
     and ic.status in ('abierto', 'contando', 'en_revision')
     and (ic.auto_apply_failed_at is not null
          or coalesce(ic.started_at, ic.created_at) < now() - interval '24 hours')
   order by ic.created_at;
end;
$function$;

revoke execute on function public.autoconteos_sin_aplicar(uuid) from public, anon;
grant execute on function public.autoconteos_sin_aplicar(uuid) to authenticated, service_role;

-- ── 8 · Lo que lee el vigía (GitHub, cada mañana, con conta_lectura) ────────
-- Sin nombres de producto ni de local: el repositorio es público. Códigos,
-- días, cuántos y el último run del cron.
create function public.autoconteo_vigia()
returns table(clave text, valor text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_estado text := 'sin pg_cron';
  v_inicio timestamptz;
  v_msg text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select d.status, d.start_time, left(d.return_message, 300)
      into v_estado, v_inicio, v_msg
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where j.jobname = 'autoinventory-autoclose'
     order by d.start_time desc limit 1;
    v_estado := coalesce(v_estado, 'nunca ha corrido');
  end if;

  return query
  select 'cron_estado', v_estado
  union all select 'cron_inicio', coalesce(to_char(v_inicio at time zone 'Europe/Madrid', 'YYYY-MM-DD HH24:MI'), '—')
  union all select 'cron_mensaje', coalesce(v_msg, '—')
  union all
  select 'sin_aplicar',
         coalesce(string_agg(format('%s|%s|%s|%s|%s',
                    ic.code,
                    to_char(ic.created_at at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
                    ic.status,
                    (select count(*) from public.inventory_count_line x
                      where x.inventory_count_id = ic.id and x.counted_qty is not null and x.excluded_at is null),
                    case when ic.auto_apply_failed_at is not null then 'con fallo' else 'sin fallo apuntado' end),
                  ';' order by ic.created_at), '')
    from public.inventory_count ic
   where ic.kind = 'cycle'
     and ic.status in ('abierto', 'contando', 'en_revision')
     and (ic.auto_apply_failed_at is not null
          or coalesce(ic.started_at, ic.created_at) < now() - interval '24 hours');
end;
$function$;

revoke execute on function public.autoconteo_vigia() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'autoconteo 0400: no existe el rol conta_lectura (normal en staging): el vigía no se concede a nadie.';
    return;
  end if;
  grant execute on function public.autoconteo_vigia() to conta_lectura;
  raise notice 'autoconteo 0400: conta_lectura puede ejecutar autoconteo_vigia().';
end $$;
