-- ══════════════════════════════════════════════════════════════════════════
-- Estándar de alertas · la severidad deja de caer por defecto
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Va DESPUÉS de `20260909145156_alertas_paso6_dbhealth_y_actividad`:
-- ancla contra el cuerpo que dejó aquélla. Nombre provisional (regla 17).
--
-- Tres decisiones de Julio (09/09), las tres en el mismo cuerpo:
--
--   1) La severidad del aviso 4 la decide el HORARIO, no una constante.
--   2) Los avisos 1 y 2 declaran la suya AHORA, no «en la pasada de severidades».
--   3) (el orden del resto va aparte, no toca código)
--
-- ── 1 · «CRITICO» ES UNA AFIRMACIÓN SOBRE EL RELOJ, NO SOBRE EL DATO ─────
-- `critico` quiere decir «actúa ahora». Eso sólo es cierto si el local está
-- sirviendo: tickets atascados a las 21:00 con la cocina abierta son pedidos
-- perdiéndose; el mismo dato a las 4 de la mañana no justifica despertar a
-- nadie. Así que el aviso 4 sale `critico` si `is_brand_open(local, NULL, now())`
-- y `alto` si no — con la misma función que ya usa el vigía de silencio para
-- su veto, que es justo la razón de que exista una y no dos.
--
-- Se evalúa POR FILA, dentro del `perform ... from (...)`: dos locales del
-- mismo grupo pueden estar uno abierto y otro cerrado, y cada aviso se lleva
-- la suya. Con una constante eso no se podía ni plantear.
--
-- ── 2 · UN VALOR POR DEFECTO NO ES UNA DECISIÓN ──────────────────────────
-- Los avisos 1 y 2 pasaban por `_queue_system_alert`, que manda `severity`
-- NULL a propósito («este llamador no los sabe, y NULL es la verdad»). Aguas
-- abajo `severidadDe` convierte NULL en `alto` y lo marca como NO declarada.
-- Es exactamente lo que nos pasó con `severity` NULL en la plantilla: el valor
-- estaba bien y nadie lo había elegido.
--
--   Aviso 1 · bloqueos sostenidos >2 min ........ critico
--   Aviso 2 · conexiones de cliente >80 % ....... alto
--
-- El 1 es `critico` porque es el patrón con el que empezó el incidente del
-- 11/08, y ahí «actúa ahora» es literal. El 2 se queda en `alto` — el mismo
-- valor al que caía — pero ahora está ESCRITO. Ése es todo el cambio, y es el
-- que hace que se pueda discutir.
--
-- NO se les pone `account_id` ni `location_id`, y no es un olvido: hablan de
-- la base de datos entera. Rellenar un campo de local con algo sería mentir
-- en un campo, que es peor que dejarlo vacío.
--
-- ── Y DE PASO, UN DESAJUSTE QUE SÓLO SE VE MIRANDO LAS DOS FUNCIONES ─────
-- El código de los avisos 1 y 2 dice «no repetir en 15 minutos». Lo que hacen
-- es no repetir en VEINTE HORAS, y hacen falta las dos funciones para verlo:
--
--   · el `not exists (… db_health_alert_log … 15 minutes)` mira `sent_at`,
--     o sea cuándo se ENVIÓ, no cuándo se encoló;
--   · `_queue_system_alert` tiene `p_debounce_window default '20:00:00'`, y
--     el vigía lo llama con CUATRO argumentos, así que se lleva el defecto;
--   · `encolar_alerta` corta por esa ventana de 20 h y gana siempre, porque
--     20 h ⊃ 15 min.
--
-- Resultado: un segundo episodio de bloqueos dentro de las 20 horas siguientes
-- al primero NO avisa. Nadie escribió eso; sale de sumar dos defectos. Al pasar
-- a la puerta nueva se declara `interval '15 minutes'`, que es lo que el código
-- decía desde el principio.
--
-- Volumen, medido antes de tocar nada (09/09, 17:00 Madrid, tabla entera):
--   db-health-lock ............... 0 envíos.  Nunca ha saltado.
--   db-health-connections ........ 1 envío, el 12/08 a las 18:47 de Madrid.
--   db-health-watchdog-error ..... 0 envíos.
-- Así que bajar la ventana de 20 h a 15 min no cambia el ruido de hoy: cambia
-- lo que pasará el día que haya dos episodios seguidos.
--
-- ── EL ENSAYO, Y LA PRUEBA A LOS DOS LADOS ──────────────────────────────
-- Copia de usar y tirar (`zz_ensayo_dbhealth`, sin SECURITY DEFINER) construida
-- con los TRES bloques byte a byte de este fichero — comprobado, no supuesto:
--
--   bloque aviso 1 .... 1.733 chars · 1b21cfd67e070c0330b2946e71622285
--   bloque aviso 2 .... 1.070 chars · dc352f19d397a689a95a98251b6dbd8d
--   bloque aviso 4 .... 1.026 chars · c5e3c54b706f0bc03f2d2ffae290c2e2
--
-- Y las dos anclas completas, medidas contra el cuerpo VIVO antes de escribir
-- nada: aviso 1, 1.104 chars · a9e4d1cd…; aviso 2, 730 chars · 92d627ba…
--
-- **Cuerpo que produce: 10.907 chars · md5 `6798375775852e95f074c0568b908579`.**
-- Con 5 llamadas a `encolar_alerta` (avisos 1, 2, 4, 5 y 6) y 1 a la puerta
-- vieja (el manejador). Si al aplicar sale otro md5, algo cambió por el camino.
--
-- ── LA SEVERIDAD DEL AVISO 4, PROBADA POR LOS DOS LADOS ──────────────────
-- Correr el ensayo tal cual no probaba nada: no hay ni un `print_job` en
-- pending >2h, así que el bloque no se ejecuta. Se forzó el predicado
-- (`pending`→`done`) para que pasara por filas de verdad, y salió `alto` en los
-- tres locales — porque eran las 17:58 de Madrid y a esa hora NO hay servicio.
-- Un solo lado no prueba una condición, así que se evaluó la misma expresión a
-- cuatro horas del mismo día:
--
--   local                    04:00   14:00   18:00   21:00
--   Foodint Alcalá ......... alto   critico  alto   critico
--   Foodint Carabanchel .... alto   critico  alto   critico
--   Foodint Plaza Castilla . alto    alto    alto    alto
--
-- Los horarios de hoy explican las tres filas: Alcalá abre 13–16 y 20–23,
-- Carabanchel 13–15 y 20–23, y Plaza Castilla NO ABRE HOY — cero horas. O sea
-- que la regla distingue las tres cosas que tenía que distinguir: hora de
-- servicio, hueco entre servicios, y local que hoy no sirve.
--
-- El hueco de la tarde es justo el caso que hace útil la regla: a las 18:00 el
-- dato es idéntico al de las 21:00 y la urgencia no lo es.
--
-- ── LO QUE NO ENTRA, Y POR QUÉ SE DICE ───────────────────────────────────
-- El MANEJADOR DE EXCEPCIONES del final sigue en `_queue_system_alert`, o sea
-- sin severidad declarada y con la misma ventana de 20 h. No es despiste: ése
-- es el aviso de «el vigía se ha caído», y va en el paso 7 con su hermano — el
-- vigía del vigía —, no suelto aquí. Queda escrito para que no se dé por hecho
-- que en este cuerpo ya no queda nada por declarar: queda uno.
--
-- ── LA FIRMA NO CAMBIA (regla 2) ─────────────────────────────────────────
-- `db_health_watchdog()`: sin argumentos, `void`, una sola firma, por ANCLA
-- sobre el cuerpo vivo. Su cuerpo sigue sin estar en el repo (deuda de regla 1,
-- anotada en `folvy_deudas_abiertas.md`).
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Aviso 1 · bloqueos sostenidos → critico, declarado ─────────────────
DO $ancla1$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 1 — bloqueos sostenidos
    select count(*), count(*) filter (where waiting_locks > 3)
      into v_n_snapshots, v_n_breaching
      from public.db_health_snapshot_log
      where checked_at >= now() - interval '2 minutes';
    if v_n_snapshots >= 2 and v_n_breaching = v_n_snapshots
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-lock' and sent_at >= now() - interval '15 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        'BBDD con bloqueos — ' || v_waiting || ' proceso(s) esperando lock, sostenido >2min',
        'db_health_watchdog detecto mas de 3 procesos esperando lock en ' || v_n_snapshots
          || ' snapshots consecutivos de los ultimos 2 minutos (ahora mismo: ' || v_waiting || ').' || chr(10)
          || 'Conexiones de cliente: ' || v_total_conn
          || '. Transaccion mas antigua: ' || (v_snap->>'oldest_tx_seconds') || 's.' || chr(10)
          || 'Asi empezo el incidente del 11/08. Revisar pg_stat_activity ya.',
        'db-health-lock'
      );
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 1 — bloqueos sostenidos. CRITICO, y dicho, no caido por defecto.
    -- Sin cuenta ni local a proposito: esto es la BASE ENTERA, y rellenar un
    -- campo de local aqui seria mentir en un campo.
    --
    -- La ventana pasa a los 15 minutos que el codigo decia. Antes decia 15 y
    -- hacia 20 HORAS: el `not exists` miraba `sent_at` (cuando se envio) y el
    -- envoltorio viejo traia `p_debounce_window default '20:00:00'`, que gana
    -- por ser mas ancha. Un segundo episodio dentro de esas 20 h no avisaba.
    select count(*), count(*) filter (where waiting_locks > 3)
      into v_n_snapshots, v_n_breaching
      from public.db_health_snapshot_log
      where checked_at >= now() - interval '2 minutes';
    if v_n_snapshots >= 2 and v_n_breaching = v_n_snapshots then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'La base de datos esta bloqueada: ' || v_waiting
                     || ' proceso(s) esperando, y van mas de 2 min',
        p_message =>
          'Mas de 3 procesos llevan esperando un lock en ' || v_n_snapshots
          || ' medidas seguidas de los ultimos 2 minutos; ahora mismo hay ' || v_waiting || '.'
          || chr(10)
          || 'Conexiones de cliente: ' || v_total_conn
          || '. Transaccion mas antigua: ' || (v_snap->>'oldest_tx_seconds') || ' s.'
          || chr(10) || chr(10)
          || 'Asi empezo el incidente del 11/08. Mirar pg_stat_activity YA.',
        p_debounce_kind   => 'db-health-lock',
        p_debounce_window => interval '15 minutes',
        p_account_id      => NULL,
        p_location_id     => NULL,
        p_brand_id        => NULL,
        p_severity        => 'critico'
      );
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe db_health_watchdog'; END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 1 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla1$;

