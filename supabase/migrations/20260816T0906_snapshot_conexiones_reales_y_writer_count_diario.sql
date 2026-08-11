-- Aplicada: PENDIENTE (Julio, por MCP).
--
-- ENCARGO fix/limpieza-kds-viejo-y-prevencion — 2 correcciones sobre
-- 20260816T0902 (YA APLICADA y funcionando: 3 ejecuciones de cron OK,
-- writer_count=3, guard anti-regresión armado, 0 avisos falsos). Esta
-- migración NO toca esa base, corrige dos defectos que Julio encontró
-- leyendo el código ya en producción.
--
-- ── Corrección 1: Aviso 2 comparaba magnitudes distintas ────────────────────
-- db_health_snapshot() contaba `count(*) from pg_stat_activity` a secas y lo
-- comparaba contra max_connections. VERIFICADO en vivo (11/08): ahora mismo
-- pg_stat_activity trae 30 filas pero solo 21 son backend_type='client
-- backend' — las otras 9 son pg_cron launcher, pg_net worker, walwriter,
-- walsender, autovacuum launcher, logical replication launcher, background
-- writer, archiver, checkpointer: procesos internos que NO ocupan plaza de
-- max_connections (tienen sus propios pools: max_worker_processes,
-- autovacuum_max_workers, etc.). Con max_connections=60, ese offset fijo de
-- ~9-10 procesos hace que el 80% se dispare con ocupación real de cliente
-- bastante menor al 80% real — exactamente lo que midió Julio (45 en
-- pg_stat_activity frente a 20 conexiones de cliente reales). Arreglado
-- filtrando `backend_type = 'client backend'` en db_health_snapshot();
-- waiting_locks y oldest_tx_seconds se dejan SIN filtrar (un lock o una
-- transacción larga de autovacuum es un problema real igual que si fuera de
-- un cliente, ahí sí interesa contar todo pg_stat_activity).
--
-- ── Corrección 2: writer_count fuera del chequeo de cada minuto ─────────────
-- MEDIDO por Julio en producción: el barrido de pg_proc con regex sobre
-- prosrc (guard anti-regresión, §6 de 0902) cuesta 283ms de un total de
-- ejecuciones de db_health_watchdog() entre 54ms y 401ms (cron.job_run_details,
-- 11/08 09:26-09:32 UTC) — verificado que ese coste es real y no un artefacto
-- de medición: un EXPLAIN ANALYZE aislado en esta sesión (caché caliente, sin
-- concurrencia) dio 12-18ms, muy por debajo de lo medido en producción bajo
-- carga real; se toma como buena la medición de producción, no la de
-- laboratorio. Se ejecuta cada minuto (1.440 veces/día) para avisar de algo
-- que, por su propio antiruido de 24h, como mucho se notifica una vez al día
-- — desproporción real, no solo estética.
--
-- Se mueve el cómputo de writer_count a una función y un cron propios,
-- diarios, tal como pide el encargo (opción "uno propio", no se mezcla con
-- db_health_stale_devices_report() para no acoplar dos responsabilidades
-- distintas — inventario de dispositivos fantasma no tiene nada que ver con
-- regresión de código). db_health_snapshot() deja de calcular writer_count
-- (ya no aparece en su jsonb); db_health_watchdog() deja de tener Aviso 3 (se
-- traslada entero, lógica de autoarmado y antiruido incluidos, a
-- db_health_writer_regression_check()). La columna
-- db_health_snapshot_log.writer_count pasa a admitir NULL: las 1.440 filas
-- diarias del chequeo de cada minuto la dejan NULL (nunca se mide ahí);
-- db_health_writer_regression_check() inserta 1 fila/día con el valor real
-- medido. ELEGIDO explícitamente NULL en vez de "rellenar con el último
-- valor conocido" (opción que también pedía Julio, la descarto y digo por
-- qué): rellenar arrastrando el valor previo haría parecer que cada fila es
-- una medición fresca cuando no lo es — NULL es la respuesta honesta a
-- "¿cuántos escritores había en este snapshot?" cuando no se ha mirado.
-- El autoarmado ("¿ha habido alguna vez un snapshot con writer_count=3?") no
-- se rompe: sigue siendo un `exists (... where writer_count = 3)`, indiferente
-- a cuántas filas NULL haya de por medio. VERIFICADO antes de escribir esto:
-- ya hay 9 filas históricas con writer_count=3 desde que 0902 corre, así que
-- el guard queda armado desde el primer minuto de esta migración, sin
-- ventana de desprotección.
--
-- Aviso de latencia de detección (no oculto, a valorar por Julio): antes de
-- esta migración la regresión de escritores se detectaba en ≤1 minuto; con
-- cadencia diaria pasa a detectarse en ≤24h. Los Avisos 1 y 2 (bloqueos,
-- conexiones), que SÍ siguen siendo cada minuto y sin cambios aquí, ya cazan
-- el SÍNTOMA de una tormenta de escrituras (bloqueos/conexiones disparadas)
-- con la misma rapidez de siempre — lo que se retrasa a 24h es solo la
-- "huella dactilar" de la causa (qué función concreta volvió a escribir), no
-- la alarma de que algo va mal. Si se prefiere más rapidez sin volver al
-- coste de cada minuto, un punto intermedio razonable sería cada 15 min
-- (283ms × 96/día ≈ 27s/día de coste, frente a 283ms × 1.440/día ≈ 6,8
-- min/día de coste con la cadencia vieja) — no se aplica aquí porque el
-- encargo pide explícitamente cron diario; decirlo si se prefiere ese punto
-- intermedio y se cambia el cron.schedule de abajo.
--
-- Validado por MCP con nombre temporal _tmp_check_db_health_snapshot() antes
-- de escribir este fichero (creado, comparado contra pg_stat_activity real,
-- borrado): confirma 30 (viejo) vs 21 (nuevo, solo client backend) con
-- max_connections=60 ahora mismo.

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='db_health_snapshot') then
    raise exception 'snapshot_conexiones_reales_y_writer_count_diario: falta db_health_snapshot — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='db_health_watchdog') then
    raise exception 'snapshot_conexiones_reales_y_writer_count_diario: falta db_health_watchdog — RECON desactualizado, parar';
  end if;
