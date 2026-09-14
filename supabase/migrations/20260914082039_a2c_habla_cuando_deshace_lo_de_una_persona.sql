-- ═══════════════════════════════════════════════════════════════════════════
-- A2c HABLA CUANDO DESHACE LO DE UNA PERSONA
-- 14/09/2026 · Foodint 51ad1792-6629-4ef7-833a-b57b09a86710
--
-- Instrucción de Julio (13/09 19:45): «A2c no se arregla quitándolo: se
-- arregla haciéndolo hablar». O sea: la vuelta atrás SE QUEDA --si Last
-- recupera una opción, se vuelve a encender sola-- pero cuando eso deshace lo
-- que decidió una persona, se dice. En el parte de la pasada, en la cola de
-- avisos y en la pantalla.
--
-- Esta migración hace las dos primeras y deja escrito el dato para la tercera.
-- La pantalla va aparte, y el motivo está abajo, en LA BANDA.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── LO QUE PASABA, Y NO ERA UNA SUPOSICIÓN ─────────────────────────────────
--
-- La rama «LA VUELTA» de `modificadores_plan_de_retiro` coge TODA opción
-- apagada de una marca cedida visitada cuya referencia vuelva a estar en la
-- lista de Last, y la enciende. No mira quién la apagó. Y el disparador, al
-- encenderla, borra el sello:
--
--     deactivated_at := NULL;  deactivated_by := NULL;
--
-- O sea que si una persona apagó una opción a propósito, la pasada de
-- madrugada la vuelve a encender Y BORRA LA ÚNICA PRUEBA de que alguien había
-- decidido algo. No queda ni en el parte, ni en un aviso, ni en la fila.
-- Nadie se entera nunca: ni quien lo decidió ni quien lo mire después.
--
-- ── ¿PUEDE PASAR HOY? SÍ, Y POR DÓNDE ──────────────────────────────────────
--
-- Medido antes de escribir nada, con `account_id` explícito (regla 9):
--
--   · 80 opciones apagadas en Foodint: 72 por una persona, 1 por el
--     importador, 7 sin sello (de antes de que el sello existiera).
--   · Las 72 están TODAS en marcas PROPIAS. El raíl de A2c sólo entra en
--     `ownership_type = 'licensed'`. Así que a día de hoy no hay ni una
--     colisión posible: los dos conjuntos no se tocan.
--
-- Y sin embargo la puerta existe y está abierta. Las tres funciones que apagan
-- una opción --`kitchen_retirar`, `kitchen_guardar_pregunta` y este A2c-- sí
-- miran de quién es la marca. Pero hay una CUARTA vía que no pasa por ninguna:
--
--     modifier_option_write · política FOR ALL · admin o encargado de la cuenta
--
-- y el front la usa: `deleteModifierOption` hace un `update({is_active:false})`
-- directo por REST desde la ficha de catálogo, sin mirar `ownership_type`. Un
-- encargado quita una opción de una marca cedida desde esa pantalla, el
-- disparador la sella como 'persona', y la pasada de madrugada la deshace en
-- silencio. No ha pasado todavía. Está a un clic.
--
-- (Cerrar esa cuarta puerta NO es esto. Julio pidió que hablara, no que dejara
--  de hacerlo, y cerrarla es otra decisión. Va al parte como hallazgo.)
--
-- ── LA BANDA, CONTADA ──────────────────────────────────────────────────────
--
-- El `ALTER TABLE ... ADD COLUMN` toma ACCESS EXCLUSIVE sobre `modifier_option`,
-- y esa tabla la leen 27 funciones, el camino del pedido entre ellas. Por la
-- regla de Julio del 14/09 --«a la madrugada sólo va lo que toma cierre
-- exclusivo sobre una tabla del pedido, contado»-- esto NO se aplica dentro de
-- la banda de servicio.
--
-- Se aplica a las 10:2x de la mañana (reloj de la base), que es fuera de la
-- banda de las 12:15-23:45 por delante, no por detrás: a esa hora todavía no
-- ha empezado el servicio de comidas.
--
-- Y por eso la PANTALLA va en otra pieza: enseñar la marca es un
-- `create or replace` de una función de lectura, que no cierra ninguna tabla y
-- puede salir cuando esté lista. Lo que necesitaba el cierre es esto.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ① QUE QUEDE ESCRITO ────────────────────────────────────────────────────
--
-- Dos columnas, por lo mismo que el sello de retiro lleva dos: la fecha sin el
-- autor no dice nada y el autor sin la fecha tampoco.

