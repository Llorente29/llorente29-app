-- ═══════════════════════════════════════════════════════════════════════════
-- CONTEO · p21 — «Corregir ahora»: la oficina llama, cocina cuenta, se apunta
--
-- Encargo de Julio (11/09/2026, 08:20): «Si hay una cantidad mala, desde
-- oficina se llama a cocina, se cuenta en ese momento y se corrige.» Con sus
-- condiciones, que son las que definen esta migración:
--
--   · Pasa por la MISMA PUERTA, `save_count_line`, como un intento nuevo.
--     Nunca un UPDATE directo de `counted_qty`.
--   · Se guarda QUIÉN CONTÓ (de la plantilla del local) y QUIÉN LO APUNTÓ.
--     No son la misma persona, y hasta hoy la tabla sólo sabía guardar una.
--   · Lo anterior no se borra: el intento viejo sigue en su sitio.
--   · El freno de cordura sigue puesto. El freno ciego no aplica.
--
-- ── Los DOS defectos que esto arregla, medidos antes de tocar nada ─────────
--
-- (1) EL TERCER GUARDADO PISA AL PRIMERO. `save_count_line` decidía el número
--     de intento así:
--         v_segundo := v_ya_pedido IS NOT NULL;          -- recount_asked_at
--         v_intento := CASE WHEN v_segundo THEN 2 ELSE 1 END;
--     Sólo existen el 1 y el 2. Un tercer guardado vuelve a escribir entradas
--     con `attempt = 1` y se MEZCLA con las del primer intento: `describirEntradas`
--     coge el intento más alto y sumaría cajas de dos recuentos distintos.
--     Aquí pasa a ser `max(attempt) + 1`, que es lo que siempre debió ser.
--
-- (2) RE-GUARDAR UNA LÍNEA YA BUENA PODÍA BORRARLA. Con la regla vieja, si el
--     primer intento salió `ok` (y por tanto `recount_asked_at` sigue a NULL),
--     un segundo guardado volvía a entrar por la rama de los frenos ciegos.
--     Si la cantidad nueva se apartaba del teórico por factor 3, el veredicto
--     era `recount`: la línea se quedaba SIN `counted_qty` y el móvil enseñaba
--     las casillas vacías. Corregir una cifra buena podía dejarla sin cifra.
--     Con `max(attempt) + 1`, todo guardado que no sea el primero entra por la
--     rama de «segunda mirada», que acepta siempre.
--
-- ── Por qué una corrección por teléfono NO se marca «No cuadró dos veces» ──
--
-- La rama de segunda mirada compara con el intento anterior y, si no se parece,
-- pone `needs_review = true`. Medido en `count_lines_requiring_reason`,
-- `needs_review` es UNO DE LOS CINCO MOTIVOS que obligan a poner un motivo para
-- aprobar. O sea: una corrección por teléfono —que casi por definición cambia
-- mucho la cifra, que para eso se corrige— dejaría la línea pidiendo motivo
-- para siempre, justo lo contrario de lo que pide el encargo («al guardar, la
-- línea se recalcula y, si ya cuadra, deja de pedir motivo»).
--
-- Y sería además una etiqueta falsa: «No cuadró dos veces» describe a alguien
-- que miró dos veces a ciegas y le salió distinto. Aquí no ha pasado eso: la
-- oficina estaba delante, VIENDO lo esperado, y ha decidido que 236 es lo que
-- hay. Por eso `p_source = 'telefono'` no marca revisión. La red de cordura
-- (FV001) sí sigue: esa no compara con nada, caza el cero de más.
--
-- ── EL ENSAYO, ANTES DE APLICAR (regla 10 = 32 de la maestra) ──────────────
--
-- Todo dentro de una transacción deshecha al final. Alcalá, cuenta Foodint,
-- Sweet Potato Fries, con Julio de oficina y Johanny de cocina:
--
--   A1 · intento=1 veredicto=ok contado=5000
--   A2 · intento=2   A3 · intento=3        ← con la regla vieja los tres eran 1
--   cierre · esperado=11600 contado=5000 desviación=−56,9 %
--   antes de corregir · motivos exigidos: desviacion, contradiccion
--   A4 · intento=4 veredicto=ok contado=11600 revisar=false
--   A4 · la línea dice: contado=11600 por «Johanny Garzón Rodríguez» · desviación=0,0000
--   A4 · la entrada guarda: contó=«Johanny Garzón Rodríguez» apuntó=«Julio» origen=telefono
--   A4 · lo viejo sigue (intento 1): 5000 ud
--   A5 · después de corregir · motivos exigidos: (ninguno)
--   A6 · Carabanchel con alguien de Alcalá · rechazado
--   A7 · «telefono» con el recuento contando · rechazado
--   A8 · cifra imposible · frenada (FV001) · y pasa confirmándola a mano
--
-- Y LOS CUATRO CAMINOS, después del cambio:
--   C1 · cerrar una venta · movimientos del artículo 81 → 82, sin fallo de consumo
--   C2 · recibir un albarán · albarán «confirmado», 1 movimiento, stock 11.600 → 21.600
--   C3 · apuntar una merma · 1 ajuste
--   C4 · aprobar el recuento · estado=aprobado, stock reescrito
--
-- (C2 se midió mal la primera vez —se buscaba `source_id` = el albarán— y salió
--  «0 movimientos». Medido bien, `source_id` es LA LÍNEA en los 937 movimientos
--  de recepción de Foodint, y el camino entero pide recibir Y confirmar, con
--  `qty_in_base` y nº de albarán. Es la regla 5 otra vez: la evidencia no medía
--  lo que yo creía.)
--
-- ── Una deuda que apareció montando el ensayo, y no se arregla aquí ────────
-- `inventory_count_line_otro_con_nota` está declarada NOT VALID, así que 732
-- líneas viejas de Foodint (596 aprobadas + 136 anuladas, del 14/06 al 09/09)
-- tienen `reason_code = 'otro'` SIN nota y la incumplen. Cualquier UPDATE de
-- una de ellas falla con 23514. No toca a «Corregir ahora» —esas líneas están
-- en recuentos aprobados o anulados, y ahí `save_count_line` ya no entra; en
-- `en_revision` no hay ninguna— pero queda apuntado.
--
-- ── Regla 2 · añadir un parámetro es DROP + CREATE ─────────────────────────
-- `CREATE OR REPLACE` con dos parámetros nuevos crearía una SOBRECARGA, y a
-- partir de ahí las llamadas de tres argumentos serían ambiguas (42725). Se
-- hace DROP de la firma de 3 y CREATE de la de 5, y se vuelven a dar los
-- permisos, que el DROP se lleva por delante.
--
-- ESO ÚLTIMO SALIÓ MAL AQUÍ, y está contado donde toca: al final del fichero,
-- y entero en p21b (20260911091340) y p21c (20260911091404). Devolver los
-- permisos «equivalentes» no es devolver los que había: hay que MEDIR `proacl`
-- después del CREATE, dentro de la misma migración, y no confiar en que un
-- GRANT deshace lo que el CREATE concede solo.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Lo que la tabla de entradas no sabía guardar ───────────────────────────
--
-- `source` nace en 'tablet' para TODAS las filas de antes, y eso es cierto,
-- no un relleno: hasta hoy la única forma de escribir una entrada era que la
-- persona que contaba la tecleara ella misma. 'telefono' sólo puede existir a
-- partir de esta migración.
ALTER TABLE public.inventory_count_entry
  ADD COLUMN IF NOT EXISTS counted_by_name  text,
  ADD COLUMN IF NOT EXISTS recorded_by      uuid,
  ADD COLUMN IF NOT EXISTS recorded_by_name text,
  ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'tablet';

