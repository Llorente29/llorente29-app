-- 20260910093045_conteo_p5_cordura_simetrica.sql
--
-- CONTAR POR FORMATOS · PASO 5 (§2.3, último punto) — LA RED, POR LOS DOS LADOS
--
-- `tg_inventory_count_line_sanity` sólo miraba hacia arriba: rechazaba contar
-- 1.000 veces más de lo esperado y dejaba pasar cualquier cosa por debajo. Por
-- ahí entraron el Solomillo piri-piri de Carabanchel —«25» gramos contra 35 kg
-- esperados, el 14/08— y el Aceite Alto Oleico —1.000 ml contra 25 L, el 06/09.
-- Los dos son el mismo error: la unidad. Quien escribe 25 está contando cajas,
-- o kilos, en un artículo que va en gramos.
--
-- EL CERO SE QUEDA FUERA DE LA RED, Y A PROPÓSITO. «No queda nada» es una
-- respuesta legítima y frecuente, y contra un teórico positivo cualquier cero
-- cae por debajo de cualquier umbral: una red que lo atrapara haría imposible
-- decir la verdad más común del almacén. Del cero se ocupa el freno de
-- `save_count_line`, que sabe mirar el recuento anterior — que es justamente lo
-- que le faltó al peperoni.
--
-- ESTO ES LA RED, NO EL FRENO. El freno es `save_count_line`: pregunta con
-- suavidad y deja pasar al segundo intento. Esto rechaza y exige confirmación
-- expresa, y sólo se topa con ello quien se ha equivocado de unidad por tres
-- órdenes de magnitud.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_inventory_count_line_sanity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factor  numeric;
  v_cap     numeric;
  v_teorico numeric;
BEGIN
  IF NEW.counted_qty IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.counted_qty IS NOT DISTINCT FROM OLD.counted_qty THEN
    RETURN NEW;
  END IF;

  IF NEW.counted_qty < 0 THEN
    RAISE EXCEPTION 'No se puede contar una cantidad negativa (%). Si el sistema esta en negativo, cuenta lo que hay de verdad: 0 o mas.',
      NEW.counted_qty USING ERRCODE = 'FV001';
  END IF;

  -- Confirmacion explicita: vale SOLO para el valor confirmado.
  IF NEW.counted_qty_confirmed IS NOT NULL
     AND NEW.counted_qty_confirmed = NEW.counted_qty THEN
    NEW.counted_qty_confirmed_at := now();
    RETURN NEW;
  END IF;

  SELECT COALESCE(count_absurd_factor, 1000), COALESCE(count_absurd_abs_cap, 1000000)
    INTO v_factor, v_cap
    FROM public.supply_settings WHERE account_id = NEW.account_id;
  v_factor := COALESCE(v_factor, 1000);
  v_cap    := COALESCE(v_cap, 1000000);

  v_teorico := NEW.system_qty;

  IF v_teorico IS NOT NULL AND v_teorico > 0 THEN
    IF NEW.counted_qty > v_factor * v_teorico THEN
      RAISE EXCEPTION
        'Cantidad fuera de escala: has puesto % y el sistema tiene %. Son % veces mas. Revisa la unidad y las comas; si de verdad has contado eso, confirmalo.',
        trim(to_char(NEW.counted_qty, 'FM999999999999999990.####')),
        trim(to_char(v_teorico,       'FM999999999999999990.####')),
        trim(to_char(round(NEW.counted_qty / v_teorico), 'FM999999999999999990'))
        USING ERRCODE = 'FV001';
    END IF;

    -- ── NUEVO 10/09: la misma red, por debajo ─────────────────────────────
    -- El cero queda fuera: es una respuesta, no un error de dedo.
    IF NEW.counted_qty > 0 AND NEW.counted_qty * v_factor < v_teorico THEN
      RAISE EXCEPTION
        'Cantidad fuera de escala: has puesto % y el sistema tiene %. Son % veces menos. ¿Estas contando en la unidad que te pide (cajas en vez de gramos)? Si de verdad has contado eso, confirmalo; si no queda nada, marca «no queda nada de este producto».',
        trim(to_char(NEW.counted_qty, 'FM999999999999999990.####')),
        trim(to_char(v_teorico,       'FM999999999999999990.####')),
        trim(to_char(round(v_teorico / NEW.counted_qty), 'FM999999999999999990'))
        USING ERRCODE = 'FV001';
    END IF;
  ELSE
    IF NEW.counted_qty > v_cap THEN
      RAISE EXCEPTION
        'Cantidad fuera de escala: has puesto % en unidades base, por encima del tope de %. Revisa la unidad y las comas; si de verdad has contado eso, confirmalo.',
        trim(to_char(NEW.counted_qty, 'FM999999999999999990.####')),
        trim(to_char(v_cap,           'FM999999999999999990'))
        USING ERRCODE = 'FV001';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
