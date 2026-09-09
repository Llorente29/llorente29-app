-- ══════════════════════════════════════════════════════════════════════════
-- Estándar de alertas · paso 4 — UNA plantilla, y los vigías dejan de escribirla
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Nombre provisional: se renombra a la versión que registre la
-- base (regla 17). Transaccional.
--
-- ── ORDEN CON EL DESPLIEGUE, Y POR QUÉ DA IGUAL ──────────────────────────
-- Esta migración va junto a un cambio en `system-alert` (la plantilla) y otro
-- en `availability-watchdog`. Los dos órdenes son seguros:
--   · edge antes: la plantilla recibe los campos vacíos y compone `[Folvy] …`,
--     que es lo que hace hoy con otro texto.
--   · migración antes: el drenaje manda campos que la edge vieja ignora.
-- Ninguno rompe nada, así que no hay ventana que vigilar.
--
-- ── QUÉ HACE ─────────────────────────────────────────────────────────────
-- 1. `system_alert_queue_drain` manda a la edge los CAMPOS del aviso, ya
--    convertidos en nombres: `severity`, `negocio`, `local`, `marca`, el id y
--    la fecha de encolado. Antes mandaba `subject`, `message` y `kind` y nada
--    más, así que la plantilla no tenía con qué componer.
-- 2. `ingesta_silencio_watchdog` DEJA DE ESCRIBIR el prefijo `[Negocio · Local]`
--    en sus asuntos. Lo pone la plantilla.
--
-- ── EL SEGUNDO PUNTO NO ES COSMÉTICO: LO ENSEÑÓ EL ENSAYO ────────────────
-- Pasando los asuntos REALES de la cola por la plantilla nueva salieron dos
-- duplicaciones que sólo se ven con los datos delante:
--
--   ingesta_silencio (lo escribe este vigía desde esta mañana)
--     antes → «[Foodint · Alcalá] Sin pedidos desde hace 45 min»
--     con la plantilla, sin este cambio:
--            «[Foodint · Alcalá] [Foodint · Alcalá] Sin pedidos…»
--
--   brand-closure (lo escribe `availability-watchdog`, se arregla en su fichero)
--     hoy → «Marca cerrada sin fecha: Meraki Pita · Foodint Alcalá»
--     con la plantilla, sin tocarlo:
--            «[Foodint · Alcalá] Marca cerrada sin fecha: Meraki Pita · Foodint Alcalá»
--
-- Es la consecuencia directa de mover el prefijo a un solo sitio: quien lo
-- escribía a mano tiene que dejar de hacerlo. Con ejemplos inventados no habría
-- salido; salió leyendo los 55 asuntos distintos que hay en la cola.
--
-- ── LO QUE SE VE Y NO SE ARREGLA AQUÍ, PERO QUEDA DICHO ──────────────────
-- Los asuntos viejos llevan la severidad DENTRO del texto: «ALTO: NO ENTRAN
-- PEDIDOS…», «CRITICO: 49 productos vendidos sin catalogo…». Ahora que
-- `severity` es un campo y sale en el pie, ese prefijo sobra y va a leerse
-- repetido. NO se toca aquí a propósito: son 15 vigías más, y cada uno lleva su
-- ensayo (paso 6). Quitarlo con un `replace` desde fuera sería justo lo que este
-- paso viene a acabar: texto de alerta escrito en un sitio que no le toca.
--
-- ── LAS DOS FUNCIONES CONSERVAN SU FIRMA (regla 2) ───────────────────────
-- Leídas de `pg_proc` antes de escribir, no supuestas:
--   `system_alert_queue_drain()` ......... sin argumentos, `void`, una firma
--   `ingesta_silencio_watchdog(int,int,interval)` ... defaults 30, 60, '02:00:00'
-- Las dos con `CREATE OR REPLACE` y sin tocar la firma, así que no puede
-- aparecer una sobrecarga y los crons siguen llamándolas igual.
--
-- ── NOMBRES: EL DRENAJE RESUELVE, LA PLANTILLA PINTA ─────────────────────
-- El drenaje es quien tiene las tablas para convertir un uuid en un nombre, así
-- que resuelve él y la edge sólo pinta. Y recorta el nombre del negocio dentro
-- del nombre del local —«Foodint Alcalá» dentro de la cuenta «Foodint» se manda
-- como «Alcalá»— para que el asunto no diga «[Foodint · Foodint Alcalá]». Eso
-- estaba en el vigía de silencio; se sube aquí, que es donde vale para todos.
--
-- Los nombres se resuelven con subconsultas y NO con un JOIN a propósito: el
-- bucle usa `FOR UPDATE SKIP LOCKED`, y bloquear con `LEFT JOIN` delante obliga
-- a un `FOR UPDATE OF` que es fácil de escribir mal. Son tres lecturas por
-- aviso, y aquí pasan ~11 avisos al día.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. El drenaje manda los campos ────────────────────────────────────────
-- Se toca por ANCLA sobre `pg_get_functiondef`, no reescribiendo la función
-- entera: son 4.408 caracteres de los que sólo cambia una línea, y copiarlos a
-- mano es la forma más fácil de perder por el camino algo que nadie pidió
-- cambiar. La guarda aborta si el ancla no aparece EXACTAMENTE una vez
-- —comprobado: hoy aparece una—, así que si alguien tocó el drenaje entre
-- medias, esto no entra a ciegas.
--
-- El texto nuevo va con comillas de dólar y no entrecomillado: el fragmento
-- lleva comillas simples dentro (`' %'`), y doblarlas a mano es exactamente
-- donde se cuela un error que luego no se ve.
DO $ancla$
DECLARE
  v_def   text;
  v_viejo text := $viejo$      body    := jsonb_build_object('subject', v_row.subject, 'message', v_row.message, 'kind', v_row.kind),$viejo$;
  v_nuevo text := $nuevo$      body    := jsonb_build_object(
        'subject', v_row.subject, 'message', v_row.message, 'kind', v_row.kind,
        'severity', v_row.severity, 'alerta_id', v_row.id, 'creado_at', v_row.created_at,
        'negocio', (select a.name from public.accounts a where a.id = v_row.account_id),
        -- «Foodint Alcalá» dentro de la cuenta «Foodint» se manda como «Alcalá»,
        -- para que el asunto no diga «[Foodint · Foodint Alcalá]».
        'local', (select case when l.name like a2.name || ' %'
                              then substr(l.name, length(a2.name) + 2)
                              else l.name end
                    from public.locations l
                    left join public.accounts a2 on a2.id = l.account_id
                   where l.id = v_row.location_id),
        'marca', (select b.name from public.brand b where b.id = v_row.brand_id)),$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'system_alert_queue_drain';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'no existe system_alert_queue_drain';
  END IF;

  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del drenaje aparece % veces, esperaba 1: alguien lo ha tocado y esto no entra a ciegas', v_veces;
  END IF;

  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla$;

