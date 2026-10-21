-- supabase/vuelta-atras/20261129T0400_autoconteo_se_aplica_entero.down.sql
--
-- Vuelta atrás de la 0400: el cron vuelve a su orden de antes, las cuatro
-- funciones que cambió vuelven a su definición de producción del 21/10 (copiada
-- de pg_get_functiondef; huellas md5 en tests/inventario/autoconteo-huellas.json),
-- y se quita lo que añadió: los núcleos, el aplicador, el procedimiento de la
-- noche, la lectura de los sin aplicar, la del vigía y las tres columnas.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job(j.jobid, command := 'select public.cron_autoclose_daily_counts();')
       from cron.job j where j.jobname = 'autoinventory-autoclose';
  end if;
end $$;

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
  v_faltan text;
  v_need uuid[];
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
  -- Una línea `needs_review` sin motivo también lo está.
  -- CAMBIO 11/09: UNA sola regla, y vive en count_lines_requiring_reason.
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
           -- CAMBIO 10/09 (corrección de Julio §1.1): `avg_unit_cost` a secas,
           -- sin COALESCE a 0. Ese cero era la mitad del bucle: apply escribía
           -- 0 (o el coste medio negativo) en el ajuste, y el ajuste volvía a
           -- alimentar el coste medio. Las tres funciones que multiplican
           -- qty × unit_cost ya llevan su propio COALESCE — comprobado.
           ril.avg_unit_cost AS unit_cost
      FROM public.inventory_count_line l
      LEFT JOIN public.recipe_item_location_stock ril
        ON ril.recipe_item_id = l.recipe_item_id
       AND ril.location_id = v_location_id
       AND ril.account_id  = v_account_id
     WHERE l.inventory_count_id = p_count_id
       AND l.counted_qty IS NOT NULL
       -- CAMBIO 11/09: una linea apartada NO se aplica. La aparta una persona
       -- o el trigger del ajuste a mano. Es lo unico que decide por encima
       -- del recuento.
       AND l.excluded_at IS NULL
       AND (
         NOT p_partial
         -- CAMBIO 10/09: en modo parcial, `needs_review` NUNCA entra sola.
         -- Con motivo puesto por una persona, sí: el motivo ES la decisión.
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
$function$
;

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

  IF NOT belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'close_inventory_count: sin acceso a la cuenta %', v_account_id;
  END IF;

  IF NOT public.can_operate_manual_count(p_count_id) THEN
    RAISE EXCEPTION 'close_inventory_count: este inventario está asignado a otra persona';
  END IF;

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
  -- es merma del período: variación económica 0 y dentro de tolerancia. Aquí el
  -- 0 SÍ es un cero de verdad —«esto no vale nada porque no es una pérdida»—,
  -- no un «no lo sé» disfrazado. Por eso este se queda.
  UPDATE public.inventory_count_line l
  SET variance_value = 0,
      within_tolerance = true
  WHERE l.inventory_count_id = p_count_id
    AND l.counted_qty IS NOT NULL
    AND COALESCE(l.system_qty, 0) < 0;

  -- ── LA APERTURA NO CALCULA DIFERENCIAS (10/09, noche) ─────────────────
  --
  -- Un inventario de apertura FIJA el stock: el teórico de antes no es una
  -- referencia, es un número que ya sabemos malo. Restarle lo contado no da
  -- una merma, da una resta sin significado — y en el packaging esa resta
  -- son 28.800 € que nadie ha perdido.
  --
  -- NULL Y NO CERO, por la regla que ya costó un incidente: cero afirma «no
  -- ha habido diferencia» y NULL dice «no había con qué compararlo». Aquí lo
  -- segundo es lo cierto.
  --
  -- VA EL ÚLTIMO A PROPÓSITO: el saneamiento de arriba escribe
  -- `variance_value = 0` cuando el teórico estaba en negativo, y el packaging
  -- tiene mucho teórico en negativo. Si esto fuera antes, ese cero lo pisaría.
  --
  -- `variance_qty` TAMBIÉN. Julio nombró tres columnas; ésta es la cuarta y la
  -- añado a propósito: es la diferencia en unidades, y dejarla viva permitiría
  -- que una pantalla o una exportación escribiera «−125.000 ud» debajo de un
  -- inventario que dice no tener diferencias. Queda dicho para que se pueda
  -- deshacer si se quiere conservar el dato en bruto.
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
    -- SUM ignora los NULL: el total es el de lo que SÍ se sabe valorar. Lo que
    -- no, se cuenta aparte en la pantalla, con su nombre.
    COALESCE(SUM(variance_value) FILTER (WHERE counted_qty IS NOT NULL), 0)
  FROM public.inventory_count_line
  WHERE inventory_count_id = p_count_id;
END;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.cron_autoclose_daily_counts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_applied integer;
  v_errores integer := 0;
begin
  for r in
    select ic.id, ic.code, ic.account_id, ic.status
      from public.inventory_count ic
     where ic.kind = 'cycle'
       and ic.status in ('abierto','contando','en_revision')
       and exists (
         select 1 from public.inventory_count_line l
          where l.inventory_count_id = ic.id and l.counted_qty is not null)
       -- margen: no tocar lo que se esta contando ahora mismo
       and coalesce(ic.closed_at, ic.started_at, ic.created_at) < now() - interval '2 hours'
  loop
    begin
      if r.status in ('abierto','contando') then
        perform public.close_inventory_count(r.id);
      end if;

      select adjustments into v_applied
        from public.apply_inventory_count(r.id, null, 'Autocierre programado', true);

      raise notice 'cron_autoclose_daily_counts: % asentado (% ajustes)', r.code, v_applied;
    exception when others then
      -- NUNCA silencioso: se registra y se sigue con los demas.
      v_errores := v_errores + 1;
      raise warning 'cron_autoclose_daily_counts: fallo en % : %', r.code, sqlerrm;
    end;
  end loop;

  if v_errores > 0 then
    raise warning 'cron_autoclose_daily_counts: % conteos fallaron', v_errores;
  end if;
end;
$function$
;

drop procedure public.autoconteo_cierre_nocturno(boolean);
drop function public.autoconteo_vigia();
drop function public.autoconteos_sin_aplicar(uuid);
drop function public._autoconteo_aplicar(uuid, text, uuid, text);
drop function public._apply_inventory_count_core(uuid, uuid, text, boolean);
drop function public._close_inventory_count_core(uuid);

alter table public.inventory_count
  drop column auto_applied_via,
  drop column auto_apply_error,
  drop column auto_apply_failed_at;
