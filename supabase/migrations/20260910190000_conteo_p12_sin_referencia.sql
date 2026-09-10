-- 20260910190000_conteo_p12_sin_referencia.sql
--
-- «FOLVY NO TENÍA REFERENCIA» (visto en vivo en INV-00218, 10/09 por la tarde)
--
-- EL AGUJERO. Los dos frenos de `save_count_line` sólo corren si su referencia
-- es un número POSITIVO: el del teórico exige `v_teorico > 0`, el de la
-- contradicción exige `v_ref_qty > 0`. Cuando las dos fallan, la línea se
-- guarda sin que nadie la mire — y el caso en que fallan es justo el peor: una
-- ficha rota. Humus entró con 1.000 g contra un teórico de −355 g y no saltó
-- nada. Lima igual.
--
-- LO QUE SE HACE, Y LO QUE NO. NO se frena a quien cuenta: no tiene culpa de la
-- ficha, y pararle delante de la cámara para decirle que Folvy no sabe lo que
-- debería haber es echarle a él un problema que es nuestro. Lo que se hace es
-- MARCAR la línea, para que la aprobación lo diga con todas las letras.
--
-- Es la regla 7 otra vez, por el lado bueno: el umbral no decide la existencia
-- de la fila, decide su etiqueta. Aquí se añade etiqueta, no se quita fila.
--
-- POR QUÉ `<= 0` Y NO `< 0`. Un teórico en CERO tampoco frena —el `> 0` lo deja
-- fuera igual que al negativo—, así que la BBDD guarda la verdad entera: «no
-- había con qué comparar». Quién de esas líneas merece que le miren es una
-- decisión de pantalla, y se toma en pantalla: contar cero contra un teórico
-- de cero no le hace perder el tiempo a nadie, así que sale ETIQUETADA pero no
-- va al grupo de revisar. Contar 1.000 sin referencia, sí.

BEGIN;

ALTER TABLE public.inventory_count_line
  ADD COLUMN IF NOT EXISTS no_reference boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventory_count_line.no_reference IS
  'true cuando al guardar no había NINGUNA referencia positiva con la que '
  'comparar: ni teórico vivo (> 0) ni último recuento aprobado (> 0). La línea '
  'se guardó sin que ningún freno pudiera mirarla. Lo pone save_count_line '
  '(10/09/2026); no frena a nadie, marca para la aprobación.';

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
         l.recount_asked_at, ic.location_id, ic.status
    INTO v_account_id, v_count_id, v_item_id, v_anterior,
         v_ya_pedido, v_location_id, v_status
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
  v_sin_ref := (v_teorico IS NULL OR v_teorico <= 0)
           AND (v_ref_qty  IS NULL OR v_ref_qty  <= 0);

  IF NOT v_segundo THEN
    IF v_teorico IS NOT NULL AND v_teorico > 0 THEN
      IF v_total >= v_teorico * v_factor OR v_total <= v_teorico / v_factor THEN
        v_veredicto := 'recount';
      END IF;
    END IF;

    -- Sin entradas de por medio, apartarse del recuento anterior es una
    -- contradicción, no deriva. Con entradas, este freno se calla: el stock
    -- ha cambiado por una razón conocida.
    IF v_veredicto = 'ok'
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

CREATE OR REPLACE FUNCTION public.clear_count_line(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_status text;
BEGIN
  SELECT l.account_id, ic.status INTO v_account_id, v_status
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.id = p_line_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'clear_count_line: la línea % no existe', p_line_id;
  END IF;
  IF NOT public.belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'clear_count_line: sin acceso a la cuenta';
  END IF;
  IF v_status IN ('aprobado', 'anulado') THEN
    RAISE EXCEPTION 'clear_count_line: el recuento está % y ya no se puede tocar', v_status;
  END IF;

  DELETE FROM public.inventory_count_entry WHERE line_id = p_line_id;

  -- El sello, sólo alrededor del UPDATE.
  PERFORM set_config('folvy.count_gate', p_line_id::text, true);
  UPDATE public.inventory_count_line
     SET counted_qty              = NULL,
         counted_at               = NULL,
         counted_qty_confirmed    = NULL,
         counted_qty_confirmed_at = NULL,
         needs_review             = false,
         recount_asked_at         = NULL,
         no_reference             = false
   WHERE id = p_line_id;
  PERFORM set_config('folvy.count_gate', '', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_count_line(uuid) TO authenticated;

COMMIT;