ALTER TABLE public.modifier_option
  ADD COLUMN IF NOT EXISTS reencendida_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reencendida_sobre text;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.modifier_option'::regclass
                    AND conname = 'modifier_option_reencendida_sobre_valid') THEN
    -- El CHECK se escribe contemplando los valores que se van a escribir --ése
    -- fue el fallo de A3 el 11/09 a las 12:32: un CHECK sin el valor nuevo,
    -- 23514, y el pedido entero al suelo--. Hoy sólo se escribe 'persona'.
    -- 'last' se admite porque `deactivated_by` ya tiene los dos, y el día que
    -- alguien quiera anotar el otro caso no puede ser un 23514 en el camino
    -- del pedido.
    ALTER TABLE public.modifier_option
      ADD CONSTRAINT modifier_option_reencendida_sobre_valid
      CHECK (reencendida_sobre IS NULL OR reencendida_sobre IN ('persona', 'last'));
  END IF;
END
$chk$;

COMMENT ON COLUMN public.modifier_option.reencendida_at IS
  'Cuando el importador de Last volvio a encender esta opcion por encima de una decision que no era suya. NULL = no ha pasado, o ya lo ha visto una persona.';
COMMENT ON COLUMN public.modifier_option.reencendida_sobre IS
  'A quien se le deshizo: persona (la habia apagado alguien desde Folvy). NULL = no hay nada que contar.';


-- ── ② EL DISPARADOR: la marca se pone sola y se quita sola ─────────────────

CREATE OR REPLACE FUNCTION public.tg_modifier_option_retiro()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $tg$
BEGIN
  -- Se apaga: se sella cuando y quien. Si el llamador ya dijo quien --A2c dice
  -- 'last'-- se respeta; si no, fue una persona desde la pantalla.
  IF OLD.is_active AND NOT NEW.is_active THEN
    NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
    NEW.deactivated_by := COALESCE(NEW.deactivated_by, 'persona');
    -- Y se limpia la marca de reencendido: una opcion APAGADA no puede estar
    -- diciendo «te la volvieron a encender». Eso ya no es verdad.
    NEW.reencendida_at    := NULL;
    NEW.reencendida_sobre := NULL;

  -- Se enciende: el sello de apagado se borra. Una opcion encendida con fecha
  -- de retiro seria una fila que se contradice a si misma.
  ELSIF NOT OLD.is_active AND NEW.is_active THEN
    -- 🔴 PERO SI LA APAGO UNA PERSONA Y LA ENCIENDE EL IMPORTADOR, ESO NO SE
    -- BORRA (14/09). Hasta hoy se borraba, y con ello la unica prueba de que
    -- alguien habia decidido algo: la pasada de madrugada deshacia una
    -- decision y no quedaba rastro en ningun sitio.
    --
    -- Quien la enciende lo dice poniendo `reencendida_sobre`; A2c lo pone, y
    -- solo para las que apago una persona. Si nadie lo dice, la esta
    -- encendiendo una persona --por la pantalla-- y entonces no hay nada que
    -- contar: la marca se limpia.
    IF NEW.reencendida_sobre IS NOT NULL THEN
      NEW.reencendida_at := COALESCE(NEW.reencendida_at, now());
    ELSE
      NEW.reencendida_at    := NULL;
      NEW.reencendida_sobre := NULL;
    END IF;
    NEW.deactivated_at := NULL;
    NEW.deactivated_by := NULL;
  END IF;
  RETURN NEW;
