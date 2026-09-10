-- 20260910210000_conteo_p13_apertura.sql
--
-- EL INVENTARIO DE APERTURA, ENTERO (§1 del parte del 10/09 por la noche)
--
-- `is_opening` ya existía y ya hacía DOS de las tres cosas: `apply_inventory_count`
-- escribe el movimiento como `apertura` con la nota «Inventario de apertura
-- (stock inicial)», y se salta la exigencia de motivo. No hacía falta inventar
-- un `kind` nuevo. Faltaba la tercera, y dos que se vieron al buscar quién lee
-- estas columnas.
--
-- 1 · `close_inventory_count` no calcula diferencias en una apertura.
-- 2 · `save_count_line` apaga sus DOS frenos: comparan con el teórico vivo y
--     con el último recuento aprobado, y en una apertura los dos son cifras que
--     ya sabemos falsas. La red de cordura (FV001) NO se apaga.
-- 3 · `_generate_daily_count_core` dejaba que un NULL se leyera como «el último
--     recuento cuadró». Eso es justo lo que no puede pasar.
--
-- QUIÉN MÁS LEE ESTAS COLUMNAS, Y POR QUÉ NO SE TOCA:
--
--   · `_autoinventory_queue_core` hace `SUM(ABS(COALESCE(variance_value,0)))`
--     para puntuar riesgo. Dentro de un SUM, COALESCE a 0 y no sumar son la
--     MISMA cosa: la apertura no aporta riesgo, que es la verdad. Se queda.
--   · `apply_inventory_count` y `autoclose_daily_count` leen `within_tolerance`
--     con `= false` estricto. Un NULL no es `false`, así que no cuenta como
--     línea a revisar. Correcto sin tocar nada.
--   · En el front: `countApprovalService` ya suma con `?? 0` Y cuenta aparte
--     las NULL (`reviewWithoutCost`), que es el patrón honesto; `InventoryCountSheet`
--     filtra con `withinTolerance === false` estricto. `AvtSection` suma con
--     `?? 0`: una apertura no suma al AvT, que es lo que queremos.

BEGIN;

CREATE OR REPLACE FUNCTION public.close_inventory_count(p_count_id uuid)
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
$function$;

