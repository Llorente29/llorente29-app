-- ══════════════════════════════════════════════════════════════════════════
-- Estándar de alertas · paso 3 — `ingesta_silencio` por LOCAL, con el veto del
-- horario y el texto nuevo
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Depende de 20260909120857 (ya aplicada): usa `encolar_alerta`.
-- Nombre provisional: se renombra a la versión que registre la base (regla 17).
--
-- ── ES `CREATE OR REPLACE`, Y ESO ESTÁ COMPROBADO, NO SUPUESTO ────────────
-- La firma NO cambia: `(p_min_punta integer, p_min_valle integer,
-- p_debounce_window interval)`, defaults `30, 60, '02:00:00'::interval`,
-- `returns integer`, SECURITY DEFINER, `search_path=public`. Idénticos a los
-- vivos, leídos de `pg_proc` antes de escribir. Por eso no hay sobrecarga
-- posible (regla 2) y el cron `ingesta-silencio-watchdog` sigue llamándola sin
-- argumentos igual que hoy.
--
-- ── EL ENSAYO: 43 AVISOS PASAN A 9, Y LOS 9 DICEN EL LOCAL ────────────────
-- Simulado tick a tick —cada 10 minutos, como corre de verdad— sobre los 7 días
-- que caben en la cola, con las MISMAS funciones que usa este código
-- (`is_brand_open`, `availability_location_open_minutes`) y no con una
-- reimplementación de su lógica:
--
--   local                sev      avisaría       peor silencio   anclaje
--   Carabanchel          critico  02/09 22:30      41 min        22:40 (*)
--   Carabanchel          critico  03/09 20:30      30 min        21:30
--   Carabanchel          alto     04/09 16:50     146 min        15:44
--   Alcalá               alto     04/09 18:40      60 min        17:39
--   Carabanchel          critico  04/09 23:40      32 min        23:07
--   Carabanchel          alto     05/09 18:40      67 min        17:32
--   Alcalá               critico  06/09 22:10      31 min        21:39
--   Carabanchel          critico  07/09 21:10     113 min        20:37
--   Alcalá               critico  07/09 23:10      38 min        22:32
--
-- Nueve, contra 43. Y los dos gordos —146 min en Carabanchel el 04/09 y 113 el
-- 07/09— son cortes de verdad en pleno servicio: eso es lo que un aviso tiene
-- que decir.
--
-- (*) El «peor silencio» y el anclaje son de todo el episodio, no del instante
--     del primer aviso; por eso el anclaje puede ser posterior a la hora del
--     aviso en un episodio con varios ticks.
--
-- ── LOS UMBRALES SON UNA DECISIÓN, ASÍ QUE VA LA TABLA ────────────────────
-- Cinco de los nueve rozan el umbral (30, 31, 32, 38, 41 min). Con la misma
-- simulación, cambiando sólo los umbrales:
--
--        valle→   60    75    90   120
--   punta 30       9     7     7     7      ← los de hoy
--   punta 40       5     3     3     3
--   punta 45       4     2     2     2
--   punta 60       4     2     2     2
--
-- **Esta migración NO cambia los umbrales**: se quedan en 30/60, los de hoy.
-- Subirlos es una decisión de Julio sobre cuánto silencio en cena es tolerable,
-- y ahora tiene la cifra delante para tomarla. Se cambian pasando argumentos al
-- cron, sin tocar la función.
--
-- ── QUÉ CAMBIA, PUNTO POR PUNTO ──────────────────────────────────────────
--
-- 1. POR LOCAL, NO POR CUENTA. Era `select distinct account_id from sale`, sin
--    filtrar (regla 9): los dos avisos de las 20:00 del 08/09 eran dos cuentas
--    distintas e indistinguibles en la bandeja. Ahora recorre LOCALES, y el
--    aviso lleva `account_id` y `location_id` como CAMPOS.
--
-- 2. EL VETO ES EL HORARIO, Y NO SE REESCRIBE. Fuera la franja fija 12–23. Se
--    llama a `is_brand_open(local, NULL, now())`, que ya convierte a Madrid,
--    prioriza la excepción sobre el horario normal, entiende los tramos que
--    cruzan medianoche y, con marca NULL, responde por el local. Comprobado
--    llamándola: el martes a las 18:50 devuelve `false` para Alcalá y para
--    Carabanchel. **El veto habría callado la alerta que disparó el encargo.**
--
-- 3. EL SILENCIO SE CUENTA DESDE LA APERTURA DEL TRAMO EN CURSO, no desde las
--    12:00 fijas. Es el parche del 08/09 hecho bien: aquél usaba «las 12:00 de
--    hoy» para toda la cuenta; éste usa la apertura real del tramo de ESE local.
--
-- 4. SE CIERRA EL SILENCIO DEL §6.1. Hoy, si no hay NINGUNA venta en 12 h,
--    `v_ultima` es NULL y el vigía CALLA: una caída larga es invisible. Ahora,
--    sin ventas desde que abrió, el ancla es la apertura y **sí avisa**. Es el
--    caso más grave y era justo el que no se veía.
--
-- 5. QUIÉN SE VIGILA, Y POR QUÉ ASÍ. Local activo, de cuenta no interna, no
--    suspendida ni archivada ni borrada, CON HORARIO CARGADO y con ventas en 7
--    días. Anclado por `account_id` y `location.id`, **nunca por nombre**: la
--    cuenta plantilla tiene tres locales con los mismos nombres, y «Plaza
--    Castilla» está `active=false` en Foodint y `active=true` en la plantilla.
--    Ese criterio deja hoy exactamente Alcalá y Carabanchel, y deja fuera:
--      · los 3 de la plantilla ...... `is_internal` (y 0 ventas)
--      · Plaza Castilla ............. `active=false`
--      · Kitchen Grill LstQ ......... sin horario cargado
--    Lo de Kitchen Grill no es un apaño para que cuadre con «esa cuenta está
--    parada»: es que SIN HORARIO NO SE PUEDE APLICAR EL VETO, y vigilar sin
--    veto es volver a la franja fija. Un local sin horario no se vigila.
--
-- 6. …PERO NO SE CALLA QUE NO SE VIGILA (§4.2). Los locales activos, con
--    ventas y SIN horario salen en un aviso `info` UNA VEZ AL DÍA. Hoy es una
--    línea: Kitchen Grill LstQ.
--    ⚠️ JULIO, ESTO ES UNA DECISIÓN Y LA MARCO: puede leerse como que la cuenta
--    parada genera un correo diario, que es justo lo que no quieres. Lo he
--    puesto en `info` —el escalón que el §4.4 dice que no interrumpe— porque la
--    alternativa es que el vigía calle sobre su propio punto ciego, que es el
--    §6 entero. Si prefieres que no salga, se quita borrando el bloque marcado
--    «AVISO DE COBERTURA» al final: una sola cosa que borrar, sin tocar nada más.
--
-- 7. EL TEXTO, AL §5. Asunto `[Negocio · Local] QUÉ pasa — desde cuándo`, con
--    el nombre del local sin repetir el del negocio («Foodint Alcalá» dentro de
--    la cuenta «Foodint» se pinta «Alcalá»). Cuerpo: qué local, abierto y hasta
--    cuándo, desde cuándo, último pedido, si las otras tiendas sí reciben, y UNA
--    acción. Sin «POS», sin «ingesta», sin «fuente dominante».
--
-- 8. SEVERIDAD DE VERDAD: `critico` en cena (≥20 h), `alto` en el resto,
--    `aviso` para la vía que se queda muda. Va como CAMPO, no en el asunto.
--
-- ── LO QUE NO CAMBIA, A PROPÓSITO ────────────────────────────────────────
-- · El antirruido: misma clave por local+severidad+día y la misma ventana.
--   Sólo cambia que la clave lleva el LOCAL en vez de la cuenta, que es lo que
--   permite que un corte en Alcalá no tape uno en Carabanchel.
-- · La rama de «la vía que más pedidos trae, muda» sigue existiendo, ahora por
--   local. El ensayo de arriba NO la simula: cubre la rama de «no entra nada»,
--   que es la que producía el ruido. Esa rama puede añadir algún aviso más.
-- · El drenaje y la edge del correo no se tocan: el asunto y el cuerpo los sigue
--   escribiendo esta función. La plantilla única es el paso 4.
-- ══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.ingesta_silencio_watchdog(
  p_min_punta       integer  default 30,
  p_min_valle       integer  default 60,
  p_debounce_window interval default '02:00:00'::interval
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $watchdog$
DECLARE
  v_loc        record;
  v_n          integer := 0;
  v_hoy        date;
  v_hora       integer;
  v_apertura   timestamptz;
  v_cierre     timestamptz;
  v_exc_ap     timestamptz;
  v_exc_ci     timestamptz;
  v_ultima     timestamptz;
  v_ancla      timestamptz;
  v_mudo       integer;
  v_umbral     integer;
  v_sev        text;
  v_corto      text;
  v_otras      integer;
  v_sin_hora   text[] := '{}';
  v_dominante  text;
  v_pct        numeric;
  v_ultima_dom timestamptz;
  v_mudo_dom   integer;
BEGIN
  v_hoy  := (now() at time zone 'Europe/Madrid')::date;
  v_hora := extract(hour from (now() at time zone 'Europe/Madrid'));

  FOR v_loc IN
    SELECT l.id, l.name, l.account_id, a.name AS cuenta,
           EXISTS (SELECT 1 FROM public.business_hours bh WHERE bh.location_id = l.id) AS tiene_horario
      FROM public.locations l
      JOIN public.accounts a ON a.id = l.account_id
     WHERE l.active
       AND a.is_internal IS NOT TRUE
       AND a.status = 'active'
       AND a.suspended_at IS NULL AND a.archived_at IS NULL AND a.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.sale s
                    WHERE s.location_id = l.id AND s.sold_at >= now() - interval '7 days')
     ORDER BY a.name, l.name
  LOOP
    -- Sin horario no hay veto posible, y vigilar sin veto es la franja fija
    -- otra vez. No se vigila — pero se dice, abajo.
    IF NOT v_loc.tiene_horario THEN
      v_sin_hora := v_sin_hora || (v_loc.cuenta || ' · ' || v_loc.name);
      CONTINUE;
    END IF;

    -- ── EL VETO ───────────────────────────────────────────────────────────
    CONTINUE WHEN NOT public.is_brand_open(v_loc.id, NULL, now());

    -- ── La apertura del tramo EN CURSO, que es el ancla del silencio ──────
    SELECT o.opened_from, o.opened_until INTO v_apertura, v_cierre
      FROM public.availability_location_open_minutes(
             v_loc.id, now() - interval '18 hours', now() + interval '12 hours') o
     WHERE o.opened_from <= now() AND o.opened_until > now()
     ORDER BY o.opened_from DESC
     LIMIT 1;

    -- Si hoy hay una excepción que ABRE en otro horario, manda ella (misma
    -- precedencia que `is_brand_open`). Hoy no existe ninguna en toda la tabla
    -- —las 92 que hay son cierres, y todas de un local inactivo— pero sin esto
    -- el ancla saldría del horario normal el día que aparezca la primera.
    -- Se lee aparte y sólo pisa si hay fila: un SELECT INTO sin resultados
    -- pone NULL, y eso se llevaría por delante lo que acabamos de calcular.
    SELECT (v_hoy + e.open_time) AT TIME ZONE 'Europe/Madrid',
           CASE WHEN e.close_time <= e.open_time
                THEN (v_hoy + 1 + e.close_time) AT TIME ZONE 'Europe/Madrid'
                ELSE (v_hoy + e.close_time) AT TIME ZONE 'Europe/Madrid' END
      INTO v_exc_ap, v_exc_ci
      FROM public.business_hours_exception e
     WHERE e.location_id = v_loc.id
       AND e.exception_date = v_hoy
       AND e.is_closed = false
       AND e.open_time IS NOT NULL AND e.close_time IS NOT NULL
     ORDER BY (e.brand_id IS NOT NULL) DESC
     LIMIT 1;
    IF v_exc_ap IS NOT NULL THEN
      v_apertura := v_exc_ap;
      v_cierre   := v_exc_ci;
    END IF;

    -- No se inventa un ancla: si el horario dice abierto pero no sabemos desde
    -- cuándo, no se avisa. Es preferible callar UNA pasada a contar minutos
    -- desde una hora que no es.
    CONTINUE WHEN v_apertura IS NULL;

    -- ── Cuánto lleva mudo ────────────────────────────────────────────────
    SELECT max(s.sold_at) INTO v_ultima
      FROM public.sale s
     WHERE s.location_id = v_loc.id AND s.sold_at >= v_apertura;

    -- Sin ventas desde que abrió, el ancla es la apertura. Aquí se cierra el
    -- punto ciego: antes eso era NULL y el vigía callaba.
    v_ancla := greatest(coalesce(v_ultima, v_apertura), v_apertura);
    v_mudo  := round(extract(epoch from (now() - v_ancla)) / 60);

    IF v_hora >= 20 THEN
      v_umbral := greatest(coalesce(p_min_punta, 30), 5);
      v_sev    := 'critico';
    ELSE
      v_umbral := greatest(coalesce(p_min_valle, 60), 5);
      v_sev    := 'alto';
    END IF;

    v_corto := CASE WHEN v_loc.name LIKE v_loc.cuenta || ' %'
                    THEN substr(v_loc.name, length(v_loc.cuenta) + 2)
                    ELSE v_loc.name END;

    -- ── 1) EL LOCAL, MUDO ────────────────────────────────────────────────
    IF v_mudo >= v_umbral THEN
      SELECT count(*) INTO v_otras
        FROM public.locations l2
       WHERE l2.account_id = v_loc.account_id AND l2.id <> v_loc.id AND l2.active
         AND EXISTS (SELECT 1 FROM public.sale s
                      WHERE s.location_id = l2.id
                        AND s.sold_at > now() - make_interval(mins => v_umbral));

      PERFORM public.encolar_alerta(
        p_kind    => 'ingesta_silencio',
        p_subject => '[' || v_loc.cuenta || ' · ' || v_corto || '] Sin pedidos desde hace '
                     || v_mudo::text || ' min — está abierto',
        p_message =>
          v_corto || ' lleva ' || v_mudo::text || ' min sin ningún pedido y ahora mismo está abierto'
          || coalesce(' (cierra a las ' || to_char(v_cierre at time zone 'Europe/Madrid', 'HH24:MI') || ')', '')
          || '.' || chr(10)
          || CASE WHEN v_ultima IS NULL
                  THEN 'No ha entrado ninguno desde que abrió, a las '
                       || to_char(v_apertura at time zone 'Europe/Madrid', 'HH24:MI') || '.'
                  ELSE 'Último pedido: '
                       || to_char(v_ultima at time zone 'Europe/Madrid', 'HH24:MI') || '.' END
          || CASE WHEN v_otras > 0
                  THEN ' Las otras tiendas sí están recibiendo, así que no parece la cocina.'
                  ELSE '' END
          || chr(10) || chr(10)
          || 'Revisa la conexión de la caja en ' || v_corto || ' (paneles de Glovo y Uber).',
        p_debounce_kind   => 'ingesta_silencio_' || v_loc.id::text || '_' || v_sev || '_'
                             || to_char(v_hoy, 'YYYYMMDD'),
        p_debounce_window => p_debounce_window,
        p_account_id      => v_loc.account_id,
        p_location_id     => v_loc.id,
        p_brand_id        => NULL,
        p_severity        => v_sev
      );
      v_n := v_n + 1;
      CONTINUE;  -- si no entra NADA, no tiene sentido avisar además por vía
    END IF;

    -- ── 2) LA VÍA QUE MÁS PEDIDOS TRAE, MUDA ─────────────────────────────
    SELECT s.source, round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1)
      INTO v_dominante, v_pct
      FROM public.sale s
     WHERE s.location_id = v_loc.id AND s.sold_at >= now() - interval '7 days'
     GROUP BY s.source
     ORDER BY count(*) DESC
     LIMIT 1;

    CONTINUE WHEN v_dominante IS NULL OR coalesce(v_pct, 0) < 60;

    SELECT max(s.sold_at) INTO v_ultima_dom
      FROM public.sale s
     WHERE s.location_id = v_loc.id AND s.source = v_dominante AND s.sold_at >= v_apertura;

    v_mudo_dom := round(extract(epoch from (now() - greatest(coalesce(v_ultima_dom, v_apertura), v_apertura))) / 60);

    IF v_mudo_dom >= greatest(coalesce(p_min_valle, 60), 5) THEN
      PERFORM public.encolar_alerta(
        p_kind    => 'ingesta_silencio',
        p_subject => '[' || v_loc.cuenta || ' · ' || v_corto || '] ' || v_dominante
                     || ' lleva ' || v_mudo_dom::text || ' min sin traer pedidos',
        p_message =>
          'En ' || v_corto || ', ' || v_dominante || ' trae el ' || v_pct::text
          || ' % de los pedidos y lleva ' || v_mudo_dom::text
          || ' min sin traer ninguno, mientras otras vías sí están entrando.' || chr(10)
          || CASE WHEN v_ultima_dom IS NULL
                  THEN 'No ha traído ninguno desde que abrió.'
                  ELSE 'Último suyo: ' || to_char(v_ultima_dom at time zone 'Europe/Madrid','HH24:MI') || '.' END
          || chr(10) || chr(10)
          || 'Suele ser la conexión de esa vía, no la cocina.',
        p_debounce_kind   => 'ingesta_via_' || v_loc.id::text || '_' || v_dominante || '_'
                             || to_char(v_hoy, 'YYYYMMDD'),
        p_debounce_window => p_debounce_window,
        p_account_id      => v_loc.account_id,
        p_location_id     => v_loc.id,
        p_brand_id        => NULL,
        p_severity        => 'aviso'
      );
      v_n := v_n + 1;
    END IF;
  END LOOP;

  -- ── AVISO DE COBERTURA — bórrame entero si Julio no lo quiere ───────────
  -- Un vigía que no dice lo que NO mira da la sensación de que mira todo. Va en
  -- `info` y una vez al día. Hoy es una línea: Kitchen Grill LstQ.
  IF array_length(v_sin_hora, 1) > 0 THEN
    PERFORM public.encolar_alerta(
      p_kind    => 'ingesta_silencio',
      p_subject => 'Sin vigilar por falta de horario: ' || array_length(v_sin_hora, 1)::text || ' local(es)',
      p_message =>
        'Estos locales tienen ventas y están activos, pero no tienen horario cargado, así que '
        || 'no se puede saber si deberían estar recibiendo pedidos. NO se vigilan:' || chr(10)
        || '· ' || array_to_string(v_sin_hora, chr(10) || '· ') || chr(10) || chr(10)
        || 'Cárgales el horario y empiezan a vigilarse solos.',
      p_debounce_kind   => 'ingesta_sin_horario_' || to_char(v_hoy, 'YYYYMMDD'),
      p_debounce_window => interval '24 hours',
      p_account_id      => NULL,
      p_location_id     => NULL,
      p_brand_id        => NULL,
      p_severity        => 'info'
    );
  END IF;
  -- ── fin del bloque borrable ────────────────────────────────────────────

  RETURN v_n;