end $$;

-- ── 1) writer_count admite NULL (ya no se mide en cada snapshot de minuto) ──

alter table public.db_health_snapshot_log alter column writer_count drop not null;

comment on table public.db_health_snapshot_log is
  'RLS deny-all intencional (vigía interno de salud de BBDD). Acceso solo vía '
  'SECURITY DEFINER. Retención: 48h, se autolimpia en cada ejecución de '
  'db_health_watchdog(). total_connections = pg_stat_activity filtrado a '
  'backend_type=''client backend'' (corregido 11/08: antes contaba también '
  'procesos internos, inflando el conteo frente a max_connections). '
  'waiting_locks = conteo crudo de TODO pg_stat_activity con '
  'wait_event_type=Lock (aquí sí interesa cualquier backend). writer_count '
  'es NULL en las filas del chequeo de cada minuto (ya no se calcula ahí por '
  'coste, ver 20260816T0906) y solo lleva valor real en la fila diaria que '
  'inserta db_health_writer_regression_check() — guard anti-regresión, '
  'esperado SIEMPRE 3 cuando no es NULL.';

-- ── 2) db_health_snapshot(): conexiones reales, sin writer_count ────────────

CREATE OR REPLACE FUNCTION public.db_health_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_total_conn   int;
  v_waiting_lock int;
  v_oldest_tx_s  numeric;
  v_max_conn     int;
begin
  -- Corregido 11/08: solo backend_type='client backend' cuenta plaza de
  -- max_connections — walsender/walwriter/autovacuum/pg_cron/pg_net/etc.
  -- tienen sus propios pools y no deben inflar este número.
  select count(*) into v_total_conn
  from pg_stat_activity
  where backend_type = 'client backend';

  select count(*) into v_waiting_lock
  from pg_stat_activity
  where wait_event_type = 'Lock';

  select extract(epoch from max(now() - xact_start)) into v_oldest_tx_s
  from pg_stat_activity
  where xact_start is not null;

  select setting::int into v_max_conn from pg_settings where name = 'max_connections';

  return jsonb_build_object(
    'total_connections', v_total_conn,
    'waiting_locks',     v_waiting_lock,
    'oldest_tx_seconds', coalesce(round(v_oldest_tx_s), 0),
    'max_connections',   v_max_conn
  );
end;
$function$;

comment on function public.db_health_snapshot() is
  'Chequeo puro e instantáneo de salud de BBDD (conexiones de CLIENTE real, '
  'procesos esperando lock AHORA, tx más vieja, max_connections). Sin '
  'writer_count desde 20260816T0906 (ver db_health_writer_regression_check, '
  'chequeo diario aparte) — sin efectos secundarios y sin juicio de '
  'persistencia, eso lo hace db_health_watchdog() comparando snapshots.';

