-- ══════════════════════════════════════════════════════════════════════════
-- Estándar de alertas · paso 6, fase 1 — `db-health` dice QUÉ local, y el vigía
-- de silencio deja de fiarse de una bandera
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. **VA DESPUÉS de `PENDIENTE_alertas_plantilla_unica.sql`** (el
-- paso 4): reescribe `ingesta_silencio_watchdog` partiendo del cuerpo que deja
-- aquélla. Aplicarla antes dejaría el prefijo `[Negocio · Local]` otra vez
-- escrito a mano dentro de los asuntos. Nombre provisional (regla 17).
--
-- ── POR QUÉ `db-health` VA EL PRIMERO DE LOS DIECISÉIS ───────────────────
-- Por el ruido medido, no por orden alfabético: es el segundo emisor de la cola
-- y su aviso del 09/09 a las 14:31 decía, literalmente, «Pedido(s) aceptado(s)
-- sin impresora activa EN EL LOCAL» — sin decir cuál. El vigía no lo sabía:
-- contaba filas de `print_route_failure_log` sin agrupar.
--
-- Y la tabla YA TRAE `account_id` y `location_id`. No había que buscarlos en
-- ningún sitio: había que dejar de tirarlos.
--
-- ── DOS CORRECCIONES A LA MEDICIÓN DEL ENCARGO, Y LAS DOS SON DE REGLA 9 ──
-- El encargo dice «85 avisos en 14 días desde el 26/08, y los 85 son del MISMO
-- local». Medido sobre la tabla entera:
--
--   Kitchen Grill LstQ · Kitchen Grill LstQ .... 96 avisos · 12/08 → 09/09
--   Folvy Interno · Foodint Alcalá .............  2 avisos · 11/08 → 15/08
--   ───────────────────────────────────────────────────────────────────────
--   total ...................................... 98
--
-- Son 98 y no 85, empiezan el 12/08 y no el 26/08, y **no son todos del mismo
-- local**: hay dos de la cuenta plantilla. La conclusión del encargo no cambia
-- —el aviso sigue sin decir dónde, que es el problema— pero la cifra sí, y es
-- otra vez el mismo patrón: un `count(*)` sin cuenta mezcla producción con la
-- plantilla.
--
-- ── Y UN FALLO DEL VIGÍA QUE NADIE HABÍA VISTO ───────────────────────────
-- El antirruido de este aviso era GLOBAL:
--
--   not exists (select 1 from db_health_alert_log
--                where kind = 'db-health-print-no-active-printer'
--                  and sent_at >= now() - interval '60 minutes')
--
-- O sea que **un local tapaba al otro**: si Kitchen Grill fallaba, un fallo
-- simultáneo en Alcalá no avisaba en una hora. Con la clave por local, cada uno
-- avisa por su cuenta. Esto no estaba en el encargo; sale de leer el bloque.
--
-- ── EL CRITERIO DEL VIGÍA DE SILENCIO: LO QUE VENDE, NO LA BANDERA ───────
-- Escribí en el estándar «sólo se vigilan locales ACTIVOS» y estaba mal. El
-- caso que lo tumba está medido:
--
--   cuenta               local                bandera  ventas 30d   importe   tramos
--   Kitchen Grill LstQ   Kitchen Grill LstQ   FALSE       138       3.254 €      0
--
-- Con aquella vara, un local que factura 3.254 € al mes **no se vigila nunca**.
-- La bandera la mantiene una persona; las ventas no mienten. Así que el filtro
-- pasa a ser la actividad, y «vende con la bandera apagada» genera su propio
-- aviso — no es una razón para callar, es la noticia.
--
-- ── PERO LA REGLA LITERAL DEL ENCARGO SE PASA DE FRENADA, Y HAY QUE DECIRLO ──
-- «Si un local tiene ventas, está operando» aplicado tal cual mete dentro a la
-- CUENTA PLANTILLA: `Folvy Interno · Foodint Alcalá` tiene **1 venta de 28,60 €
-- del 11/08**. Una venta hace cinco semanas no es un local operando.
--
-- Por eso el corte es **ventas en los últimos 7 días**, que separa limpiamente
-- lo que hay hoy sin inventar un umbral de dinero:
--   Alcalá, Carabanchel, Kitchen Grill .... dentro (venden hoy)
--   la plantilla .......................... fuera (última venta, 11/08)
-- Y además se mantiene `is_internal IS NOT TRUE`, que es el cinturón.
--
-- ── EL ESTADO DE CUENTA SÍ SE RESPETA, Y EL AVISO NUEVO NO ───────────────
-- `status`, `suspended_at`, `archived_at` y `deleted_at` no son banderas
-- olvidadas: son decisiones con fecha y motivo. El bucle las respeta.
--
-- Pero el aviso de «vende con la bandera apagada» se mira APARTE y SIN ese
-- filtro, a propósito: **una cuenta suspendida que sigue vendiendo es justo la
-- noticia**. Filtrando por `status='active'` ahí, el único caso que existe hoy
-- —el que destapó todo esto— sería invisible. Es un estado, no un suceso, así
-- que la clave del antirruido va por la LISTA y no por la fecha.
--
-- ── LAS FIRMAS NO CAMBIAN (regla 2) ──────────────────────────────────────
--   `db_health_watchdog()` ............... sin argumentos, `void`, una firma
--   `ingesta_silencio_watchdog(int,int,interval)` ... defaults 30, 60, '02:00:00'
-- Las dos por `CREATE OR REPLACE` sin tocar la firma. El de db-health, además,
-- por ANCLA: su cuerpo vivo NO ESTÁ EN EL REPO —deuda de la regla 1, anotada—
-- así que reescribirlo entero exigiría transcribir 5.861 caracteres a mano, que
-- es la mejor forma de perder por el camino algo que nadie pidió cambiar.
--
-- ── LO QUE NO SE TOCA, Y POR QUÉ SE DICE ─────────────────────────────────
-- Los avisos 4 y 5 de `db_health_watchdog` («print_job atascados >2h» y
-- «encolados a impresora INACTIVA») TAMBIÉN hablan de un local y TAMPOCO lo
-- dicen. No entran aquí para no tocar tres bloques del mismo cuerpo en una
-- pasada; van en la fase siguiente, con su ensayo. Queda escrito para que no se
-- dé por hecho que `db-health` ya está migrado: está a un tercio.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. db-health · aviso 6, por LOCAL ─────────────────────────────────────
DO $ancla$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 6 — pedidos aceptados sin ninguna impresora activa
    select count(*) into v_route_failures
    from public.print_route_failure_log
    where created_at >= now() - interval '10 minutes';
    if v_route_failures > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-no-active-printer' and sent_at >= now() - interval '60 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        'Pedido(s) aceptado(s) sin impresora activa en el local',
        'db_health_watchdog detecto ' || v_route_failures || ' aviso(s) en print_route_failure_log de los ultimos 10 minutos.',
        'db-health-print-no-active-printer'
      );
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 6 — pedidos aceptados sin ninguna impresora activa, POR LOCAL.
    -- `print_route_failure_log` ya trae account_id y location_id: no habia que
    -- buscarlos, habia que dejar de tirarlos. El antirruido va por local, que
    -- antes era global y un local tapaba al otro durante una hora.
    --
    -- `perform ... from (...)` llama a encolar_alerta una vez por fila sin
    -- declarar variables nuevas: el resto de este cuerpo no se toca.
    select count(*) into v_route_failures
    from public.print_route_failure_log
    where created_at >= now() - interval '10 minutes';
    if v_route_failures > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Pedidos aceptados y sin imprimir: no hay ninguna impresora activa',
        p_message =>
          t.n || ' pedido(s) se han aceptado en los ultimos 10 minutos y no se han podido '
          || 'enviar a imprimir: el local no tiene ninguna impresora activa dada de alta.'
          || chr(10) || chr(10)
          || 'El pedido esta cocinandose sin ticket. Da de alta una impresora en ese local, '
          || 'o marcala como activa si ya existe.',
        p_debounce_kind   => 'db-health-print-no-active-printer_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      )
      from (select f.account_id, f.location_id, count(*) as n
              from public.print_route_failure_log f
             where f.created_at >= now() - interval '10 minutes'
             group by f.account_id, f.location_id) t;
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'no existe db_health_watchdog';
  END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 6 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla$;

