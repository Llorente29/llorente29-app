-- 20260910091500_conteo_p4_save_count_line.sql
--
-- CONTAR POR FORMATOS · PASO 4 (§2.2 + §2.3) — LA ÚNICA PUERTA DE ESCRITURA
--
-- A partir de aquí, un conteo se guarda por aquí o no se guarda. El móvil manda
-- CÓMO se contó (dos bolsas, 750 g, media bolsa a ojo) y el servidor decide
-- CUÁNTO es. Antes lo decidía el móvil: multiplicaba por el formato elegido y
-- escribía `counted_qty` con un UPDATE directo. Con eso, la conversión vivía en
-- el cliente y el rastro de cómo se contó no vivía en ningún sitio.
--
-- EL FRENO ES A CIEGAS, Y ESO NO ES UN DETALLE DE ESTILO. La respuesta al móvil
-- NO lleva nunca la cantidad esperada, ni dentro del mensaje, ni de rebote en
-- un porcentaje del que se pueda despejar. Quien cuenta no debe poder deducir
-- lo que Folvy espera: en el momento en que lo deduce, deja de contar y empieza
-- a confirmar. El veredicto es una palabra: 'ok' o 'recount'.
--
-- DOS REFERENCIAS, NO UNA:
--   (a) el teórico VIVO del ledger — caza el error de magnitud (un cero de más);
--   (b) el ÚLTIMO RECUENTO APROBADO del mismo artículo y local, más lo que se
--       ha movido desde entonces sin contar los movimientos de inventario.
--       Ésta es la que faltaba, y es la que habría parado el peperoni: Natacha
--       puso 0 kg donde Pamela había contado 9 kg el día antes, sin una sola
--       entrada de por medio. Contra el teórico vivo aquello podía pasar por
--       normal; contra el recuento anterior, no.
--
-- ═════════════════════════════════════════════════════════════════════════
-- CONTRADICCIÓN DEL ENCARGO, Y CÓMO SE RESUELVE (§5: si el RECON contradice,
-- el RECON manda y se cuenta)
--
-- §4.3 pide que «25» en un artículo en gramos con 35 kg esperados devuelva
-- `recount`. Pero §2.3 también manda hacer SIMÉTRICO el disparador de cordura,
-- y con el factor de hoy (1.000) ese mismo 25 cae por debajo de 35.000/1.000 =
-- 35: el disparador lo RECHAZARÍA con excepción antes de que nadie pudiera
-- devolver un veredicto. Los dos puntos del mismo encargo piden cosas
-- incompatibles sobre el mismo número.
--
-- Se resuelve por el orden, no bajando ninguno de los dos:
--   1. El freno se evalúa ANTES de escribir. Si sale `recount`, la línea NO se
--      sella: se guardan las entradas del intento (no se pierde lo que tecleó)
--      y `counted_qty` sigue como estaba. Nada llega al disparador, y el móvil
--      recibe la palabra `recount`, que es lo que pide §4.3.
--   2. El disparador simétrico queda para el SEGUNDO guardado y para cualquier
--      escritura que no pase por esta puerta. Es la red, no el freno — que es
--      literalmente lo que dice §2.3.
-- Y encaja con la maqueta: la pantalla 3 enseña las casillas VACÍAS. No las
-- enseña vacías por estética; las enseña vacías porque ese recuento aún no está.
-- ═════════════════════════════════════════════════════════════════════════
--
-- Y FRENA UNA VEZ, NO DOS. El segundo guardado se acepta siempre: si repite
-- (±5 %) queda sellado como confirmado dos veces; si no, queda `needs_review` y
-- no se aplica solo. Un freno que no se puede pasar no protege el dato: enseña
-- a quien cuenta a teclear lo que el sistema quiera oír.

BEGIN;