-- ── 3) db_health_watchdog(): igual, menos el Aviso 3 (trasladado) ───────────

CREATE OR REPLACE FUNCTION public.db_health_watchdog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_snap            jsonb;
  v_waiting         int;
  v_total_conn      int;
  v_max_conn        int;
  v_n_snapshots     int;
  v_n_breaching     int;
  v_secret          text;
  v_stuck_print     int;
  v_inactive_print  int;
  v_route_failures  int;
begin
  begin
    v_snap       := public.db_health_snapshot();
    v_waiting    := (v_snap->>'waiting_locks')::int;
    v_total_conn := (v_snap->>'total_connections')::int;
    v_max_conn   := (v_snap->>'max_connections')::int;

    -- writer_count ya no se mide aquí (ver 20260816T0906): la columna queda
    -- NULL en esta fila. db_health_writer_regression_check() (cron diario)
    -- inserta la única fila del día con valor real.
    insert into public.db_health_snapshot_log
      (total_connections, waiting_locks, oldest_tx_seconds)
    values
      (v_total_conn, v_waiting, (v_snap->>'oldest_tx_seconds')::numeric);

    delete from public.db_health_snapshot_log where checked_at < now() - interval '48 hours';
    delete from public.db_health_alert_log where sent_at < now() - interval '30 days';

    -- Aviso 1 — bloqueos sostenidos: >3 esperando lock en TODOS los snapshots
    -- de los últimos 2 min, con al menos 2 lecturas (evita falso positivo de
    -- una lectura suelta). Antiruido: 15 min.
    select count(*), count(*) filter (where waiting_locks > 3)
      into v_n_snapshots, v_n_breaching
      from public.db_health_snapshot_log
      where checked_at >= now() - interval '2 minutes';

    if v_n_snapshots >= 2 and v_n_breaching = v_n_snapshots
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-lock' and sent_at >= now() - interval '15 minutes'
       ) then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', 'BBDD con bloqueos — ' || v_waiting || ' proceso(s) esperando lock, sostenido >2min',
            'message', 'db_health_watchdog detectó más de 3 procesos esperando lock en ' || v_n_snapshots
                       || ' snapshots consecutivos de los últimos 2 minutos (ahora mismo: ' || v_waiting || ').' || chr(10)
                       || 'Conexiones de cliente: ' || v_total_conn
                       || '. Transacción más antigua: ' || (v_snap->>'oldest_tx_seconds') || 's.' || chr(10)
                       || 'Así empezó el incidente del 11/08 (caída ~45 min con los 3 locales cerrados). Revisar pg_stat_activity ya.',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-lock', v_waiting || ' esperando lock');
      end if;
    end if;

    -- Aviso 2 — conexiones de CLIENTE cerca del máximo (>80% de
    -- max_connections). CORREGIDO 11/08: v_total_conn ya solo cuenta
    -- backend_type='client backend' (ver db_health_snapshot()) — antes
    -- incluía ~9-10 procesos internos fijos que inflaban el conteo y
    -- adelantaban el aviso muy por debajo del 80% real de ocupación de
    -- cliente. Instantáneo, no exige persistencia. Antiruido: 15 min.
    if v_max_conn > 0 and v_total_conn > 0.8 * v_max_conn
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-connections' and sent_at >= now() - interval '15 minutes'
       ) then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', 'BBDD cerca del límite de conexiones — ' || v_total_conn || '/' || v_max_conn,
            'message', 'db_health_watchdog detectó ' || v_total_conn || ' conexiones de CLIENTE activas de un máximo de '
                       || v_max_conn || ' (>80%).' || chr(10)
                       || 'Revisar pg_stat_activity: puede ser el mismo patrón del 11/08 (tormenta de escrituras agotando el pool).',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-connections', v_total_conn || '/' || v_max_conn);
      end if;
    end if;

    -- Aviso 3 (regresión de escritores de kds_device) TRASLADADO a
    -- db_health_writer_regression_check() — cron diario propio, ver
    -- 20260816T0906. Dejaba de tener sentido evaluarlo aquí: costaba 283ms
    -- cada minuto (1.440 veces/día) para un aviso con antiruido de 24h.

    -- Aviso 4 (Tarea C.1) — print_job en pending >2h. Antiruido 60min.
    select count(*) into v_stuck_print
    from print_job
    where status = 'pending' and created_at < now() - interval '2 hours';

    if v_stuck_print > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-stuck' and sent_at >= now() - interval '60 minutes'
       ) then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', v_stuck_print || ' trabajo(s) de impresión atascados >2h',
            'message', 'db_health_watchdog detectó ' || v_stuck_print || ' print_job en pending desde hace más de 2 horas.' || chr(10)
                       || 'Así se acumularon los 76 de Carabanchel (08-09/08) durante 3 días sin que nadie se enterara.' || chr(10)
                       || 'select * from print_job where status=''pending'' and created_at < now() - interval ''2 hours'';',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-print-stuck', v_stuck_print || ' trabajos');
      end if;
    end if;

    -- Aviso 5 (Tarea C.2) — print_job no terminal (pending/sent) cuya
    -- impresora está is_active=false. Aviso INMEDIATO, sin exigir persistencia.
    select count(*) into v_inactive_print
    from print_job pj
    join printer p on p.id = pj.printer_id
    where pj.status in ('pending', 'sent') and p.is_active = false;

    if v_inactive_print > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-inactive-printer' and sent_at >= now() - interval '60 minutes'
       ) then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', v_inactive_print || ' trabajo(s) de impresión encolados a impresora INACTIVA',
            'message', 'db_health_watchdog detectó ' || v_inactive_print || ' print_job (pending/sent) cuya impresora tiene is_active=false.' || chr(10)
                       || 'Nunca se van a imprimir: claim_print_jobs solo reclama de impresoras activas. Cancélalos o reactiva/reasigna la impresora.' || chr(10)
                       || 'select pj.* from print_job pj join printer p on p.id=pj.printer_id where pj.status in (''pending'',''sent'') and p.is_active=false;',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-print-inactive-printer', v_inactive_print || ' trabajos');
      end if;
    end if;

    -- Aviso 6 (Tarea B) — pedidos aceptados sin NINGUNA impresora activa,
    -- rastro en print_route_failure_log. Antiruido 60min.
    select count(*) into v_route_failures
    from public.print_route_failure_log
    where created_at >= now() - interval '10 minutes';

    if v_route_failures > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-no-active-printer' and sent_at >= now() - interval '60 minutes'
       ) then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', 'Pedido(s) aceptado(s) sin impresora activa en el local',
            'message', 'db_health_watchdog detectó ' || v_route_failures || ' aviso(s) en print_route_failure_log de los últimos 10 minutos.' || chr(10)
                       || 'Un local se quedó sin ninguna impresora activa configurada — los pedidos se aceptan pero no imprime nada.' || chr(10)
                       || 'select * from print_route_failure_log where created_at >= now() - interval ''1 hour'' order by created_at desc;',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-print-no-active-printer', v_route_failures || ' avisos');
      end if;
    end if;
  exception when others then
    begin
      if not exists (
        select 1 from public.db_health_alert_log
        where kind = 'db-health-watchdog-error' and sent_at >= now() - interval '30 minutes'
      ) then
        select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
        if v_secret is not null then
          perform net.http_post(
            url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
            body    := jsonb_build_object(
              'subject', 'db_health_watchdog FALLÓ',
              'message', 'El vigía de salud de BBDD lanzó una excepción y no pudo completar su chequeo: ' || sqlerrm,
              'kind', 'db-health-watchdog-error'
            ),
            timeout_milliseconds := 10000
          );
          insert into public.db_health_alert_log (kind, detail) values ('db-health-watchdog-error', sqlerrm);
        end if;
      end if;
    exception when others then
      null;
    end;
    raise;
  end;