-- ── 2. El vigía de silencio: la actividad manda sobre la bandera ──────────
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
  v_vende_apagado text[] := '{}';
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
     -- ── EL CRITERIO YA NO ES LA BANDERA, ES LA ACTIVIDAD (09/09) ────────
     -- Escribí «sólo locales con `l.active`» y estaba mal, y se vio con un
     -- caso: un local con la bandera apagada desde el 18/06 facturando 3.254 €
     -- en 30 días. Con aquella vara no se habría vigilado NUNCA mientras
     -- facturaba. La bandera la mantiene una persona; las ventas no mienten.
     -- Y que la bandera diga lo contrario es un aviso en sí mismo — está
     -- abajo, en su propio bloque.
     --
     -- El estado de la CUENTA sí se respeta: eso no es una bandera olvidada,
     -- es una decisión de negocio con fecha y motivo escritos.
     WHERE a.is_internal IS NOT TRUE
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
        p_subject => 'Sin pedidos desde hace ' || v_mudo::text || ' min — está abierto',
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
        p_subject => v_dominante || ' lleva ' || v_mudo_dom::text || ' min sin traer pedidos',
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

  -- ── VENDE CON LA BANDERA APAGADA ───────────────────────────────────────
  -- Se mira APARTE y SIN el filtro de estado de cuenta, a propósito: una cuenta
  -- suspendida que sigue vendiendo es justo la noticia, no algo que callar. Si
  -- se filtrara aquí por `status='active'`, el único caso que existe hoy —el que
  -- destapó todo esto— sería invisible.
  --
  -- Es un ESTADO, no un suceso, así que la clave del antirruido va por la LISTA
  -- de locales y no por la fecha: sólo vuelve a sonar si la lista cambia.
  SELECT coalesce(array_agg(t.linea ORDER BY t.linea), '{}')
    INTO v_vende_apagado
    FROM (
      SELECT a2.name || ' · ' || l2.name || ' — ' || cnt.n || ' venta(s) en 7 días' AS linea
        FROM public.locations l2
        JOIN public.accounts a2 ON a2.id = l2.account_id
        JOIN LATERAL (SELECT count(*) AS n FROM public.sale s2
                       WHERE s2.location_id = l2.id
                         AND s2.sold_at >= now() - interval '7 days') cnt ON cnt.n > 0
       WHERE l2.active = false
         AND a2.is_internal IS NOT TRUE
         AND a2.archived_at IS NULL AND a2.deleted_at IS NULL
    ) t;

  IF array_length(v_vende_apagado, 1) > 0 THEN
    PERFORM public.encolar_alerta(
      p_kind    => 'ingesta_silencio',
      p_subject => 'Vende con el local apagado en Folvy: '
                   || array_length(v_vende_apagado, 1)::text || ' local(es)',
      p_message =>
        'Estos locales están marcados como INACTIVOS en Folvy y aun así han entrado ventas suyas '
        || 'en los últimos 7 días:' || chr(10)
        || '· ' || array_to_string(v_vende_apagado, chr(10) || '· ') || chr(10) || chr(10)
        || 'Mientras la bandera diga inactivo, ese local queda fuera de las pantallas y de los '
        || 'vigías que la miran. O el local se reactiva, o hay que dejar de aceptarle ventas: '
        || 'las dos cosas a la vez no se sostienen.',
      p_debounce_kind   => 'ingesta_vende_apagado_' || md5(array_to_string(v_vende_apagado, '|')),
      p_debounce_window => interval '7 days',
      p_account_id      => NULL,
      p_location_id     => NULL,
      p_brand_id        => NULL,
      p_severity        => 'alto'
    );
  END IF;

  -- ── AVISO DE COBERTURA ─────────────────────────────────────────────────
  -- Un vigía que no dice lo que NO mira da la sensación de que mira todo.
  --
  -- ⚠️ CAMBIO SOBRE EL FICHERO DE CODE, decidido por Julio (09/09): Code lo
  -- puso una vez AL DÍA. Diario está mal: esto no cambia de un día para otro y
  -- sería un correo cada mañana sobre lo mismo, que es justo el ruido que se
  -- viene a quitar. La clave de antirruido pasa a ir por la LISTA de locales
  -- afectados, no por la fecha: sólo vuelve a avisar cuando la lista CAMBIA.
  -- Techo real de 7 días, y no es un número elegido: el drenaje borra las filas
  -- enviadas a los 7 días, así que a partir de ahí la clave deja de existir y
  -- vuelve a sonar una vez. Ni calla sobre su punto ciego ni da la lata.
  IF array_length(v_sin_hora, 1) > 0 THEN
    PERFORM public.encolar_alerta(
      p_kind    => 'ingesta_silencio',
      p_subject => 'Sin vigilar por falta de horario: ' || array_length(v_sin_hora, 1)::text || ' local(es)',
      p_message =>
        'Estos locales tienen ventas y están activos, pero no tienen horario cargado, así que '
        || 'no se puede saber si deberían estar recibiendo pedidos. NO se vigilan:' || chr(10)
        || '· ' || array_to_string(v_sin_hora, chr(10) || '· ') || chr(10) || chr(10)
        || 'Cárgales el horario y empiezan a vigilarse solos.',
      p_debounce_kind   => 'ingesta_sin_horario_' || md5(array_to_string(v_sin_hora, '|')),
      p_debounce_window => interval '7 days',
      p_account_id      => NULL,
      p_location_id     => NULL,
      p_brand_id        => NULL,
      p_severity        => 'info'
    );
  END IF;

  RETURN v_n;