END;
$tg$;


-- ── ③ A2c: la vuelta se parte en dos, y la que deshace habla ───────────────

-- Los valores por defecto van TAL CUAL estaban. El primer intento los omitió y
-- Postgres paró en seco --42P13, «cannot remove parameter defaults from
-- existing function»-- sin escribir nada. Es el primo hermano de la regla 2:
-- ahí, añadir un parámetro con `replace` creaba una sobrecarga en silencio;
-- aquí, quitarle los defectos no se puede hacer en silencio y avisa. Los
-- llamadores que llaman con 3 argumentos --el `dry_run`-- seguirían andando
-- sólo si estos tres se mantienen: `false`, `3` y `20`.
CREATE OR REPLACE FUNCTION public.modificadores_plan_de_retiro(
  p_account_id uuid, p_brand_ids uuid[], p_option_ext_ids text[],
  p_aplicar boolean DEFAULT false, p_max_por_marca integer DEFAULT 3,
  p_max_pct numeric DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_marcas    jsonb   := '[]'::jsonb;
  v_retiradas integer := 0;
  v_frenadas  integer := 0;
  v_visitadas integer := 0;
  v_sin_ref   integer := 0;
  v_avisados  integer := 0;
  v_callados  integer := 0;
  v_marca     jsonb;
  v_id        bigint;
  v_a_retirar uuid[] := '{}';
  v_rescatados integer := 0;
  v_rescatables integer := 0;
  v_sin_codigo integer := 0;
  v_reactivar  uuid[] := '{}';
  v_reactivadas integer := 0;
  -- 🔴 LO NUEVO (14/09): la vuelta atras se parte en dos montones.
  v_volver_rutina  uuid[] := '{}';   -- las apago el propio importador, o no se sabe
  v_volver_persona uuid[] := '{}';   -- las apago UNA PERSONA: esto deshace lo suyo
  v_deshechas      integer := 0;
  v_deshechas_json jsonb   := '[]'::jsonb;
BEGIN
  -- FRENO 2 · la lista vacía no retira.
  IF p_account_id IS NULL
     OR COALESCE(array_length(p_brand_ids, 1), 0) = 0
     OR COALESCE(array_length(p_option_ext_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'ok',     false,
      'motivo', 'la pasada no trae marcas visitadas o no trae ni una opcion de Last: no se retira nada',
      'aplicado',           false,
      'marcas_visitadas',   COALESCE(array_length(p_brand_ids, 1), 0),
      'opciones_en_last',   COALESCE(array_length(p_option_ext_ids, 1), 0),
      'opciones_retiradas', 0,
      'marcas_frenadas',    0,
      'marcas',             '[]'::jsonb
    );
  END IF;

  -- ── EL PLAN. Sólo lee. Lo que decide aquí es lo que se ejecuta abajo, y
  -- es lo MISMO que devuelve el `dry_run`: una sola vara para los dos lados
  -- (regla 31).
  WITH vivas AS (
    -- FRENO 1 · el raíl: sólo marcas visitadas, sólo cedidas, sólo de esta
    -- cuenta (regla 9: el catálogo plantilla comparte tablas Y nombres).
    SELECT mo.id, mo.name AS opcion, mo.external_id, mo.pos_modifier_id,
           mg.brand_id, b.name AS marca, mg.name AS pregunta
      FROM public.modifier_option mo
      JOIN public.modifier_group  mg ON mg.id = mo.modifier_group_id
      JOIN public.brand           b  ON b.id  = mg.brand_id
     WHERE mo.account_id      = p_account_id
       AND b.account_id       = p_account_id
       AND mo.external_source = 'lastapp'
       AND mo.is_active
       AND mg.brand_id        = ANY(p_brand_ids)
       AND b.ownership_type   = 'licensed'
  ),
  cat AS (
    SELECT DISTINCT e AS ext FROM unnest(p_option_ext_ids) e WHERE e IS NOT NULL
  ),
  -- Una opción con origen `lastapp` y SIN referencia no se puede comparar con
  -- nada: no se retira, se cuenta aparte y se dice.
  con_ref AS (SELECT * FROM vivas WHERE external_id IS NOT NULL),
  sobra AS (
    SELECT v.* FROM con_ref v
     WHERE NOT EXISTS (SELECT 1 FROM cat c WHERE c.ext = v.external_id)
  ),
  por_marca AS (
    SELECT v.brand_id, max(v.marca) AS marca, count(*) AS activas,
           count(*) FILTER (
             WHERE NOT EXISTS (SELECT 1 FROM cat c WHERE c.ext = v.external_id)
           ) AS sobran
      FROM con_ref v
     GROUP BY v.brand_id
  ),
  decision AS (
    -- FRENO 3 · el de Julio. Se evalúa marca por marca, con SUS cifras: el
    -- freno de una no arrastra a las demás.
    SELECT pm.*,
           (pm.sobran > p_max_por_marca
            OR pm.sobran::numeric > (p_max_pct / 100.0) * pm.activas) AS frenada,
           round(100.0 * pm.sobran / NULLIF(pm.activas, 0), 1) AS pct
      FROM por_marca pm
     WHERE pm.sobran > 0
  )
  SELECT
    (SELECT COALESCE(array_agg(s.id), '{}')
       FROM sobra s JOIN decision d ON d.brand_id = s.brand_id WHERE NOT d.frenada),
    (SELECT count(*) FROM decision WHERE frenada),
    (SELECT count(DISTINCT brand_id) FROM vivas),
    (SELECT count(*) FROM vivas WHERE external_id IS NULL),
    (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'marca'), '[]'::jsonb) FROM (
       SELECT jsonb_build_object(
                'brand_id', d.brand_id,
                'marca',    d.marca,
                'activas',  d.activas,
                'sobran',   d.sobran,
                'pct',      d.pct,
                'frenada',  d.frenada,
                'motivo_del_freno', CASE
                  WHEN NOT d.frenada THEN NULL
                  WHEN d.sobran > p_max_por_marca
                    THEN format('%s opciones es mas de %s', d.sobran, p_max_por_marca)
                  ELSE format('%s %% es mas del %s %% de las suyas', d.pct, p_max_pct)
                END,
                'opciones', (
                  SELECT COALESCE(jsonb_agg(jsonb_build_object(
                           'opcion', s.opcion, 'pregunta', s.pregunta, 'ref', s.external_id,
                           'codigo', s.pos_modifier_id)
                         ORDER BY s.opcion), '[]'::jsonb)
                    FROM sobra s WHERE s.brand_id = d.brand_id
                )
              ) AS x
         FROM decision d
     ) q)
  INTO v_a_retirar, v_frenadas, v_visitadas, v_sin_ref, v_marcas;

  -- ── LA VUELTA. Lo que Last VUELVE a servir se vuelve a encender solo.
  --
  -- 🔴 EN DOS MONTONES (14/09). El de arriba es rutina: la apagó el propio
  -- importador y ahora Last la recupera. El de abajo DESHACE LO DE UNA
  -- PERSONA, y ése es el que habla.
  SELECT COALESCE(array_agg(mo.id) FILTER (WHERE mo.deactivated_by IS DISTINCT FROM 'persona'), '{}'::uuid[]),
         COALESCE(array_agg(mo.id) FILTER (WHERE mo.deactivated_by = 'persona'), '{}'::uuid[])
    INTO v_volver_rutina, v_volver_persona
    FROM public.modifier_option mo
    JOIN public.modifier_group  mg ON mg.id = mo.modifier_group_id
    JOIN public.brand           b  ON b.id  = mg.brand_id
   WHERE mo.account_id      = p_account_id
     AND b.account_id       = p_account_id
     AND mo.external_source = 'lastapp'
     AND NOT mo.is_active
     AND mg.brand_id        = ANY(p_brand_ids)
     AND b.ownership_type   = 'licensed'
     AND mo.external_id IS NOT NULL
     AND mo.external_id = ANY(p_option_ext_ids);

  v_reactivar := v_volver_rutina || v_volver_persona;

  -- El detalle de las que deshacen, ANTES de tocarlas: después de encenderlas
  -- el sello ya no dice quién las había apagado ni cuándo, y eso es justo lo
  -- que hay que contar.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'brand_id',  mg.brand_id,
           'marca',     b.name,
           'pregunta',  mg.name,
           'opcion',    mo.name,
           'la_apago',  mo.deactivated_by,
           'apagada_el', mo.deactivated_at)
         ORDER BY b.name, mo.name), '[]'::jsonb)
    INTO v_deshechas_json
    FROM public.modifier_option mo
    JOIN public.modifier_group mg ON mg.id = mo.modifier_group_id
    JOIN public.brand b ON b.id = mg.brand_id
   WHERE mo.id = ANY(v_volver_persona);

  -- ── LO QUE EL RESCATE PUEDE SALVAR.
  WITH evidencia AS (
    SELECT sl.modifier_option_id AS opt, min(sl.external_product_id) AS ref
      FROM public.sale_line sl
     WHERE sl.account_id = p_account_id
       AND sl.line_type = 'modifier'
       AND sl.external_source = 'lastapp'
       AND sl.external_product_id IS NOT NULL
       AND sl.modifier_option_id = ANY(v_a_retirar)
     GROUP BY sl.modifier_option_id
    HAVING count(DISTINCT sl.external_product_id) = 1
       AND NOT EXISTS (SELECT 1 FROM public.modifier_option o2
                        WHERE o2.account_id = p_account_id
                          AND o2.pos_modifier_id = min(sl.external_product_id))
  )
  SELECT count(*) FILTER (WHERE e.ref IS NOT NULL),
         count(*) FILTER (WHERE e.ref IS NULL)
    INTO v_rescatables, v_sin_codigo
    FROM public.modifier_option mo
    LEFT JOIN evidencia e ON e.opt = mo.id
   WHERE mo.id = ANY(v_a_retirar) AND mo.pos_modifier_id IS NULL;

  -- Las de rutina: se encienden y quedan limpias, como siempre.
  IF p_aplicar AND COALESCE(array_length(v_volver_rutina, 1), 0) > 0 THEN
    UPDATE public.modifier_option mo
       SET is_active = true, deactivated_at = NULL, deactivated_by = NULL,
           updated_at = now()
     WHERE mo.id = ANY(v_volver_rutina);
    GET DIAGNOSTICS v_reactivadas = ROW_COUNT;
  END IF;

  -- Las que deshacen lo de una persona: se encienden IGUAL --Julio, 13/09
  -- 19:45: «no se arregla quitándolo, se arregla haciéndolo hablar»-- pero
  -- dejan la marca puesta. El disparador pone la fecha.
  IF p_aplicar AND COALESCE(array_length(v_volver_persona, 1), 0) > 0 THEN
    UPDATE public.modifier_option mo
       SET is_active = true, reencendida_sobre = 'persona', updated_at = now()
     WHERE mo.id = ANY(v_volver_persona);
    GET DIAGNOSTICS v_deshechas = ROW_COUNT;
    v_reactivadas := v_reactivadas + v_deshechas;
  END IF;

  IF p_aplicar AND v_reactivadas <> COALESCE(array_length(v_reactivar, 1), 0) THEN
    RAISE EXCEPTION 'A2c: el plan decia reencender % y se reencendieron %',
      COALESCE(array_length(v_reactivar, 1), 0), v_reactivadas;
  END IF;

  IF p_aplicar AND COALESCE(array_length(v_a_retirar, 1), 0) > 0 THEN
    -- EL RESCATE DEL CÓDIGO, antes de apagar. Sólo donde la evidencia de los
    -- propios pedidos es UNA y no la usa nadie más. Si no, no se inventa nada.
    WITH evidencia AS (
      SELECT sl.modifier_option_id AS opt, min(sl.external_product_id) AS ref
        FROM public.sale_line sl
       WHERE sl.account_id = p_account_id
         AND sl.line_type = 'modifier'
         AND sl.external_source = 'lastapp'
         AND sl.external_product_id IS NOT NULL
         AND sl.modifier_option_id = ANY(v_a_retirar)
       GROUP BY sl.modifier_option_id
      HAVING count(DISTINCT sl.external_product_id) = 1
         AND NOT EXISTS (SELECT 1 FROM public.modifier_option o2
                          WHERE o2.account_id = p_account_id
                            AND o2.pos_modifier_id = min(sl.external_product_id))
    )
    UPDATE public.modifier_option mo
       SET pos_modifier_id = e.ref, updated_at = now()
      FROM evidencia e
     WHERE mo.id = e.opt AND mo.pos_modifier_id IS NULL;
    GET DIAGNOSTICS v_rescatados = ROW_COUNT;

    UPDATE public.modifier_option mo
       SET is_active = false, deactivated_at = now(), deactivated_by = 'last',
           updated_at = now()
     WHERE mo.id = ANY(v_a_retirar);
    GET DIAGNOSTICS v_retiradas = ROW_COUNT;

    -- Si lo hecho no es lo planeado, algo se movió por debajo: se para.
    IF v_rescatados <> v_rescatables
       OR v_retiradas <> COALESCE(array_length(v_a_retirar, 1), 0) THEN
      RAISE EXCEPTION 'A2c: el plan decia % rescates y % retiros; se hicieron % y %',
        v_rescatables, COALESCE(array_length(v_a_retirar, 1), 0), v_rescatados, v_retiradas;
    END IF;
  END IF;

  IF p_aplicar AND v_frenadas > 0 THEN
    FOR v_marca IN
      SELECT m FROM jsonb_array_elements(v_marcas) m WHERE (m->>'frenada')::boolean
    LOOP
      v_id := public.encolar_alerta(
        p_kind    => 'catalogo_last_retiro_frenado',
        p_subject => format('Last: no se han retirado los extras de %s', v_marca->>'marca'),
        p_message => format(
            'El importador de Last iba a apagar %s de las %s opciones de extra de %s (%s %%) y no ha apagado ninguna: %s. '
         || 'O Last ha cambiado la carta de verdad, o la pasada vino incompleta. Hasta que se mire, esas opciones siguen encendidas. '
         || 'Son: %s.',
            v_marca->>'sobran', v_marca->>'activas', v_marca->>'marca', v_marca->>'pct',
            v_marca->>'motivo_del_freno',
            (SELECT string_agg(o->>'opcion', ', ') FROM jsonb_array_elements(v_marca->'opciones') o)),
        p_debounce_kind   => 'catalogo_last_retiro_frenado:' || (v_marca->>'marca'),
        p_debounce_window => interval '6 hours',
        p_account_id      => p_account_id,
        p_brand_id        => (v_marca->>'brand_id')::uuid,
        p_severity        => 'aviso'
      );
      IF v_id IS NULL THEN v_callados := v_callados + 1;
      ELSE                 v_avisados := v_avisados + 1;
      END IF;
    END LOOP;
  END IF;

  -- ── 🔴 EL AVISO NUEVO: se ha deshecho lo que decidió una persona.
  --
  -- Un aviso interrumpe, así que aquí SÍ se filtra (regla 7): sólo sale cuando
  -- hay al menos una, y una por marca, no una por opción. Pero el parte de
  -- abajo las lleva TODAS con nombre, que es la pantalla que se abre a
  -- propósito.
  --
  -- Y no se dice una hora: se dice «de madrugada». La hora de la pasada es
  -- cosa nuestra y cambia; lo que le importa a quien lo lee es que pasó
  -- mientras no estaba.
  IF p_aplicar AND v_deshechas > 0 THEN
    FOR v_marca IN
      SELECT jsonb_build_object(
               'brand_id', d->>'brand_id',
               'marca',    d->>'marca',
               'cuantas',  count(*),
               'opciones', string_agg(d->>'opcion', ', ' ORDER BY d->>'opcion'))
        FROM jsonb_array_elements(v_deshechas_json) d
       GROUP BY d->>'brand_id', d->>'marca'
    LOOP
      v_id := public.encolar_alerta(
        p_kind    => 'catalogo_last_reenciende_lo_que_apago_una_persona',
        p_subject => format('Last ha vuelto a encender %s extra%s de %s que alguien había quitado',
                            v_marca->>'cuantas',
                            CASE WHEN (v_marca->>'cuantas')::int = 1 THEN '' ELSE 's' END,
                            v_marca->>'marca'),
        p_message => format(
            'Alguien había quitado %s en %s desde Folvy, y Last las sigue sirviendo. '
         || 'La importación de madrugada las ha vuelto a encender, que es lo que hace cuando Last recupera una opción. '
         || 'Ahora están a la venta otra vez. Si tienen que estar quitadas, hay que quitarlas TAMBIÉN en Last: '
         || 'mientras Last las sirva, volverán a encenderse cada noche.',
            v_marca->>'opciones', v_marca->>'marca'),
        p_debounce_kind   => 'catalogo_last_reenciende_persona:' || (v_marca->>'marca'),
        p_debounce_window => interval '6 hours',
        p_account_id      => p_account_id,
        p_brand_id        => (v_marca->>'brand_id')::uuid,
        p_severity        => 'aviso'
      );
      IF v_id IS NULL THEN v_callados := v_callados + 1;
      ELSE                 v_avisados := v_avisados + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok',                 true,
    'aplicado',           p_aplicar,
    'marcas_visitadas',   v_visitadas,
    'opciones_en_last',   COALESCE(array_length(p_option_ext_ids, 1), 0),
    'opciones_retiradas', v_retiradas,
    'opciones_a_retirar', COALESCE(array_length(v_a_retirar, 1), 0),
    'opciones_a_reencender', COALESCE(array_length(v_reactivar, 1), 0),
    'opciones_reencendidas', v_reactivadas,
    'reencendidas_cuales', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('opcion', mo.name, 'marca', b.name)
                      ORDER BY mo.name), '[]'::jsonb)
        FROM public.modifier_option mo
        JOIN public.modifier_group mg ON mg.id = mo.modifier_group_id
        JOIN public.brand b ON b.id = mg.brand_id
       WHERE mo.id = ANY(v_reactivar)
    ),
    -- 🔴 EL PARTE DE LA PASADA LAS LLEVA CON NOMBRE. Sin esto, una pasada que
    -- deshace tres decisiones se lee igual que una que no deshace ninguna.
    'reencendidas_sobre_una_persona',        v_deshechas,
    'reencendidas_sobre_una_persona_a_hacer', COALESCE(array_length(v_volver_persona, 1), 0),
    'reencendidas_sobre_una_persona_cuales', v_deshechas_json,
    'codigos_rescatables',  v_rescatables,
    'codigos_rescatados',   v_rescatados,
    'retiradas_sin_codigo', v_sin_codigo,
    'marcas_frenadas',    v_frenadas,
    'avisos_encolados',   v_avisados,
    'avisos_callados_por_antirruido', v_callados,
    'sin_referencia_no_tocadas',      v_sin_ref,
    'freno',  jsonb_build_object('max_por_marca', p_max_por_marca, 'max_pct', p_max_pct),
    'marcas', v_marcas
  );