end;
$function$;

comment on function public.db_health_watchdog() is
  'Registra un snapshot cada minuto (cron db-health-watchdog) y avisa por '
  'system-alert ante 5 condiciones independientes (bloqueos sostenidos, '
  'conexiones de cliente >80%, print_job pending >2h, print_job no terminal '
  'en impresora inactiva, pedidos sin impresora activa), cada una con su '
  'propio antiruido en db_health_alert_log. La regresión del guard '
  'anti-escritura (writer_count != 3) se evalúa aparte, diario, en '
  'db_health_writer_regression_check() (20260816T0906) — demasiado cara '
  '(283ms medido) para correr cada minuto cuando su propio antiruido es de '
  '24h. Nunca falla en silencio.';

-- ── 4) Nueva función: regresión de escritores, cadencia diaria ──────────────

CREATE OR REPLACE FUNCTION public.db_health_writer_regression_check()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_snap    jsonb;
  v_writers int;
  v_secret  text;
begin
  begin
    v_snap := public.db_health_snapshot();

    -- Guard anti-regresión (§6 de 0902, trasladado aquí 11/08 por coste):
    -- cuenta funciones de public con `update ... kds_device` en el cuerpo.
    -- Esperado SIEMPRE 3 — kds_heartbeat, report_device_app_version,
    -- set_device_mode_by_token. Medido: 283ms (barrido de pg_proc con regex
    -- sobre prosrc de ~1.340 funciones) — trivial 1 vez/día, desproporcionado
    -- 1.440 veces/día.
    select count(*) into v_writers
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~* 'update\s+(public\.)?kds_device';

    -- Única fila del día con writer_count real; el resto de columnas se
    -- recalculan aquí también (baratas, ver db_health_snapshot()) para que
    -- la fila sea autoconsistente y no dependa de encajar con la última fila
    -- del minuto anterior.
    insert into public.db_health_snapshot_log
      (total_connections, waiting_locks, oldest_tx_seconds, writer_count)
    values (
      (v_snap->>'total_connections')::int,
      (v_snap->>'waiting_locks')::int,
      (v_snap->>'oldest_tx_seconds')::numeric,
      v_writers
    );

    -- Autoarmado (igual que antes): el aviso de REGRESIÓN solo tiene sentido
    -- si alguna vez estuvo en 3. Verificado 11/08: ya hay 9 filas históricas
    -- con writer_count=3 desde que 0902 corre — el guard queda armado desde
    -- el primer minuto de esta migración.
    if v_writers <> 3
       and exists (select 1 from public.db_health_snapshot_log where writer_count = 3)
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-writer-regression' and sent_at >= now() - interval '24 hours'
       ) then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', 'REGRESIÓN: ' || v_writers || ' funciones escriben kds_device (se esperaban 3)',
            'message', 'Alguien ha vuelto a meter una escritura de last_seen_at en una función de LECTURA de kds_device '
                       || '(el incidente completo del 11/08, de nuevo).' || chr(10)
                       || 'Esperado: kds_heartbeat, report_device_app_version, set_device_mode_by_token — y nada más.' || chr(10)
                       || 'Este chequeo corre 1 vez/día (db-health-writer-regression-daily) — si esto llega, la '
                       || 'regresión pudo llevar hasta 24h sin detectarse por este aviso concreto (los Avisos 1/2 de '
                       || 'db_health_watchdog, cada minuto, ya habrían cazado el SÍNTOMA de bloqueos/conexiones antes).' || chr(10)
                       || 'select proname from pg_proc join pg_namespace on ... where prosrc ~* ''update\s+(public\.)?kds_device'' para ver cuál.',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-writer-regression', v_writers || ' escritores');
      end if;
    end if;
  exception when others then
    begin
      if not exists (
        select 1 from public.db_health_alert_log
        where kind = 'db-health-writer-regression-check-error' and sent_at >= now() - interval '30 minutes'
      ) then
        select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
        if v_secret is not null then
          perform net.http_post(
            url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
            body    := jsonb_build_object(
              'subject', 'db_health_writer_regression_check FALLÓ',
              'message', 'El chequeo diario de regresión de escritores lanzó una excepción: ' || sqlerrm,
              'kind', 'db-health-writer-regression-check-error'
            ),
            timeout_milliseconds := 10000
          );
          insert into public.db_health_alert_log (kind, detail) values ('db-health-writer-regression-check-error', sqlerrm);
        end if;
      end if;
    exception when others then
      null;
    end;
    raise;
  end;
end;
$function$;

comment on function public.db_health_writer_regression_check() is
  'Chequeo DIARIO (cron db-health-writer-regression-daily, 06:10 UTC) del '
  'guard anti-regresión de escritores de kds_device (esperado SIEMPRE 3: '
  'kds_heartbeat, report_device_app_version, set_device_mode_by_token). '
  'Trasladado aquí desde db_health_watchdog() el 11/08 (20260816T0906) por '
  'coste: 283ms medido en producción, desproporcionado para correr cada '
  'minuto cuando su antiruido es de 24h. Inserta 1 fila/día en '
  'db_health_snapshot_log con writer_count real (el resto de filas del día, '
  'del chequeo de cada minuto, lo dejan NULL).';

revoke all on function public.db_health_writer_regression_check() from public, anon, authenticated;

-- ── 5) Cron diario ───────────────────────────────────────────────────────────

select cron.schedule(
  'db-health-writer-regression-daily',
  '10 6 * * *',
  $cron$select public.db_health_writer_regression_check()$cron$
);

notify pgrst, 'reload schema';