END;
$watchdog$;

revoke execute on function public.ingesta_silencio_watchdog(integer, integer, interval)
  from public, anon, authenticated;

-- ── Verificación DENTRO de la transacción ─────────────────────────────────
DO $verifica$
DECLARE
  v_oid oid;
  v_src text;
BEGIN
  -- db-health: una firma, y el aviso 6 ya agrupa y lleva el local.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='db_health_watchdog') <> 1 THEN
    RAISE EXCEPTION 'db_health_watchdog tiene mas de una firma (regla 2)';
  END IF;
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='db_health_watchdog';
  IF pg_get_function_identity_arguments(v_oid) <> '' OR pg_get_function_result(v_oid) <> 'void' THEN
    RAISE EXCEPTION 'db_health_watchdog ha cambiado de forma';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  -- Sin contar espacios a ojo: la primera versión de esta guarda comparaba con
  -- un espacio de más y habría abortado la migración por su cuenta. Lo cazó
  -- probarla; leyéndola no se ve.
  IF v_src NOT LIKE '%=> t.location_id%'
     OR v_src NOT LIKE '%group by f.account_id, f.location_id%' THEN
    RAISE EXCEPTION 'el aviso 6 no lleva el local: es el bug que esto venia a arreglar';
  END IF;
  IF v_src LIKE '%sin impresora activa en el local%' THEN
    RAISE EXCEPTION 'sigue el asunto viejo, el que decia «el local» sin decir cual';
  END IF;
  -- Y que no se ha llevado por delante los otros cinco avisos.
  IF v_src NOT LIKE '%db-health-connections%' OR v_src NOT LIKE '%db-health-print-stuck%'
     OR v_src NOT LIKE '%db-health-print-inactive-printer%' THEN
    RAISE EXCEPTION 'el reemplazo por ancla se ha llevado otros avisos de db_health_watchdog';
  END IF;

  -- El vigía de silencio: firma intacta, criterio nuevo, aviso nuevo.
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='ingesta_silencio_watchdog';
  IF pg_get_function_identity_arguments(v_oid)
       <> 'p_min_punta integer, p_min_valle integer, p_debounce_window interval' THEN
    RAISE EXCEPTION 'la firma del vigia ha cambiado: %', pg_get_function_identity_arguments(v_oid);
  END IF;
  IF pg_get_expr((SELECT proargdefaults FROM pg_proc WHERE oid = v_oid), 0)
       <> '30, 60, ''02:00:00''::interval' THEN
    RAISE EXCEPTION 'los defaults del vigia han cambiado';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  IF v_src LIKE '%WHERE l.active%' THEN
    RAISE EXCEPTION 'el vigia sigue filtrando por la bandera del local';
  END IF;
  IF v_src NOT LIKE '%v_vende_apagado%' THEN
    RAISE EXCEPTION 'falta el aviso de «vende con la bandera apagada»';
  END IF;
  IF v_src NOT LIKE '%is_brand_open%' OR v_src NOT LIKE '%v_sin_hora%' THEN
    RAISE EXCEPTION 'al vigia le falta el veto o el aviso de cobertura';
  END IF;

  RAISE NOTICE 'Paso 6 fase 1: db-health dice el local y el vigia mira la actividad, no la bandera.';
END;
$verifica$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR
--
-- 1) Que el aviso de impresoras ya dice de quién habla. Se dispara solo: hay
--    fallos casi a diario desde el 12/08.
--   select to_char(created_at at time zone 'Europe/Madrid','DD/MM HH24:MI') as cuando,
--          severity, a.name as cuenta, l.name as local, subject
--     from public.system_alert_queue q
--     left join public.accounts a on a.id = q.account_id
--     left join public.locations l on l.id = q.location_id
--    where q.kind = 'db-health' and q.created_at > now() - interval '2 hours'
--    order by q.created_at desc;
--
-- 2) Que «vende con la bandera apagada» sale UNA vez y no cada 10 minutos:
--   select count(*), min(created_at), max(created_at)
--     from public.system_alert_queue
--    where subject like 'Vende con el local apagado%';
--   -- Hoy la lista es de uno: Kitchen Grill LstQ. Cuando se arregle el webhook
--   -- (§6b del encargo) dejarán de entrarle ventas y el aviso se apagará solo.
-- ══════════════════════════════════════════════════════════════════════════