-- ── 2. Aviso 2 · conexiones al 80 % → alto, pero ESCRITO ──────────────────
DO $ancla2$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 2 — conexiones de CLIENTE cerca del maximo
    if v_max_conn > 0 and v_total_conn > 0.8 * v_max_conn
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-connections' and sent_at >= now() - interval '15 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        'BBDD cerca del limite de conexiones — ' || v_total_conn || '/' || v_max_conn,
        'db_health_watchdog detecto ' || v_total_conn || ' conexiones de CLIENTE activas de un maximo de '
          || v_max_conn || ' (>80%).' || chr(10)
          || 'Revisar pg_stat_activity: puede ser el mismo patron del 11/08.',
        'db-health-connections'
      );
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 2 — conexiones de CLIENTE cerca del maximo. ALTO, y dicho.
    -- Se queda en el MISMO valor al que caia por defecto. Ese es todo el
    -- cambio, y es el que importa: ahora esta escrito, asi que se puede
    -- discutir. Antes no era una decision, era un hueco.
    if v_max_conn > 0 and v_total_conn > 0.8 * v_max_conn then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'La base de datos se acerca a su limite de conexiones: '
                     || v_total_conn || ' de ' || v_max_conn,
        p_message =>
          'Hay ' || v_total_conn || ' conexiones de CLIENTE abiertas de un maximo de '
          || v_max_conn || ', mas del 80 %.' || chr(10) || chr(10)
          || 'Mirar pg_stat_activity: puede ser el mismo patron del 11/08.',
        p_debounce_kind   => 'db-health-connections',
        p_debounce_window => interval '15 minutes',
        p_account_id      => NULL,
        p_location_id     => NULL,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      );
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 2 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla2$;

