-- 20260825T1000_inventory_system_qty_desde_ledger.sql
-- PROPUESTA (NO EJECUTADA). Claude Code propone; Julio ejecuta y verifica.
--
-- BUG: MERMA FALSA EN TODO CONTEO QUE DURE MÁS DE UNOS MINUTOS
-- ------------------------------------------------------------------------
-- Hoy conviven dos verdades distintas sobre el "teórico" de una línea:
--
--   * build_inventory_count()  congela system_qty al CREAR el conteo, y lo
--     copia de recipe_item_location_stock.qty_on_hand (una materialización
--     que además puede ir atrasada respecto al ledger).
--   * close_inventory_count()  calcula variance = counted_qty - system_qty,
--     o sea contra la foto de las 09:30 aunque la línea se contara a las 21:11.
--   * apply_inventory_count()  YA hace lo correcto desde 20260801T1300: corta
--     el ledger en COALESCE(counted_at, instante del conteo) y asienta
--     delta = counted_qty - SUM(qty_base con occurred_at < ese corte).
--
-- Resultado: el AJUSTE de stock es correcto, pero el INFORME de merma miente.
-- Todo lo vendido entre la creación del conteo y el momento de contar cada
-- línea se imputa como merma/sobre-porción de esa línea.
--
-- Evidencia medida en producción (INV-00181, Alcalá, 24-08-2026; líneas
-- creadas 09:30, contadas 14:03-21:13):
--   Pan Hamburguesa   system 140 vs ledger-en-counted_at 137 → -20 informado vs -17 real
--   Tequeños          system 118 vs 98                       → -33 informado vs -13 real
--   Queso Mozarela    system 3500 vs 3370                    → -1500 informado vs -1370 real
--   Cilantro          system -4,4542 vs -8,1585 → el ajuste REALMENTE asentado
--                     por apply fue +8,1585 y el informe dice +4,4542. Las dos
--                     cifras del mismo conteo ya no cuadran entre sí.
--
-- CORRECCIÓN: system_qty deja de ser una foto y pasa a reconstruirse SIEMPRE
-- desde el ledger, con el corte en el instante en que se contó ESA línea.
-- Se recalcula AL CERRAR (no al teclear la cantidad) porque el ledger llega
-- con retraso: el motor de consumo asienta las ventas ~2 h después de que
-- ocurren (medido: occurred_at 20:19:58 → created_at 21:01:53, y casos de
-- 8 h). Congelar en el momento de teclear dejaría fuera las ventas de las
-- últimas horas y volvería a inventar merma. Al cerrar, el ledger ya está
-- casi completo; y como close_inventory_count es idempotente sobre
-- 'en_revision', el gestor puede volver a cerrarlo para refrescar el teórico
-- antes de aprobar.
--
-- El corte es ESTRICTO (occurred_at < corte), idéntico al de
-- apply_inventory_count, por dos motivos: (a) informe y asiento tienen que
-- dar el mismo número; (b) el propio ajuste del conteo se asienta con
-- occurred_at = counted_at, así que el corte estricto lo excluye y volver a
-- cerrar un conteo ya aplicado en parcial no se cuenta dos veces.
--
-- PIEZAS
--   1) theoretical_qty_at()        helper único: saldo teórico en un instante.
--   2) rebase_count_system_qty()   reconstruye system_qty de todas las líneas.
--   3) close_inventory_count()     llama a (2) antes de calcular variaciones.
--   4) build_inventory_count()     siembra system_qty desde el ledger, no
--                                  desde qty_on_hand (que va atrasado: medido
--                                  Crispy Wings qty_on_hand 0 vs ledger -250).
--   5) check_count_variance()      el aviso blind (±3x) juzga contra el ledger
--                                  vivo, no contra la foto de la mañana.
--
-- Bodies (3),(4),(5) = copia literal de pg_get_functiondef del vivo
-- (verificado hoy) con SOLO los cambios marcados con "CAMBIO 20260825".
--
-- NO toca stock_movement. No cambia ningún ajuste ya aplicado.
-- El histórico se repara aparte: 20260825T1100_backfill_variance_historico.sql

begin;

-- ── (1) Helper: saldo teórico de un artículo en un local en un instante ────
-- Fuente de verdad = ledger. Corte ESTRICTO (< p_at), igual que apply.
-- Usa el índice existente idx_sm_item_loc_time (recipe_item_id, location_id,
-- occurred_at). SECURITY DEFINER porque lo llaman funciones definer que ya
-- han validado el acceso; se revoca a los roles públicos para que nadie
-- pueda sondear stock de otra cuenta llamándola suelta desde PostgREST.
CREATE OR REPLACE FUNCTION public.theoretical_qty_at(
  p_recipe_item_id uuid,
  p_location_id uuid,
  p_at timestamptz
)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT SUM(sm.qty_base)
      FROM public.stock_movement sm
     WHERE sm.recipe_item_id = p_recipe_item_id
       AND sm.location_id    = p_location_id
       AND sm.occurred_at    < p_at
  ), 0)::numeric;