END;
$watchdog$;

-- Permisos: `CREATE OR REPLACE` conserva el ACL, pero se reafirma. La función
-- la llama pg_cron como owner; nadie más tiene por qué alcanzarla.
revoke execute on function public.ingesta_silencio_watchdog(integer, integer, interval)
  from public, anon, authenticated;

-- ── Verificación DENTRO de la transacción ─────────────────────────────────
DO $verifica$
DECLARE
  v_oid oid;
  v_n   integer;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='ingesta_silencio_watchdog';

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='ingesta_silencio_watchdog') <> 1 THEN
    RAISE EXCEPTION 'ingesta_silencio_watchdog tiene mas de una firma (regla 2)';
  END IF;
  IF pg_get_function_identity_arguments(v_oid) <> 'p_min_punta integer, p_min_valle integer, p_debounce_window interval' THEN
    RAISE EXCEPTION 'la firma ha cambiado: %', pg_get_function_identity_arguments(v_oid);
  END IF;
  IF pg_get_expr((SELECT proargdefaults FROM pg_proc WHERE oid=v_oid), 0) <> '30, 60, ''02:00:00''::interval' THEN
    RAISE EXCEPTION 'los defaults han cambiado: %', pg_get_expr((SELECT proargdefaults FROM pg_proc WHERE oid=v_oid), 0);
  END IF;
  IF pg_get_function_result(v_oid) <> 'integer' THEN
    RAISE EXCEPTION 'ya no devuelve integer: %', pg_get_function_result(v_oid);
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_oid) THEN
    RAISE EXCEPTION 'ha perdido SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon puede ejecutar el vigia';
  END IF;

  -- Que CORRE, sin argumentos, igual que la llama el cron. Cualquier fila que
  -- encole aqui es real y se queda: si el vigia tiene algo que decir ahora
  -- mismo, que lo diga.
  SELECT public.ingesta_silencio_watchdog() INTO v_n;
  RAISE NOTICE 'ingesta_silencio_watchdog: corre y ha encolado % aviso(s).', v_n;

  -- Y que lo que encole lleve el local, que es la razon de todo esto.
  IF EXISTS (
    SELECT 1 FROM public.system_alert_queue
     WHERE kind='ingesta_silencio' AND created_at > now() - interval '1 minute'
       AND severity IS DISTINCT FROM 'info' AND location_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ha encolado un aviso de local SIN location_id: es justo el bug que esto venia a arreglar';
  END IF;
END;
$verifica$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR
--
-- 1) Que sigue corriendo cada 10 min sin fallar:
--   select status, count(*), max(start_time at time zone 'Europe/Madrid')
--     from cron.job_run_details where jobid = 53 and start_time > now() - interval '1 hour'
--    group by 1;
--
-- 2) Que TODO aviso de local lleva el local (la vara del §1 del encargo):
--   select kind, severity,
--          count(*) filter (where location_id is null) as mudos, count(*)
--     from public.system_alert_queue
--    where created_at > now() - interval '7 days' group by 1,2 order by 4 desc;
--   -- `ingesta_silencio` con severity distinta de 'info' y `mudos` > 0 = bug.
--
-- 3) El antes/después con la MISMA vara (regla 31): 43 avisos de
--    `ingesta_silencio` en los 6,8 días anteriores; a los 7 días de aplicar,
--    contar otra vez sobre 6,8 días. La simulación dice 9.
-- ══════════════════════════════════════════════════════════════════════════