-- ── 3. Aviso 4 · la severidad la decide el horario ────────────────────────
DO $ancla4$
DECLARE
  v_def   text;
  v_viejo text := $viejo$        p_debounce_kind   => 'db-health-print-stuck_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'$viejo$;
  v_nuevo text := $nuevo$        p_debounce_kind   => 'db-health-print-stuck_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        -- La severidad la decide el HORARIO, no una constante (Julio, 09/09).
        -- `critico` quiere decir «actua ahora», y eso solo es verdad si el
        -- local esta sirviendo: tickets atascados a las 21:00 con la cocina
        -- abierta son pedidos perdiendose; el mismo dato a las 4 de la manana
        -- no justifica despertar a nadie.
        --
        -- Se evalua POR FILA: dos locales del mismo grupo pueden estar uno
        -- abierto y otro cerrado, y cada aviso se lleva la suya.
        p_severity        => case
                               when public.is_brand_open(t.location_id, NULL::uuid, now())
                               then 'critico' else 'alto'
                             end$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 4 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla4$;

-- ── Verificación DENTRO de la transacción ─────────────────────────────────
DO $verifica$
DECLARE
  v_oid oid;
  v_src text;
BEGIN
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

  -- Las tres severidades, dichas.
  IF v_src NOT LIKE '%p_severity        => ''critico''%' THEN
    RAISE EXCEPTION 'el aviso 1 no declara critico';
  END IF;
  IF v_src NOT LIKE '%is_brand_open(t.location_id%' THEN
    RAISE EXCEPTION 'el aviso 4 no decide la severidad por el horario';
  END IF;

  -- Queda UNA sola llamada a la puerta vieja: el manejador de excepciones.
  -- Se cuenta la LLAMADA (`public.x(`) y no el nombre suelto, porque los
  -- comentarios que se meten aqui nombran las dos funciones en prosa.
  IF (length(v_src) - length(replace(v_src, 'public._queue_system_alert(', '')))
       / length('public._queue_system_alert(') <> 1 THEN
    RAISE EXCEPTION 'esperaba 1 llamada a _queue_system_alert (el manejador), hay %',
      (length(v_src) - length(replace(v_src, 'public._queue_system_alert(', '')))
        / length('public._queue_system_alert(');
  END IF;
  IF (length(v_src) - length(replace(v_src, 'public.encolar_alerta(', '')))
       / length('public.encolar_alerta(') <> 5 THEN
    RAISE EXCEPTION 'esperaba 5 llamadas a encolar_alerta (avisos 1, 2, 4, 5 y 6), hay %',
      (length(v_src) - length(replace(v_src, 'public.encolar_alerta(', '')))
        / length('public.encolar_alerta(');
  END IF;

  -- Y que las anclas no se han llevado por delante los avisos de impresion.
  IF v_src NOT LIKE '%db-health-print-stuck\_%'
     OR v_src NOT LIKE '%db-health-print-inactive-printer\_%'
     OR v_src NOT LIKE '%db-health-print-no-active-printer\_%' THEN
    RAISE EXCEPTION 'el reemplazo por ancla se ha llevado los avisos de impresion';
  END IF;
  -- Y que el `not exists` muerto contra db_health_alert_log ya no gobierna
  -- los avisos 1 y 2: la unica ventana que manda es la de la cola.
  IF v_src LIKE '%kind = ''db-health-lock'' and sent_at%'
     OR v_src LIKE '%kind = ''db-health-connections'' and sent_at%' THEN
    RAISE EXCEPTION 'los avisos 1 y 2 siguen con la guarda vieja de 15 min que hacia 20 h';
  END IF;

  RAISE NOTICE 'Severidad: aviso 1 critico, aviso 2 alto, aviso 4 por horario. Queda el manejador para el paso 7.';
END;
$verifica$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR
--
-- 1) Que el cuerpo es el que se ensayó, medido igual a los dos lados:
--   select length(prosrc) as chars, md5(prosrc) as md5
--     from pg_proc where oid = 'public.db_health_watchdog()'::regprocedure;
--   -- esperado: 10907 · 6798375775852e95f074c0568b908579
--
-- 2) Que el aviso 4 sale con la severidad del reloj. Con la cocina abierta
--    tiene que decir `critico`; a las 4 de la mañana, `alto`:
--   select subject, severity,
--          public.is_brand_open(location_id, NULL::uuid, now()) as estaba_abierto
--     from public.system_alert_queue
--    where subject like 'Tickets sin imprimir%'
--    order by created_at desc limit 5;
--
-- 3) Que los avisos 1 y 2 ya no salen con severidad vacía. Hoy no hay ninguno
--    —el 1 no ha saltado nunca y el 2 una vez, el 12/08— así que esto sólo
--    dirá algo el día que salte. Es lo que hay: no se inventa un caso.
--   select subject, severity, created_at
--     from public.system_alert_queue
--    where kind = 'db-health' and subject like 'La base de datos%';
-- ══════════════════════════════════════════════════════════════════════════