-- REGLA 2 (27/08, siete vigías mudos): añadir un parámetro a una función es
-- DROP + CREATE, nunca CREATE OR REPLACE — replace no reemplaza, crea una
-- SOBRECARGA, y a partir de ahí las llamadas son ambiguas (ERROR 42725).
-- Aquí la función nace en esta migración, así que no hay nada que tirar; el
-- DROP está igualmente, para que una reaplicación después de haberle tocado
-- la firma no deje dos vivas.
DROP FUNCTION IF EXISTS public.save_count_line(uuid, jsonb);
DROP FUNCTION IF EXISTS public.save_count_line(uuid, jsonb, numeric);

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
      IF v_fraction IS NULL OR v_fraction <= 0 OR v_fraction >= 1 THEN
        RAISE EXCEPTION 'save_count_line: una fracción a ojo va entre 0 y 1 (¼, ½, ¾), no %', v_fraction;
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

  IF NOT v_segundo THEN
    -- (a) teórico vivo del ledger
    v_teorico := public.theoretical_qty_at(v_item_id, v_location_id, now());
    IF v_teorico IS NOT NULL AND v_teorico > 0 THEN
      IF v_total >= v_teorico * v_factor OR v_total <= v_teorico / v_factor THEN
        v_veredicto := 'recount';
      END IF;
    END IF;

    -- (b) último recuento APROBADO + lo movido desde entonces
    IF v_veredicto = 'ok' THEN
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

      -- Sin entradas de por medio, apartarse del recuento anterior es una
      -- contradicción, no deriva. Con entradas, este freno se calla: el stock
      -- ha cambiado por una razón conocida.
      IF v_ref_qty IS NOT NULL AND NOT v_hubo_entrada AND v_ref_qty > 0 THEN
        IF abs(v_total - v_ref_qty) / v_ref_qty * 100 >= v_contra_pct THEN
          v_veredicto := 'recount';
        END IF;
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
    UPDATE public.inventory_count_line
       SET counted_qty              = v_total,
           counted_at               = now(),
           counted_by               = COALESCE(v_actor_emp, counted_by),
           counted_by_name          = COALESCE(v_actor_name, counted_by_name),
           counted_qty_confirmed    = CASE WHEN v_confirmado OR v_forzado THEN v_total ELSE NULL END,
           counted_qty_confirmed_at = CASE WHEN v_confirmado OR v_forzado THEN now() ELSE NULL END,
           needs_review             = v_revisar
     WHERE id = p_line_id;
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
    'needs_review', v_revisar
  );
END;
$function$;

-- ── Nace privada (§5) ─────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_count_line(uuid, jsonb, numeric) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- clear_count_line · borrar lo contado, que NO es contar cero
-- ═════════════════════════════════════════════════════════════════════════
--
-- Es una función aparte y no «mandar un array vacío» a propósito. Un array
-- vacío es justo lo que llega cuando el front se equivoca —un estado sin
-- inicializar, un formulario que se limpia solo—, y si eso significara «no hay
-- nada» estaríamos escribiendo ceros por accidente en el libro de stock. Aquí
-- hay que decirlo con el nombre: `clear_count_line` deja la línea SIN CONTAR,
-- que es otra cosa que contar cero.
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

  UPDATE public.inventory_count_line
     SET counted_qty              = NULL,
         counted_at               = NULL,
         counted_qty_confirmed    = NULL,
         counted_qty_confirmed_at = NULL,
         needs_review             = false,
         recount_asked_at         = NULL
   WHERE id = p_line_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_count_line(uuid) TO authenticated;

COMMENT ON FUNCTION public.clear_count_line(uuid) IS
  'Deja la línea SIN CONTAR (no en cero) y borra sus entradas. Para contar cero '
  'está save_count_line con method = cero (§2.2, 10/09/2026).';

COMMENT ON FUNCTION public.save_count_line(uuid, jsonb, numeric) IS
  'ÚNICA puerta de escritura de un conteo. Guarda las entradas del intento, '
  'suma en servidor y devuelve un veredicto a ciegas (ok/recount) que NUNCA '
  'contiene la cantidad esperada (§2.2/§2.3, 10/09/2026).';

COMMIT;
