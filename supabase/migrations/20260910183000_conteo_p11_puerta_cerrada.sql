-- 20260910183000_conteo_p11_puerta_cerrada.sql
--
-- LA PUERTA, CERRADA CON LLAVE (incidente del 10/09, 12:34–12:43)
--
-- QUÉ PASÓ. La pantalla nueva se publicó a las 11:39. A las 12:34 un móvil
-- guardó 12 líneas de INV-00218 con la versión VIEJA en caché: un UPDATE
-- directo de `counted_qty`, sin pasar por `save_count_line`. Resultado: 12
-- líneas contadas y CERO filas en `inventory_count_entry`. Sin el cómo se
-- contó, y —lo grave— sin el freno: ni el teórico vivo, ni el recuento
-- anterior, ni el «vuelve a mirarlo».
--
-- LA LECCIÓN, Y ES NUEVA. Haber puesto UNA sola puerta de escritura en el
-- código no cierra la puerta vieja: la deja abierta y sin vigilar. Mientras
-- exista una versión del cliente en el caché de alguien, el UPDATE directo
-- sigue siendo una escritura válida para la BBDD. Una puerta que sólo existe
-- en el front no es una puerta: es una recomendación.
--
-- CÓMO SE CIERRA. `save_count_line` y `clear_count_line` sellan la transacción
-- con el id de la línea que van a tocar, justo antes de su UPDATE, y lo quitan
-- justo después. El disparador exige ese sello para cualquier escritura de
-- `counted_qty`.
--
--   · El sello lleva el ID DE LA LÍNEA, no un «sí» genérico: un sello puesto
--     para una línea no autoriza el UPDATE de otra.
--   · Se pone y se quita alrededor del UPDATE, así que la ventana en la que
--     vale es UNA sentencia, no toda la transacción.
--   · Es `set_config(..., true)`: local a la transacción, se limpia sola.
--
-- LO QUE ESTA PUERTA NO ES. No es una barrera criptográfica. Un cliente que
-- pudiera ejecutar `set_config` a voluntad se la saltaría — pero PostgREST
-- sólo expone funciones del esquema `public`, y `set_config` vive en
-- `pg_catalog`, así que desde el navegador no se puede llamar. Esto para lo
-- que está es para lo que pasó hoy: una app antigua escribiendo por la puerta
-- de atrás sin saberlo. Y de eso protege del todo.
--
-- LA VÁLVULA, DICHA EN VOZ ALTA. Una carga de datos o una migración que
-- necesite tocar `counted_qty` a mano pone el sello 'mantenimiento' en su
-- transacción. Es explícito y ruidoso a propósito: quien lo escriba está
-- diciendo «sé que me salto el freno». Lo que no puede pasar es que se lo
-- salte alguien sin enterarse.

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- El disparador
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tg_count_line_solo_por_la_puerta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sello text;
BEGIN
  -- Crear líneas sin contar es lo normal: `_generate_daily_count_core`,
  -- `build_inventory_count` y `request_recount` insertan con counted_qty NULL.
  IF TG_OP = 'INSERT' AND NEW.counted_qty IS NULL THEN
    RETURN NEW;
  END IF;

  -- Un UPDATE que no toca `counted_qty` no es asunto de esta puerta. Aquí
  -- pasan `close_inventory_count` (variación), `rebase_count_system_qty`
  -- (teórico) y el motivo que pone quien aprueba.
  IF TG_OP = 'UPDATE' AND NEW.counted_qty IS NOT DISTINCT FROM OLD.counted_qty THEN
    RETURN NEW;
  END IF;

  v_sello := current_setting('folvy.count_gate', true);

  IF v_sello = NEW.id::text OR v_sello = 'mantenimiento' THEN
    RETURN NEW;
  END IF;

  -- EL MENSAJE ES PARA QUIEN ESTÁ DE PIE DELANTE DE UNA CÁMARA, no para un
  -- programador: dice qué hacer, no qué ha fallado. El código FV002 es lo que
  -- el front usa para recargarse solo.
  RAISE EXCEPTION
    'Esta versión de Folvy es antigua y ya no puede guardar recuentos. Cierra la aplicación y vuelve a abrirla para actualizarla; lo que hayas contado no se ha perdido, vuelve a apuntarlo cuando se actualice.'
    USING ERRCODE = 'FV002',
          DETAIL  = format('inventory_count_line %s: escritura de counted_qty fuera de save_count_line (op %s).', NEW.id, TG_OP),
          HINT    = 'Toda escritura de counted_qty pasa por save_count_line o clear_count_line (§2.2, incidente del 10/09/2026).';
END;
$function$;

COMMENT ON FUNCTION public.tg_count_line_solo_por_la_puerta() IS
  'Rechaza cualquier escritura de counted_qty que no venga sellada por '
  'save_count_line o clear_count_line. Error FV002, que el front usa para '
  'recargarse. Incidente del 10/09/2026: un móvil con la versión vieja en '
  'caché escribió 12 líneas saltándose el freno.';

-- ORDEN DE LOS DISPARADORES: Postgres los ejecuta por nombre alfabético, y
-- `trg_a_...` va antes que `trg_inventory_count_line_sanity`. Es a propósito:
-- una app vieja tiene que oír «actualízate», no «cantidad fuera de escala».
DROP TRIGGER IF EXISTS trg_a_count_line_solo_por_la_puerta ON public.inventory_count_line;
CREATE TRIGGER trg_a_count_line_solo_por_la_puerta
  BEFORE INSERT OR UPDATE OF counted_qty ON public.inventory_count_line
  FOR EACH ROW EXECUTE FUNCTION public.tg_count_line_solo_por_la_puerta();

-- ═════════════════════════════════════════════════════════════════════════
-- Las dos funciones que tienen llave
-- ═════════════════════════════════════════════════════════════════════════
--
-- Sólo cambia el sello alrededor de sus UPDATE. Lo demás está copiado LETRA A
-- LETRA de la migración p4 del mismo día.

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
         recount_asked_at         = NULL
   WHERE id = p_line_id;
  PERFORM set_config('folvy.count_gate', '', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.clear_count_line(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_count_line(uuid) TO authenticated;

COMMENT ON FUNCTION public.clear_count_line(uuid) IS
  'Deja la línea SIN CONTAR (no en cero) y borra sus entradas. Para contar cero '
  'está save_count_line con method = cero (§2.2, 10/09/2026).';

-- ═════════════════════════════════════════════════════════════════════════
-- save_count_line · la misma de la p4, con el sello alrededor de su UPDATE
-- ═════════════════════════════════════════════════════════════════════════
--
-- Generada DESDE el fichero de la p4, no vuelta a teclear: lo único distinto
-- son las dos líneas de `set_config`. Re-transcribir doscientas líneas a mano
-- para cambiar dos es la forma más fácil de que se cuele un cambio que nadie
-- ha decidido.

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
           needs_review             = v_revisar
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
    'needs_review', v_revisar
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.save_count_line(uuid, jsonb, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_count_line(uuid, jsonb, numeric) TO authenticated;

COMMENT ON FUNCTION public.save_count_line(uuid, jsonb, numeric) IS
  'ÚNICA puerta de escritura de un conteo, y desde el 10/09 la BBDD lo obliga: '
  'sella la transacción con el id de la línea para pasar el disparador '
  'trg_a_count_line_solo_por_la_puerta. Devuelve un veredicto a ciegas '
  '(ok/recount) que NUNCA contiene la cantidad esperada.';

COMMIT;