END;
$fn$;


-- ── ④ EL ENSAYO, EN ESTA MISMA TRANSACCIÓN ─────────────────────────────────
--
-- La línea de base se toma AQUÍ dentro (Julio, 13/09 21:05): diferencias con
-- la misma vara a los dos lados, no cifras absolutas. Y esto SÍ escribe en
-- `modifier_option`, así que se ensaya por su CAMINO --apagar y encender de
-- verdad-- y no por su fórmula (regla 10). Todo se deshace al final: si algo
-- no cuadra, la migración entera se cae y no queda nada.

DO $ensayo$
DECLARE
  v_acc    uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_op     uuid;
  v_nombre text;
  v_antes  bigint;
  v_at     timestamptz;
  v_sobre  text;
  v_by     text;
BEGIN
  SELECT count(*) INTO v_antes FROM public.modifier_option WHERE account_id = v_acc;

  -- Una opción ENCENDIDA cualquiera de la cuenta. Población real (regla 31):
  -- no se inventa una fila de laboratorio, se usa una de verdad.
  SELECT mo.id, mo.name INTO v_op, v_nombre
    FROM public.modifier_option mo
   WHERE mo.account_id = v_acc AND mo.is_active
   ORDER BY mo.id LIMIT 1;
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'No hay ni una opcion encendida en la cuenta: el ensayo no se puede hacer, y eso ES el hallazgo.';
  END IF;

  -- CAMINO 1 · una persona la apaga (nadie declara quién).
  UPDATE public.modifier_option SET is_active = false WHERE id = v_op;
  SELECT deactivated_by, reencendida_at INTO v_by, v_at
    FROM public.modifier_option WHERE id = v_op;
  IF v_by <> 'persona' THEN
    RAISE EXCEPTION 'Al apagarla sin decir quien tenia que quedar «persona» y quedo «%».', v_by;
  END IF;
  IF v_at IS NOT NULL THEN
    RAISE EXCEPTION 'Una opcion apagada no puede llevar marca de reencendido.';
  END IF;

  -- CAMINO 2 · el importador la vuelve a encender por encima de esa persona.
  UPDATE public.modifier_option
     SET is_active = true, reencendida_sobre = 'persona' WHERE id = v_op;
  SELECT reencendida_at, reencendida_sobre, deactivated_by INTO v_at, v_sobre, v_by
    FROM public.modifier_option WHERE id = v_op;
  IF v_at IS NULL OR v_sobre <> 'persona' THEN
    RAISE EXCEPTION 'La marca de «te lo he deshecho» no se ha puesto: at=%, sobre=%.', v_at, v_sobre;
  END IF;
  IF v_by IS NOT NULL THEN
    RAISE EXCEPTION 'El sello de apagado tenia que borrarse al encenderla y quedo «%».', v_by;
  END IF;

  -- CAMINO 3 · la persona la vuelve a apagar: la marca se limpia, porque ya
  -- no es verdad.
  UPDATE public.modifier_option SET is_active = false WHERE id = v_op;
  SELECT reencendida_at, reencendida_sobre INTO v_at, v_sobre
    FROM public.modifier_option WHERE id = v_op;
  IF v_at IS NOT NULL OR v_sobre IS NOT NULL THEN
    RAISE EXCEPTION 'La marca tenia que limpiarse al volver a apagarla.';
  END IF;

  -- CAMINO 4 · una persona la enciende ella misma: no se marca nada.
  UPDATE public.modifier_option SET is_active = true WHERE id = v_op;
  SELECT reencendida_at, reencendida_sobre, deactivated_by INTO v_at, v_sobre, v_by
    FROM public.modifier_option WHERE id = v_op;
  IF v_at IS NOT NULL OR v_sobre IS NOT NULL OR v_by IS NOT NULL THEN
    RAISE EXCEPTION 'Encenderla una persona no puede dejar ninguna marca: at=%, sobre=%, by=%.', v_at, v_sobre, v_by;
  END IF;

  -- Y la fila queda como estaba: encendida, sin sellos. Ni una fila de mas.
  IF (SELECT count(*) FROM public.modifier_option WHERE account_id = v_acc) <> v_antes THEN
    RAISE EXCEPTION 'Se han creado o borrado filas y esta migracion no crea ninguna.';
  END IF;

  RAISE NOTICE 'ENSAYO OK · los cuatro caminos sobre «%» · filas %', v_nombre, v_antes;
END;
$ensayo$;