ALTER TABLE public.inventory_count_entry
  DROP CONSTRAINT IF EXISTS inventory_count_entry_source_check;
ALTER TABLE public.inventory_count_entry
  ADD CONSTRAINT inventory_count_entry_source_check
  CHECK (source IN ('tablet', 'telefono'));

COMMENT ON COLUMN public.inventory_count_entry.counted_by_name IS
  'Nombre de quien contó, sellado al guardar. En una corrección por teléfono no es quien teclea.';
COMMENT ON COLUMN public.inventory_count_entry.recorded_by IS
  'Empleado que APUNTÓ la entrada (la oficina). NULL cuando es la misma persona que contó.';
COMMENT ON COLUMN public.inventory_count_entry.source IS
  'tablet = lo tecleó quien contó. telefono = lo dictó a la oficina por teléfono.';


-- ═══════════════════════════════════════════════════════════════════════════
-- LAS DIFERENCIAS DE UNA LÍNEA, RECALCULADAS SOLA
--
-- Encontrado montando el ensayo, no leyendo el código: `variance_qty`,
-- `variance_pct`, `variance_value` y `within_tolerance` NO los escribe
-- `save_count_line`. Los escribe `close_inventory_count`, UNA VEZ, al cerrar.
--
-- O sea que una corrección desde la revisión cambiaría `counted_qty` y dejaría
-- la diferencia con la cifra vieja. Y como `count_lines_requiring_reason` lee
-- `l.variance_pct` directamente, la línea corregida SEGUIRÍA PIDIENDO MOTIVO
-- por una desviación que ya no existe — justo lo que el encargo dice que tiene
-- que dejar de pasar. La pantalla enseñaría además un porcentaje que no es el
-- de la cifra que tiene al lado.
--
-- Misma fórmula que `close_inventory_count`, a propósito y con la misma vara
-- (regla 31). Que esté escrita dos veces es deuda declarada: no se toca
-- `close_inventory_count` en esta migración, que va sola. El ensayo lo mide —
-- recalcula líneas YA CERRADAS y comprueba que no cambia ni una cifra.
--
-- LO QUE NO HACE: `rebase_count_system_qty`. Al cerrar se fija lo esperado, y
-- corregir una cantidad no puede mover la referencia contra la que se compara.
-- Si el esperado se recalculara ahora, la diferencia se mediría contra otra
-- cosa que la que vio quien decidió llamar a cocina.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._recompute_count_line_variance(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_account_id  uuid;
  v_location_id uuid;
  v_apertura    boolean;
  v_contado     numeric;
  v_tol_a numeric; v_tol_b numeric; v_tol_c numeric;
  v_cost        numeric;
  v_hay_stock   boolean := false;
BEGIN
  SELECT l.account_id, ic.location_id, COALESCE(ic.is_opening, false), l.counted_qty
    INTO v_account_id, v_location_id, v_apertura, v_contado
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.id = p_line_id;
  IF v_account_id IS NULL THEN RETURN; END IF;

  -- UNA APERTURA NO CALCULA DIFERENCIAS. El teórico de antes es un número que
  -- ya sabemos malo; restarle lo contado no da una merma, da una resta sin
  -- significado. NULL y no cero: cero afirmaría «no ha habido diferencia».
  IF v_apertura THEN
    UPDATE public.inventory_count_line
       SET variance_qty = NULL, variance_pct = NULL,
           variance_value = NULL, within_tolerance = NULL
     WHERE id = p_line_id;
    RETURN;
  END IF;

  SELECT ril.avg_unit_cost, true
    INTO v_cost, v_hay_stock
    FROM public.recipe_item_location_stock ril
    JOIN public.inventory_count_line l ON l.id = p_line_id
   WHERE ril.recipe_item_id = l.recipe_item_id
     AND ril.location_id    = v_location_id
     AND ril.account_id     = v_account_id;
  v_hay_stock := COALESCE(v_hay_stock, false);

  -- ── EL COSTE CON EL QUE SE VALORÓ AL CERRAR, NO EL DE AHORA ─────────────
  --
  -- Medido, no supuesto: de 200 líneas ya cerradas de Foodint recalculadas con
  -- esta misma función, 62 cambiaban el importe en €. Ninguna cambiaba la
  -- diferencia en unidades, ni el porcentaje, ni la tolerancia. Las 62 se
  -- explicaban enteras por una cosa: `avg_unit_cost` SE HA MOVIDO desde que se
  -- cerró el recuento.
  --
  -- Corregir una CANTIDAD no puede cambiar la FECHA DEL COSTE con el que se
  -- valora. Si lo hiciera, la línea corregida se valoraría a precio de hoy y
  -- sus 35 vecinas a precio del cierre: el total de la pantalla sería una
  -- mezcla de dos días y se movería por una razón que nadie ha pedido.
  --
  -- El coste de entonces no está guardado en ningún sitio, pero se deduce
  -- exacto de lo que sí lo está: € entre unidades. Cuando no se puede deducir
  -- —no había importe, o la diferencia era cero— se usa el medio de hoy, que
  -- es lo que habría usado el cierre.
  SELECT CASE WHEN l.variance_value IS NOT NULL
               AND l.variance_qty IS NOT NULL
               AND l.variance_qty <> 0
              THEN l.variance_value / l.variance_qty
              ELSE v_cost
         END
    INTO v_cost
    FROM public.inventory_count_line l WHERE l.id = p_line_id;

  -- Sin fila de stock Y sin nada contado, `close_inventory_count` no toca la
  -- línea. Aquí tampoco: escribir donde el cierre calla sería una diferencia
  -- entre las dos varas.
  IF NOT v_hay_stock AND v_contado IS NULL THEN RETURN; END IF;

  SELECT COALESCE(tol_a_pct, 2), COALESCE(tol_b_pct, 3), COALESCE(tol_c_pct, 5)
    INTO v_tol_a, v_tol_b, v_tol_c
    FROM public.supply_settings WHERE account_id = v_account_id;
  v_tol_a := COALESCE(v_tol_a, 2); v_tol_b := COALESCE(v_tol_b, 3); v_tol_c := COALESCE(v_tol_c, 5);

  UPDATE public.inventory_count_line l
     SET variance_qty = l.counted_qty - l.system_qty,
         variance_pct = CASE WHEN COALESCE(l.system_qty, 0) <> 0
                             THEN (l.counted_qty - l.system_qty) / l.system_qty * 100
                             ELSE NULL END,
         -- Sin coste fiable, NULL. Nunca un 0 € callado (regla del 10/09).
         variance_value = CASE WHEN v_hay_stock
                               THEN (l.counted_qty - l.system_qty) * v_cost
                               ELSE NULL END,
         within_tolerance = CASE
           WHEN l.counted_qty IS NULL THEN NULL
           WHEN COALESCE(l.system_qty, 0) = 0 THEN (l.counted_qty = 0)
           ELSE abs((l.counted_qty - l.system_qty) / l.system_qty * 100) <=
                CASE l.abc_class WHEN 'A' THEN v_tol_a WHEN 'B' THEN v_tol_b ELSE v_tol_c END
         END
   WHERE l.id = p_line_id;

  -- SANEAMIENTO: si el sistema estaba en NEGATIVO, el conteo lo corrige pero
  -- NO es merma del período. Aquí el 0 SÍ es un cero de verdad.
  UPDATE public.inventory_count_line
     SET variance_value = 0, within_tolerance = true
   WHERE id = p_line_id
     AND counted_qty IS NOT NULL
     AND COALESCE(system_qty, 0) < 0;
END;
$fn$;

-- LOS PERMISOS DE ESTA FUNCION SE ARREGLAN EN p21b Y p21c, NO AQUI.
--
-- Esto es lo que se aplicó de verdad bajo la versión 20260911091247, y se deja
-- tal cual para que el fichero diga la verdad. Estaba MAL: `CREATE FUNCTION`
-- concede EXECUTE a PUBLIC, y este proyecto además concede a `anon` y
-- `authenticated` por defecto en cada función nueva de `public`. Se midió
-- DESPUÉS de aplicar —ahí está el fallo— y se corrigió en caliente con
-- 20260911091340 (p21b) y 20260911091404 (p21c).
GRANT EXECUTE ON FUNCTION public._recompute_count_line_variance(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.save_count_line(uuid, jsonb, numeric);

CREATE FUNCTION public.save_count_line(
  p_line_id    uuid,
  p_entries    jsonb,
  p_confirm    numeric DEFAULT NULL::numeric,
  -- Quién contó DE VERDAD. NULL = quien llama, que es el caso del móvil y no
  -- cambia en nada respecto a antes.
  p_counted_by uuid    DEFAULT NULL::uuid,
  -- 'tablet' (por defecto) o 'telefono'.
  p_source     text    DEFAULT NULL::text
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

  -- Quien contó, cuando no es quien teclea.
  v_source       text := COALESCE(NULLIF(p_source, ''), 'tablet');
  v_por_telefono boolean;
  v_quien_emp    uuid;
  v_quien_name   text;

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
  IF v_source NOT IN ('tablet', 'telefono') THEN
    RAISE EXCEPTION 'save_count_line: origen «%» desconocido', v_source;
  END IF;
  v_por_telefono := v_source = 'telefono';

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

  -- «Corregir ahora» es una acción de la pantalla de revisión y de ninguna
  -- otra. Mientras el recuento sigue abierto, quien cuenta cuenta: no hace
  -- falta que nadie apunte por él.
  IF v_por_telefono AND v_status <> 'en_revision' THEN
    RAISE EXCEPTION 'save_count_line: una corrección por teléfono sólo se apunta con el recuento en revisión, y éste está %', v_status;
  END IF;

  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'save_count_line: hay que mandar al menos una entrada. Un campo vacío no es un cero: para decir que no queda nada, manda una entrada con method = cero.';
  END IF;

  -- Nombre real de quien cuenta, para que la pantalla de aprobación pueda
  -- decir «Natacha · 20:39» y no «alguien».
  --
  -- `display_name` entra como reserva (11/09): el usuario de oficina no tiene
  -- ficha de empleado, y sin esto «apuntado por …» se quedaría en blanco justo
  -- en el caso para el que se escribe esta migración.
  SELECT up.employee_id, COALESCE(e.name, up.display_name)
    INTO v_actor_emp, v_actor_name
    FROM public.user_profiles up
    LEFT JOIN public.employees e ON e.id = up.employee_id
   WHERE up.user_id = v_actor AND up.account_id = v_account_id
   LIMIT 1;

  -- ── Quién contó, si no es quien teclea ──────────────────────────────────
  --
  -- REGLA 9, UN PISO MÁS ABAJO. El empleado se ancla por id Y por cuenta Y por
  -- LOCAL: la plantilla es multi-cuenta y multi-local, y apuntar el recuento
  -- de Carabanchel a nombre de alguien de Alcalá no da un nombre equivocado,
  -- da un nombre que no es de nadie.
  IF p_counted_by IS NOT NULL THEN
    SELECT emp.id, emp.name
      INTO v_quien_emp, v_quien_name
      FROM public.employees emp
     WHERE emp.id         = p_counted_by
       AND emp.account_id = v_account_id
       AND emp.active
       AND (emp.location_id = v_location_id
            OR v_location_id = ANY(COALESCE(emp.assigned_locations, '{}'::uuid[])));
    IF v_quien_emp IS NULL THEN
      RAISE EXCEPTION 'save_count_line: % no está en la plantilla activa de este local, así que no puede figurar como quien contó', p_counted_by;
    END IF;
  END IF;

  -- ── El número de intento: max + 1, nunca «1 o 2» ────────────────────────
  --
  -- Ver la cabecera de la migración: con la regla vieja el tercer guardado
  -- escribía otra vez sobre el intento 1, y un re-guardado de una línea buena
  -- volvía a pasar por los frenos ciegos y podía dejarla sin cifra.
  SELECT COALESCE(max(attempt), 0) + 1 INTO v_intento
    FROM public.inventory_count_entry WHERE line_id = p_line_id;
  v_segundo := v_intento > 1;

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
    -- SEGUNDA MIRADA (o tercera, o cuarta): se acepta siempre. Sólo decide
    -- cómo queda sellado.
    --
    -- Se compara con el TOTAL DEL INTENTO ANTERIOR, que está en las entradas,
    -- no con `counted_qty` — que en un `recount` se quedó sin escribir a
    -- propósito. Comparar contra un NULL haría que «lo he mirado bien: es lo
    -- que hay» acabara SIEMPRE en `needs_review`, y entonces «confirmado dos
    -- veces» no existiría nunca: la etiqueta estaría en la pantalla y no
    -- podría salir.
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

    -- UNA CORRECCIÓN POR TELÉFONO NO ES «NO CUADRÓ DOS VECES».
    --
    -- Las dos etiquetas de arriba describen a alguien que miró dos veces A
    -- CIEGAS. En una corrección desde revisión no ha pasado eso: la oficina
    -- está delante, VIENDO lo esperado, ha llamado precisamente porque la
    -- cifra estaba mal, y la nueva sustituye a la vieja a sabiendas. Que
    -- cambie mucho es el propósito, no un síntoma.
    --
    -- Y `needs_review` no es sólo una pastilla: medido en
    -- `count_lines_requiring_reason`, es uno de los cinco motivos que obligan
    -- a poner un motivo para aprobar. Dejarlo puesto haría que la línea
    -- corregida siguiera pidiendo motivo para siempre — lo contrario de lo
    -- que pide el encargo.
    IF v_por_telefono THEN
      v_confirmado := false;
      v_revisar    := false;
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
  --
  -- `recorded_by` se queda en NULL cuando quien apunta ES quien cuenta: un
  -- «apuntado por Pamela» debajo de «contó Pamela» sería ruido, y además
  -- distinguir el NULL permite saber después cuáles se dictaron.
  INSERT INTO public.inventory_count_entry
    (account_id, line_id, format_id, qty, fraction, qty_in_base, method, attempt,
     counted_by, counted_by_name, recorded_by, recorded_by_name, source)
  SELECT v_account_id, p_line_id,
         NULLIF(e->>'format_id','')::uuid,
         NULLIF(e->>'qty','')::numeric,
         NULLIF(e->>'fraction','')::numeric,
         (e->>'base')::numeric,
         e->>'method',
         v_intento,
         COALESCE(v_quien_emp, v_actor_emp, v_actor),
         COALESCE(v_quien_name, v_actor_name),
         CASE WHEN v_quien_emp IS NOT NULL THEN COALESCE(v_actor_emp, v_actor) END,
         CASE WHEN v_quien_emp IS NOT NULL THEN v_actor_name END,
         v_source
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
           counted_by               = COALESCE(v_quien_emp, v_actor_emp, counted_by),
           counted_by_name          = COALESCE(v_quien_name, v_actor_name, counted_by_name),
           counted_qty_confirmed    = CASE WHEN v_confirmado OR v_forzado THEN v_total ELSE NULL END,
           counted_qty_confirmed_at = CASE WHEN v_confirmado OR v_forzado THEN now() ELSE NULL END,
           needs_review             = v_revisar,
           no_reference             = v_sin_ref
     WHERE id = p_line_id;
    PERFORM set_config('folvy.count_gate', '', true);

    -- LAS DIFERENCIAS, AL DÍA. Si el recuento ya está cerrado —y una corrección
    -- desde revisión lo está siempre— las cifras de diferencia son las que se
    -- calcularon al cerrar, contra la cantidad VIEJA. Sin esto, la línea
    -- corregida seguiría pidiendo motivo por una desviación que ya no existe y
    -- la pantalla enseñaría un porcentaje que no es el de la cifra de al lado.
    --
    -- Mientras el recuento sigue abierto no se toca: ahí las diferencias no
    -- están calculadas todavía, y las calculará el cierre para todas a la vez.
    IF v_status = 'en_revision' THEN
      PERFORM public._recompute_count_line_variance(p_line_id);
    END IF;
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

-- El DROP se lleva los permisos, y esto era lo único que se hacía para
-- devolverlos. NO BASTABA, y el fichero lo dice en vez de disimularlo: falta
-- revocar PUBLIC y `anon`, que `CREATE FUNCTION` y las DEFAULT PRIVILEGES de
-- este proyecto conceden solos. Se arregla en p21b y p21c, que van a
-- continuación de ésta.
GRANT EXECUTE ON FUNCTION public.save_count_line(uuid, jsonb, numeric, uuid, text)
  TO authenticated, service_role;

COMMIT;