CREATE OR REPLACE FUNCTION public.save_count_line(
  p_line_id uuid,
  p_entries jsonb,
  -- Confirmación EXPRESA de una cantidad que la red de cordura había
  -- rechazado. Vale para ESE total y sólo para ése: el servidor exige que
  -- coincida exactamente con lo que suman las entradas, así que no se puede
  -- heredar de un intento anterior ni mandarla «por si acaso».
  p_confirm numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id   uuid;
  v_count_id     uuid;
  v_location_id  uuid;
  v_item_id      uuid;
  v_status       text;
  v_ya_pedido    timestamptz;
  v_anterior     numeric;

  v_actor        uuid := auth.uid();
  v_actor_emp    uuid;
  v_actor_name   text;

  v_total        numeric := 0;
  v_e            jsonb;
  v_method       text;
  v_format_id    uuid;
  v_qty          numeric;
  v_fraction     numeric;
  v_fmt_base     numeric;
  v_base         numeric;
  v_n            integer := 0;
  v_a_ojo        boolean := false;
  v_intento      smallint;

  v_factor       numeric;
  v_contra_pct   numeric;
  v_repeat_pct   numeric;

  v_teorico      numeric;
  v_ref_qty      numeric;
  v_hubo_entrada boolean := false;
  v_sin_ref      boolean := false;
  v_apertura     boolean := false;

  v_veredicto    text := 'ok';
  v_confirmado   boolean := false;
  v_forzado      boolean := false;
  v_revisar      boolean := false;
  v_segundo      boolean;

  -- Lo que va a la tabla de entradas, ya convertido, antes de decidir nada.
  v_conv         jsonb := '[]'::jsonb;
BEGIN
  -- ── Quién y qué ─────────────────────────────────────────────────────────
  SELECT l.account_id, l.inventory_count_id, l.recipe_item_id, l.counted_qty,
         l.recount_asked_at, ic.location_id, ic.status, COALESCE(ic.is_opening, false)
    INTO v_account_id, v_count_id, v_item_id, v_anterior,
         v_ya_pedido, v_location_id, v_status, v_apertura
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.id = p_line_id
   FOR UPDATE OF l;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'save_count_line: la línea % no existe', p_line_id;
  END IF;
  IF NOT public.belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'save_count_line: sin acceso a la cuenta';
  END IF;
  IF v_status IN ('aprobado', 'anulado') THEN
    RAISE EXCEPTION 'save_count_line: el recuento está % y ya no se puede tocar', v_status;
  END IF;

  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'save_count_line: hay que mandar al menos una entrada. Un campo vacío no es un cero: para decir que no queda nada, manda una entrada con method = cero.';
  END IF;

  -- Nombre real de quien cuenta, para que la pantalla de aprobación pueda
  -- decir «Natacha · 20:39» y no «alguien».
  SELECT up.employee_id, e.name
    INTO v_actor_emp, v_actor_name
    FROM public.user_profiles up
    LEFT JOIN public.employees e ON e.id = up.employee_id
   WHERE up.user_id = v_actor AND up.account_id = v_account_id
   LIMIT 1;

  v_segundo := v_ya_pedido IS NOT NULL;
  v_intento := CASE WHEN v_segundo THEN 2 ELSE 1 END;

  -- ── Las entradas: el servidor convierte, el móvil no ────────────────────
  FOR v_e IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    v_method    := v_e->>'method';
    v_format_id := NULLIF(v_e->>'format_id','')::uuid;
    v_qty       := NULLIF(v_e->>'qty','')::numeric;
    v_fraction  := NULLIF(v_e->>'fraction','')::numeric;
    v_fmt_base  := NULL;

    IF v_method IS NULL OR v_method NOT IN ('formato','peso','fraccion','cero') THEN
      RAISE EXCEPTION 'save_count_line: método «%» desconocido', coalesce(v_method,'(vacío)');
    END IF;

    IF v_method IN ('formato','fraccion') THEN
      -- Regla 9: el formato se ancla por id Y por cuenta Y por artículo. Un
      -- formato de otro artículo (o de la cuenta plantilla, que comparte
      -- NOMBRES con producción) multiplicaría por el peso de otra ficha.
      SELECT f.qty_in_base INTO v_fmt_base
        FROM public.recipe_item_purchase_format f
       WHERE f.id = v_format_id
         AND f.account_id = v_account_id
         AND f.item_id    = v_item_id;
      IF v_fmt_base IS NULL THEN
        RAISE EXCEPTION 'save_count_line: el formato % no es de este artículo', v_format_id;
      END IF;
      IF v_fmt_base <= 0 THEN
        RAISE EXCEPTION 'save_count_line: el formato % no tiene contenido. No se puede contar con él', v_format_id;
      END IF;
    END IF;

    IF v_method = 'fraccion' THEN
      -- Puede pasar de 1: «Otra · + bolsa» de la pantalla 2 sirve para decir
      -- que hay dos bolsas abiertas y media. Sigue siendo A OJO, y eso es lo
      -- que hace que salga marcada en la aprobación.
      IF v_fraction IS NULL OR v_fraction <= 0 THEN
        RAISE EXCEPTION 'save_count_line: una cantidad a ojo tiene que ser mayor que cero, no %', v_fraction;
      END IF;
      v_a_ojo := true;
    END IF;

    v_base := CASE v_method
      WHEN 'formato'  THEN v_qty * v_fmt_base
      WHEN 'fraccion' THEN v_fraction * v_fmt_base
      WHEN 'peso'     THEN v_qty
      WHEN 'cero'     THEN 0
    END;

    IF v_base IS NULL OR v_base < 0 THEN
      RAISE EXCEPTION 'save_count_line: cantidad no válida en una entrada de tipo %', v_method;
    END IF;

    v_conv := v_conv || jsonb_build_object(
      'method', v_method, 'format_id', v_format_id,
      'qty', v_qty, 'fraction', v_fraction, 'base', v_base);

    v_total := v_total + v_base;
    v_n := v_n + 1;
  END LOOP;

  -- ── El freno, contra dos referencias, sin devolver ninguna ──────────────
  SELECT COALESCE(count_recount_factor, 3),
         COALESCE(count_contradiction_pct, 40),
         COALESCE(count_repeat_tolerance_pct, 5)
    INTO v_factor, v_contra_pct, v_repeat_pct
    FROM public.supply_settings WHERE account_id = v_account_id;
  v_factor     := COALESCE(v_factor, 3);
  v_contra_pct := COALESCE(v_contra_pct, 40);
  v_repeat_pct := COALESCE(v_repeat_pct, 5);

  -- (a) teórico vivo del ledger
  v_teorico := public.theoretical_qty_at(v_item_id, v_location_id, now());

  -- (b) último recuento APROBADO + lo movido desde entonces
  --
  -- LAS DOS SE MIRAN SIEMPRE, aunque el freno no llegue a usarlas. Antes la (b)
  -- sólo se calculaba si la (a) no había frenado ya; ahora se calcula igual y
  -- se APLICA en las mismas condiciones que antes, para poder responder a una
  -- pregunta que el freno no contestaba: ¿tenía Folvy con qué comparar?
  SELECT ref.qty, ref.entradas
    INTO v_ref_qty, v_hubo_entrada
    FROM (
      SELECT prev.counted_qty + COALESCE((
               SELECT SUM(sm.qty_base) FROM public.stock_movement sm
                WHERE sm.recipe_item_id = v_item_id
                  AND sm.location_id    = v_location_id
                  AND sm.source_type   <> 'inventory_count'
                  AND sm.occurred_at    > prev.counted_at
             ), 0) AS qty,
             COALESCE((
               -- «Recepciones» en el sentido del encargo: mercancía que
               -- ENTRA por una razón registrada. Un ajuste manual no cuenta:
               -- si el stock subió porque alguien lo corrigió a mano, la
               -- pregunta «¿seguro?» sigue mereciendo hacerse.
               SELECT bool_or(true) FROM public.stock_movement sm
                WHERE sm.recipe_item_id = v_item_id
                  AND sm.location_id    = v_location_id
                  AND sm.occurred_at    > prev.counted_at
                  AND (sm.source_type = 'goods_receipt_line'
                       OR sm.movement_type IN ('recepcion','traspaso_entrada','apertura'))
             ), false) AS entradas
        FROM public.inventory_count_line prev
        JOIN public.inventory_count pic ON pic.id = prev.inventory_count_id
       WHERE prev.recipe_item_id = v_item_id
         AND prev.account_id     = v_account_id
         AND pic.location_id     = v_location_id
         AND pic.status          = 'aprobado'
         AND prev.counted_qty IS NOT NULL
         AND prev.counted_at  IS NOT NULL
         AND prev.id <> p_line_id
       ORDER BY prev.counted_at DESC
       LIMIT 1
    ) ref;

  -- ¿TENÍA FOLVY CON QUÉ COMPARAR? Ninguno de los dos frenos puede correr si su
  -- referencia no es un número positivo: el (a) exige `v_teorico > 0` y el (b)
  -- `v_ref_qty > 0`. Cuando las dos fallan —una ficha con el teórico en
  -- negativo, como Humus a −355 g— la línea se guarda SIN QUE NADIE LA MIRE.
  -- No se frena a quien cuenta, que no tiene culpa de la ficha: se marca para
  -- que la aprobación lo sepa.
  --
  -- EN UNA APERTURA NO SE MARCA. «Folvy no tenía referencia» sería cierto en
  -- TODAS las líneas —es la definición de una apertura— y una etiqueta que
  -- sale siempre no informa de nada: sería ruido en la única pantalla donde
  -- hace falta que se lea la que importa.
  v_sin_ref := NOT v_apertura
           AND (v_teorico IS NULL OR v_teorico <= 0)
           AND (v_ref_qty  IS NULL OR v_ref_qty  <= 0);

  IF NOT v_segundo THEN
    -- LOS DOS FRENOS, APAGADOS EN UNA APERTURA (10/09, noche). Comparan con
    -- el teórico vivo y con el último recuento aprobado, y en una apertura
    -- los dos son cifras que YA SABEMOS FALSAS: el teórico de Bolsas
    -- Personalizadas en Alcalá son 149.250 ud. Frenar contra eso mandaría a
    -- recontar media apertura por no parecerse a una mentira.
    --
    -- La red de cordura (FV001, el disparador simétrico) NO se apaga: esa no
    -- compara con nada, caza el cero de más. Y su confirmación expresa sigue
    -- siendo la puerta para pasarla.
    IF NOT v_apertura AND v_teorico IS NOT NULL AND v_teorico > 0 THEN
      IF v_total >= v_teorico * v_factor OR v_total <= v_teorico / v_factor THEN
        v_veredicto := 'recount';
      END IF;
    END IF;

    -- Sin entradas de por medio, apartarse del recuento anterior es una
    -- contradicción, no deriva. Con entradas, este freno se calla: el stock
    -- ha cambiado por una razón conocida.
    IF NOT v_apertura AND v_veredicto = 'ok'
       AND v_ref_qty IS NOT NULL AND NOT v_hubo_entrada AND v_ref_qty > 0 THEN
      IF abs(v_total - v_ref_qty) / v_ref_qty * 100 >= v_contra_pct THEN
        v_veredicto := 'recount';
      END IF;
    END IF;

  ELSE
    -- SEGUNDO GUARDADO: se acepta siempre. Sólo decide cómo queda sellado.
    --
    -- Se compara con el TOTAL DEL PRIMER INTENTO, que está en las entradas, no
    -- con `counted_qty` — que en un `recount` se quedó sin escribir a propósito.
    -- Comparar contra un NULL haría que «lo he mirado bien: es lo que hay»
    -- acabara SIEMPRE en `needs_review`, y entonces «confirmado dos veces» no
    -- existiría nunca: la etiqueta estaría en la pantalla y no podría salir.
    SELECT SUM(qty_in_base) INTO v_anterior
      FROM public.inventory_count_entry
     WHERE line_id = p_line_id AND attempt = v_intento - 1;

    IF v_anterior IS NOT NULL AND (
         (v_anterior = 0 AND v_total = 0)
      OR (v_anterior <> 0 AND abs(v_total - v_anterior) / abs(v_anterior) * 100 <= v_repeat_pct)
    ) THEN
      v_confirmado := true;    -- ha mirado dos veces y le sale lo mismo
    ELSE
      v_revisar := true;       -- sigue sin cuadrar: no se aplica solo
    END IF;
  END IF;

  -- Confirmar a mano una cantidad que la red de cordura había rechazado vale
  -- para los dos intentos: quien la confirma ya ha dicho que la ha mirado. Va
  -- FUERA del if de arriba a propósito — dentro de la primera rama no serviría
  -- de nada en el segundo intento, que es justo donde la red sigue puesta.
  IF p_confirm IS NOT NULL AND p_confirm = v_total THEN
    v_forzado   := true;
    v_veredicto := 'ok';
    v_revisar   := false;
  END IF;

  -- ── Guardar SIEMPRE lo tecleado ─────────────────────────────────────────
  -- El intento se guarda aunque el veredicto sea `recount`: lo que la persona
  -- tecleó es un hecho y no se tira. Lo que no se sella todavía es la línea.
  INSERT INTO public.inventory_count_entry
    (account_id, line_id, format_id, qty, fraction, qty_in_base, method, attempt, counted_by)
  SELECT v_account_id, p_line_id,
         NULLIF(e->>'format_id','')::uuid,
         NULLIF(e->>'qty','')::numeric,
         NULLIF(e->>'fraction','')::numeric,
         (e->>'base')::numeric,
         e->>'method',
         v_intento,
         COALESCE(v_actor_emp, v_actor)
    FROM jsonb_array_elements(v_conv) e;

  IF v_veredicto = 'recount' THEN
    -- No se sella: la línea sigue sin contar y el móvil enseña la pantalla 3
    -- con las casillas vacías. `recount_asked_at` es lo que hace que el
    -- siguiente guardado se acepte sin discusión.
    UPDATE public.inventory_count_line
       SET recount_asked_at = now()
     WHERE id = p_line_id;
  ELSE
    -- EL SELLO DE LA PUERTA (p11, incidente del 10/09). Se pone justo antes
    -- del UPDATE y se quita justo después: la ventana en la que vale es UNA
    -- sentencia. Y lleva el id de la línea, así que no autoriza otra.
    PERFORM set_config('folvy.count_gate', p_line_id::text, true);
    UPDATE public.inventory_count_line
       SET counted_qty              = v_total,
           counted_at               = now(),
           counted_by               = COALESCE(v_actor_emp, counted_by),
           counted_by_name          = COALESCE(v_actor_name, counted_by_name),
           counted_qty_confirmed    = CASE WHEN v_confirmado OR v_forzado THEN v_total ELSE NULL END,
           counted_qty_confirmed_at = CASE WHEN v_confirmado OR v_forzado THEN now() ELSE NULL END,
           needs_review             = v_revisar,
           no_reference             = v_sin_ref
     WHERE id = p_line_id;
    PERFORM set_config('folvy.count_gate', '', true);
  END IF;

  -- LO QUE VUELVE AL MÓVIL. `counted` es lo que ha tecleado la propia persona,
  -- así que devolverlo no le dice nada que no supiera. Lo esperado NO viaja:
  -- ni la cantidad, ni el porcentaje, ni el signo de la diferencia.
  RETURN jsonb_build_object(
    'verdict',      v_veredicto,
    'counted',      v_total,
    'entries',      v_n,
    'attempt',      v_intento,
    'estimated',    v_a_ojo,
    'confirmed',    v_confirmado,
    'needs_review', v_revisar,
    'no_reference', v_sin_ref
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_count_line(uuid, jsonb, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public._generate_daily_count_core(
  p_account_id uuid,
  p_location_id uuid,
  p_employee_ids uuid[] DEFAULT NULL::uuid[],
  p_per_person integer DEFAULT 8,
  p_coverage_target numeric DEFAULT 80,
  p_ignore_freshness boolean DEFAULT false
)
RETURNS TABLE(count_id uuid, lines_created integer, already_existed boolean, coverage_before numeric, coverage_after numeric, per_person_today integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_count_id uuid;
  v_n_people integer;
  v_per_today integer;
  v_cap integer;
  v_total_value numeric;
  v_fresh_before numeric;
  v_cov_before numeric;
  v_cov_after numeric;
  v_created integer := 0;
  v_h_a integer := 3; v_h_b integer := 7; v_h_c integer := 14;
  v_stale_id uuid;
  v_recuentos integer := 0;
BEGIN
  FOR v_stale_id IN
    SELECT id FROM public.inventory_count
    WHERE account_id = p_account_id AND location_id = p_location_id
      AND kind = 'cycle' AND status IN ('abierto','contando')
      AND created_at::date < current_date
  LOOP
    -- EL AUTOCIERRE NO PUEDE TUMBAR LA GENERACION (29/08/2026).
    BEGIN
      PERFORM public.autoclose_daily_count(v_stale_id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._queue_system_alert(
        'autoinventario',
        'Autoinventario: no se pudo autocerrar un conteo rezagado',
        format('Conteo %s del local %s: %s. El conteo de hoy SI se ha generado; '
               'el rezagado sigue abierto y hay que cerrarlo a mano.',
               v_stale_id, p_location_id, sqlerrm),
        'autoinventario_autocierre');
    END;
  END LOOP;

  SELECT id INTO v_existing FROM public.inventory_count
   WHERE account_id = p_account_id AND location_id = p_location_id
     AND kind = 'cycle' AND status <> 'anulado' AND created_at::date = current_date
   ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing,
      (SELECT count(*)::int FROM public.inventory_count_line WHERE inventory_count_id = v_existing),
      true, NULL::numeric, NULL::numeric, NULL::integer;
    RETURN;
  END IF;

  v_n_people := COALESCE(array_length(p_employee_ids, 1), 0);

  WITH sel AS (
    SELECT q.recipe_item_id, q.stock_value, q.abc_rich,
           f.last_approved, f.last_ok,
           ( p_ignore_freshness
             OR f.last_approved IS NULL
             OR NOT f.last_ok
             OR f.last_approved < now() - make_interval(days =>
                  CASE q.abc_rich WHEN 'A' THEN v_h_a WHEN 'B' THEN v_h_b ELSE v_h_c END) ) AS is_stale
    FROM public._autoinventory_queue_core(p_account_id, p_location_id, 30, p_coverage_target) q
    LEFT JOIN (
      SELECT DISTINCT ON (icl.recipe_item_id)
             icl.recipe_item_id,
             ic.approved_at AS last_approved,
             -- UNA APERTURA NO ES PRUEBA DE NADA (10/09, noche). Este
             -- COALESCE convertía un NULL en `true`, o sea en «el último
             -- recuento cuadró», y con la apertura del packaging habría
             -- dicho eso de 59 artículos que nadie ha comprobado nunca.
             -- NULL se propaga: `NOT NULL` es NULL, así que la línea deja de
             -- opinar y la rotación decide por EDAD, que es lo único que una
             -- apertura sí demuestra.
             CASE WHEN COALESCE(ic.is_opening, false) THEN NULL
                  ELSE COALESCE(icl.within_tolerance,
                         (ABS(COALESCE(icl.variance_value,0)) < 5
                          AND ABS(COALESCE(icl.variance_pct,0)) < 3))
             END AS last_ok
      FROM public.inventory_count_line icl
      JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
      WHERE ic.account_id = p_account_id AND ic.location_id = p_location_id AND ic.status = 'aprobado'
      ORDER BY icl.recipe_item_id, ic.approved_at DESC
    ) f ON f.recipe_item_id = q.recipe_item_id
    WHERE q.in_scope
  )
  SELECT COALESCE(SUM(stock_value),0),
         COALESCE(SUM(stock_value) FILTER (WHERE NOT is_stale),0)
    INTO v_total_value, v_fresh_before
  FROM sel;

  v_cov_before := CASE WHEN v_total_value > 0 THEN ROUND(v_fresh_before / v_total_value * 100, 1) ELSE 0 END;

  v_per_today := CASE
    WHEN v_cov_before < 40 THEN CEIL(p_per_person * 1.5)::int
    WHEN v_cov_before <= 75 THEN p_per_person
    ELSE GREATEST(1, FLOOR(p_per_person * 0.5)::int)
  END;
  v_cap := GREATEST(v_per_today, v_n_people * v_per_today);

  CREATE TEMP TABLE _daily_pick ON COMMIT DROP AS
  WITH sel AS (
    SELECT q.recipe_item_id, q.qty_on_hand, q.stock_value, q.abc_rich, q.must_count, q.rank,
           f.last_approved, f.last_ok,
           ( p_ignore_freshness
             OR f.last_approved IS NULL
             OR NOT f.last_ok
             OR f.last_approved < now() - make_interval(days =>
                  CASE q.abc_rich WHEN 'A' THEN v_h_a WHEN 'B' THEN v_h_b ELSE v_h_c END) ) AS is_stale
    FROM public._autoinventory_queue_core(p_account_id, p_location_id, 30, p_coverage_target) q
    LEFT JOIN (
      SELECT DISTINCT ON (icl.recipe_item_id)
             icl.recipe_item_id,
             ic.approved_at AS last_approved,
             -- UNA APERTURA NO ES PRUEBA DE NADA (10/09, noche). Este
             -- COALESCE convertía un NULL en `true`, o sea en «el último
             -- recuento cuadró», y con la apertura del packaging habría
             -- dicho eso de 59 artículos que nadie ha comprobado nunca.
             -- NULL se propaga: `NOT NULL` es NULL, así que la línea deja de
             -- opinar y la rotación decide por EDAD, que es lo único que una
             -- apertura sí demuestra.
             CASE WHEN COALESCE(ic.is_opening, false) THEN NULL
                  ELSE COALESCE(icl.within_tolerance,
                         (ABS(COALESCE(icl.variance_value,0)) < 5
                          AND ABS(COALESCE(icl.variance_pct,0)) < 3))
             END AS last_ok
      FROM public.inventory_count_line icl
      JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
      WHERE ic.account_id = p_account_id AND ic.location_id = p_location_id AND ic.status = 'aprobado'
      ORDER BY icl.recipe_item_id, ic.approved_at DESC
    ) f ON f.recipe_item_id = q.recipe_item_id
    WHERE q.in_scope
  ),
  ranked AS (
    SELECT s.*, ROW_NUMBER() OVER w AS pickn
    FROM sel s
    WHERE s.is_stale
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_count ic2
        JOIN public.inventory_count_line icl2 ON icl2.inventory_count_id = ic2.id
        WHERE ic2.account_id = p_account_id
          AND ic2.location_id = p_location_id
          AND ic2.kind IN ('full','audit')
          AND ic2.status IN ('contando','en_revision')
          AND icl2.recipe_item_id = s.recipe_item_id
      )
    WINDOW w AS (ORDER BY s.must_count DESC, s.stock_value DESC, s.last_approved ASC NULLS FIRST, s.rank ASC)
  )
  SELECT r.recipe_item_id, r.qty_on_hand, r.abc_rich, r.must_count, r.pickn
  FROM ranked r
  WHERE r.must_count = true OR r.pickn <= v_cap;

  SELECT count(*)::int INTO v_created FROM _daily_pick;

  -- ── RECUENTOS PEDIDOS (NUEVO 10/09) ───────────────────────────────────
  -- Peticiones de `request_recount` de este local que aún no tienen línea hija.
  CREATE TEMP TABLE _recount_pick ON COMMIT DROP AS
  SELECT DISTINCT ON (l.recipe_item_id)
         l.id AS origen_id, l.recipe_item_id, l.abc_class, l.recount_assign_to
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.account_id = p_account_id
     AND ic.location_id = p_location_id
     AND l.recount_requested_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.inventory_count_line h WHERE h.recount_of = l.id)
   ORDER BY l.recipe_item_id, l.recount_requested_at DESC;

  SELECT count(*)::int INTO v_recuentos FROM _recount_pick;

  IF v_created = 0 AND v_recuentos = 0 THEN
    DROP TABLE IF EXISTS _daily_pick;
    DROP TABLE IF EXISTS _recount_pick;
    RETURN QUERY SELECT NULL::uuid, 0, false, v_cov_before, v_cov_before, v_per_today;
    RETURN;
  END IF;

  INSERT INTO public.inventory_count(account_id, location_id, kind, status, blind, is_opening, started_at, notes)
  VALUES (p_account_id, p_location_id, 'cycle', 'contando', true, false, now(), 'Autoinventario del día')
  RETURNING id INTO v_count_id;

  -- Los recuentos pedidos van PRIMEROS: posición negativa, para que quien los
  -- vea sepa que alguien los ha pedido a mano y no salgan detrás de la cola.
  INSERT INTO public.inventory_count_line(
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class, assigned_to, recount_of)
  SELECT p_account_id, v_count_id, rp.recipe_item_id, NULL,
         -1000 + (ROW_NUMBER() OVER (ORDER BY rp.recipe_item_id))::int,
         public.theoretical_qty_at(rp.recipe_item_id, p_location_id, now()),
         NULL, rp.abc_class,
         -- Si no se decidió a quién, entra en el round-robin como una más.
         COALESCE(rp.recount_assign_to,
                  CASE WHEN v_n_people > 0
                       THEN p_employee_ids[((ROW_NUMBER() OVER (ORDER BY rp.recipe_item_id))::int - 1) % v_n_people + 1]
                       ELSE NULL END),
         rp.origen_id
    FROM _recount_pick rp;

  INSERT INTO public.inventory_count_line(
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class, assigned_to)
  SELECT p_account_id, v_count_id, p.recipe_item_id, NULL, p.pickn::int,
         COALESCE(p.qty_on_hand, 0), NULL, p.abc_rich,
         CASE WHEN v_n_people > 0 THEN p_employee_ids[((p.pickn - 1) % v_n_people) + 1] ELSE NULL END
  FROM _daily_pick p
  -- Un artículo que ya entra como recuento pedido no entra dos veces.
  WHERE NOT EXISTS (SELECT 1 FROM _recount_pick rp WHERE rp.recipe_item_id = p.recipe_item_id);

  SELECT count(*)::int INTO v_created
    FROM public.inventory_count_line WHERE inventory_count_id = v_count_id;

  SELECT CASE WHEN v_total_value > 0
    THEN ROUND((v_fresh_before + COALESCE(SUM(ric.stock_value),0)) / v_total_value * 100, 1)
    ELSE 100 END
  INTO v_cov_after
  FROM public.inventory_count_line l
  JOIN public.recipe_item_location_stock ric
    ON ric.recipe_item_id = l.recipe_item_id AND ric.account_id = p_account_id AND ric.location_id = p_location_id
  WHERE l.inventory_count_id = v_count_id;
  v_cov_after := COALESCE(v_cov_after, v_cov_before);

  DROP TABLE IF EXISTS _daily_pick;
  DROP TABLE IF EXISTS _recount_pick;

  RETURN QUERY SELECT v_count_id, v_created, false, v_cov_before, v_cov_after, v_per_today;
END;
$function$;
COMMIT;