-- ── 2. El vigía de silencio deja de escribir el prefijo ───────────────────
-- Cuerpo idéntico al aplicado en 20260909122522 salvo los dos asuntos: se les
-- quita el `[cuenta · local]` del principio, que ahora lo pone la plantilla.
-- El nombre corto del local SIGUE usándose en el cuerpo del mensaje («Alcalá
-- lleva 45 min…»), que es donde se lee como una frase y no como una etiqueta.
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
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='system_alert_queue_drain') <> 1 THEN
    RAISE EXCEPTION 'system_alert_queue_drain tiene mas de una firma (regla 2)';
  END IF;
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'system_alert_queue_drain';
  IF pg_get_function_identity_arguments(v_oid) <> '' OR pg_get_function_result(v_oid) <> 'void' THEN
    RAISE EXCEPTION 'el drenaje ha cambiado de forma: (%) devuelve %',
      pg_get_function_identity_arguments(v_oid), pg_get_function_result(v_oid);
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'el drenaje ha perdido SECURITY DEFINER';
  END IF;

  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  IF v_src NOT LIKE '%''negocio'',%' OR v_src NOT LIKE '%''local'',%'
     OR v_src NOT LIKE '%''severity'', v_row.severity%' THEN
    RAISE EXCEPTION 'el reemplazo por ancla no ha metido los campos en el cuerpo del http_post';
  END IF;
  -- Y que no se ha llevado nada por delante: lo que ya hacia sigue ahi.
  IF v_src NOT LIKE '%net.http_post%' OR v_src NOT LIKE '%db_health_alert_log%'
     OR v_src NOT LIKE '%for update skip locked%' THEN
    RAISE EXCEPTION 'el reemplazo por ancla ha perdido parte del drenaje';
  END IF;

  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ingesta_silencio_watchdog';
  IF pg_get_function_identity_arguments(v_oid)
       <> 'p_min_punta integer, p_min_valle integer, p_debounce_window interval' THEN
    RAISE EXCEPTION 'la firma del vigia ha cambiado: %', pg_get_function_identity_arguments(v_oid);
  END IF;
  IF pg_get_expr((SELECT proargdefaults FROM pg_proc WHERE oid = v_oid), 0)
       <> '30, 60, ''02:00:00''::interval' THEN
    RAISE EXCEPTION 'los defaults del vigia han cambiado: %',
      pg_get_expr((SELECT proargdefaults FROM pg_proc WHERE oid = v_oid), 0);
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  IF v_src LIKE '%p_subject => ''['' || v_loc.cuenta%' THEN
    RAISE EXCEPTION 'el vigia sigue escribiendo el prefijo: se duplicaria con la plantilla';
  END IF;
  IF v_src NOT LIKE '%is_brand_open%' OR v_src NOT LIKE '%v_sin_hora%' THEN
    RAISE EXCEPTION 'al vigia le falta el veto o el aviso de cobertura: no es el cuerpo que se reviso';
  END IF;

  RAISE NOTICE 'Alertas paso 4: el drenaje manda los campos y el vigia ya no escribe el prefijo.';
END;
$verifica$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR (y con la edge desplegada)
--
-- 1) En el próximo aviso, que lleve el local como CAMPO:
--   select to_char(created_at at time zone 'Europe/Madrid','DD/MM HH24:MI') as cuando,
--          kind, severity, location_id is not null as lleva_local, subject
--     from public.system_alert_queue
--    where created_at > now() - interval '2 hours' order by created_at desc;
--   -- El `subject` de la TABLA va sin prefijo a propósito: el prefijo lo pone
--   -- la plantilla al enviar. Lo que se mira aquí es que `location_id` no sea NULL.
--
-- 2) Que el drenaje sigue entregando, que es lo que no puede romperse:
--   select status, count(*) from public.system_alert_queue group by 1;
-- ══════════════════════════════════════════════════════════════════════════