$function$;

REVOKE ALL ON FUNCTION public.theoretical_qty_at(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.theoretical_qty_at(uuid, uuid, timestamptz) FROM anon, authenticated;

-- ── (2) Reconstruir system_qty de un conteo entero desde el ledger ─────────
-- Cada línea con su propio corte: COALESCE(counted_at, instante del conteo).
-- El fallback es el mismo que usa apply para líneas sin sello (autoinventario
-- antiguo, históricos) → comportamiento idéntico al de hoy en esas líneas.
CREATE OR REPLACE FUNCTION public.rebase_count_system_qty(p_count_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_location_id uuid;
  v_instant timestamptz;
  v_n integer := 0;
BEGIN
  SELECT location_id, COALESCE(started_at, closed_at, created_at, now())
    INTO v_location_id, v_instant
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'rebase_count_system_qty: conteo % no existe', p_count_id;
  END IF;

  UPDATE public.inventory_count_line l
     SET system_qty = public.theoretical_qty_at(
                        l.recipe_item_id,
                        v_location_id,
                        COALESCE(l.counted_at, v_instant))
   WHERE l.inventory_count_id = p_count_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.rebase_count_system_qty(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rebase_count_system_qty(uuid) FROM anon, authenticated;

-- ── (3) close_inventory_count ─────────────────────────────────────────────
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

  -- CAMBIO 20260825: el teórico deja de ser la foto congelada al crear el
  -- conteo. Se reconstruye desde el ledger con el corte en el counted_at de
  -- CADA línea, exactamente igual que hace apply_inventory_count al asentar.
  -- Sin esto, todo lo vendido entre la creación del conteo y el momento de
  -- contar cada línea se informa como merma.
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

-- ── (4) build_inventory_count ─────────────────────────────────────────────
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
    -- CAMBIO 20260825: siembra desde el LEDGER, no desde qty_on_hand. La
    -- materialización va atrasada (medido: Crispy Wings qty_on_hand 0 con
    -- ledger -250) y esa foto es la que veía el aviso blind del contador.
    -- Da igual para el informe final (close vuelve a reconstruirlo), pero
    -- así el arranque y el cierre hablan de lo mismo.
    public.theoretical_qty_at(ri.id, v_location_id, now()),
    NULL,
    -- La clasificación ABC sigue midiéndose por VALOR de stock con la
    -- materialización (que es donde vive avg_unit_cost). No es dinero de
    -- merma, solo prioridad de recuento.
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

-- ── (5) check_count_variance ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_count_variance(p_line_id uuid, p_counted numeric)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_system numeric;
  v_item_id uuid;
  v_location_id uuid;
BEGIN
  -- CAMBIO 20260825: el veredicto blind se juzga contra el teórico VIVO del
  -- ledger, no contra la foto congelada al crear el conteo (que en un conteo
  -- de tarde puede llevar 12 h de ventas de retraso y disparar avisos 'low'
  -- falsos al trabajador).
  SELECT l.account_id, l.recipe_item_id, ic.location_id
    INTO v_account_id, v_item_id, v_location_id
  FROM public.inventory_count_line l
  JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
  WHERE l.id = p_line_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'check_count_variance: línea % no existe', p_line_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR v_account_id = ANY(public.current_user_account_ids())) THEN
    RAISE EXCEPTION 'check_count_variance: sin acceso';
  END IF;

  v_system := public.theoretical_qty_at(v_item_id, v_location_id, now());

  -- Sin dato de sistema (artículo nuevo, stock 0) → no se puede juzgar.
  IF v_system IS NULL OR v_system <= 0 THEN
    RETURN 'ok';
  END IF;

  IF p_counted < v_system / 3.0 THEN
    RETURN 'low';
  ELSIF p_counted > v_system * 3.0 THEN
    RETURN 'high';
  END IF;
  RETURN 'ok';
END;
$function$;

notify pgrst, 'reload schema';

-- Guard de existencia (1ª red; la verdad la da la verificación posterior).
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname='public' and p.proname='theoretical_qty_at') then
    raise exception 'Falta theoretical_qty_at';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname='public' and p.proname='rebase_count_system_qty') then
    raise exception 'Falta rebase_count_system_qty';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname='public' and p.proname='close_inventory_count'
                   and pg_get_functiondef(p.oid) like '%rebase_count_system_qty%') then
    raise exception 'close_inventory_count no reconstruye system_qty';
  end if;
  -- El índice que hace barato el corte por instante ya existe; si alguien lo
  -- borra, el helper pasa a seq-scan sobre stock_movement.
  if not exists (select 1 from pg_indexes
                 where schemaname='public' and tablename='stock_movement'
                   and indexname='idx_sm_item_loc_time') then
    raise exception 'Falta idx_sm_item_loc_time (recipe_item_id, location_id, occurred_at)';
  end if;
end $$;

commit;
