-- Aplicada: PENDIENTE (Julio, por MCP).
--
-- ENCARGO (11/08 tarde) — cola con reintento para system-alert. Prioridad
-- ALTA, explícita por delante de todo salvo T1.c: "un vigía en el que
-- confías y que puede fallar callado es PEOR que no tener vigía, porque
-- produce falsa tranquilidad." Origen concreto, no teórico: 3 timeouts de
-- DNS de 5s observados en pg_net el 11/08 15:00.
--
-- ── El bug de fondo (ya diagnosticado, esto lo cierra) ──────────────────────
-- net.http_post es fire-and-forget: encola la petición y devuelve un
-- request_id al instante; la respuesta real llega después a
-- net._http_response, la función SQL que lo llama no la espera ni la
-- comprueba. db_health_watchdog / db_health_writer_regression_check
-- escribían la fila de antiruido en db_health_alert_log INMEDIATAMENTE
-- DESPUÉS de `perform net.http_post(...)`, sin saber si esa llamada
-- concreta iba a tener éxito. Si sufre un timeout de DNS, el sistema daba el
-- aviso por enviado (consumía la ventana de antiruido — 15min/24h/60min
-- según el aviso) aunque el correo nunca hubiera salido. Exactamente el
-- escenario de los 3 timeouts del 11/08.
--
-- ── Diseño (reutiliza el patrón que ya existe en el repo, no se inventa
-- uno nuevo — customer_notification/training_notice: tabla cola + status +
-- attempts + cron que drena, reintenta hasta 3) ─────────────────────────────
--
-- system_alert_queue: los emisores (los 3 chequeos de salud de BBDD) ya NO
-- llaman a net.http_post directamente — insertan una fila. Un cron nuevo,
-- cada minuto (system-alert-queue-drain), la drena: dispara con
-- net.http_post las filas 'pending' sin petición en vuelo y con <3
-- intentos, y RESUELVE las que ya tienen una petición en vuelo mirando
-- net._http_response por su request_id — 200 → 'sent'; cualquier otro
-- resultado (incluido "sin respuesta tras 2min", el caso exacto de un
-- timeout de DNS que pg_net nunca resuelve) → reintenta si quedan intentos,
-- 'failed' a la 3ª.
--
-- (b) LA CORRECCIÓN DE FONDO: la fila de antiruido en db_health_alert_log
-- SOLO se escribe cuando system_alert_queue_drain() confirma un 200 en
-- net._http_response — nunca al encolar. Si un aviso agota sus 3 intentos
-- sin éxito, la ventana de antiruido de ESE tipo de aviso NUNCA se consume:
-- en el siguiente tick del emisor (si la condición persiste) se encola un
-- intento nuevo, no toca esperar 15min/24h/60min para volver a intentarlo.
-- VALIDADO por MCP (ver más abajo): una fila que agota 3 intentos sin éxito
-- deja CERO entradas en el debounce log.
--
-- (a) META-AVISO — imprescindible, no opcional (así lo pide el encargo: "es
-- lo único que rompe el círculo de 'el vigía no puede avisar de que el
-- vigía no puede avisar'"). Dos vías INDEPENDIENTES entre sí en
-- system_alert_queue_drain():
--   · `raise warning` — no depende de Resend/DNS/pg_net, queda en los logs
--     de Postgres (cron.job_run_details / get_logs) aunque el canal de
--     correo esté totalmente caído.
--   · un aviso MÁS por el canal normal (mejor esfuerzo — puede fallar
--     también, pero sigue siendo el único canal real que existe hoy),
--     encolado como cualquier otro, con SU PROPIO antiruido de 60min
--     basado en la CREACIÓN de la fila (no en su confirmación, a
--     diferencia de (b) — ver nota de diseño más abajo, es una asimetría
--     deliberada, no una inconsistencia).
--
-- NOTA DE DISEÑO — por qué el meta-aviso NO sigue la regla (b): un aviso
-- normal (p.ej. db-health-lock) representa una condición real que puede
-- seguir activa; si falla su entrega, lo correcto es reintentarlo YA en el
-- siguiente tick del emisor (regla b). El meta-aviso "el canal está
-- degradado" es distinto: es el mismo hecho repetido mientras dure la
-- degradación — si se le aplicara la regla (b), un canal caído de verdad
-- jamás confirmaría el meta-aviso, así que su antiruido nunca se consumiría
-- y se encolaría una fila nueva CADA MINUTO durante toda la caída. Por eso
-- su antiruido mira system_alert_queue.created_at (¿ya hay una fila de este
-- tipo creada en la última hora, sin importar si se resolvió?), no
-- db_health_alert_log. VALIDADO por MCP: 5 ticks con la condición
-- degradada sostenida → exactamente 1 fila de meta-aviso, no una por tick.
--
-- Alcance deliberado: solo se rewiran los 3 emisores SQL que ya llamaban a
-- net.http_post directamente (db_health_watchdog, db_health_
-- writer_regression_check, db_health_stale_devices_report) — son los que
-- tienen el bug fire-and-forget descrito arriba. Los 4 edge functions que
-- llaman a system-alert con `fetch()` síncrono (availability-watchdog,
-- catcher-webhook, hubrise-callback-ensure, ingestion-synthetic-ping) NO se
-- tocan aquí: conocen el resultado de su propia llamada al instante (fetch
-- awaited, no fire-and-forget), así que no tienen ESTE bug — les falta
-- reintento propio, pero es un problema distinto y menor, fuera de este
-- encargo.
--
-- El propio system-alert (fetch a Resend sin retry) queda cubierto por esta
-- misma cola sin tocar su código: si Resend falla, system-alert devuelve
-- 502 (ya lo hacía), net._http_response lo registra sin status_code=200, y
-- system_alert_queue_drain() reintenta la llamada COMPLETA (incluida la
-- parte de Resend) hasta 3 veces — cubre el "único fetch sin retry" sin
-- añadir retry dentro de system-alert.
--
-- Validado por MCP con tablas/funciones temporales (creadas, probadas,
-- borradas) ANTES de escribir este fichero — 3 rondas:
--   1) Máquina de estados completa contra una tabla y un net._http_response
--      simulados: entrega sana al primer intento (sent + debounce escrito);
--      3 fallos consecutivos (1 DNS sin status_code, 2 HTTP con
--      status_code) → failed, CERO entradas de debounce.
--   2) Bug real encontrado y corregido en esa misma ronda: la condición de
--      "degradado" original contaba cualquier fila con attempts>0, que
--      también es cierta para un envío sano recién disparado esperando su
--      confirmación async normal — disparaba el meta-aviso constantemente.
--      Corregida a `last_error is not null` (solo se rellena al confirmar
--      un fallo, nunca al disparar).
--   3) Segundo bug encontrado y corregido: una fila en su ÚLTIMO intento
--      (attempts=3) que nunca recibe respuesta de pg_net tras 2min se
--      quedaba en limbo permanente (pending, request_id null, pero
--      attempts=3 la excluye del disparador Y del resolvedor). Corregido:
--      esa rama también aplica `case when attempts>=3 then failed else
--      pending end`, igual que la rama de fallo confirmado.

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='db_health_watchdog') then
    raise exception 'system_alert_queue_reintento: falta db_health_watchdog — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='db_health_writer_regression_check') then
    raise exception 'system_alert_queue_reintento: falta db_health_writer_regression_check — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='db_health_stale_devices_report') then
    raise exception 'system_alert_queue_reintento: falta db_health_stale_devices_report — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='db_health_alert_log') then
    raise exception 'system_alert_queue_reintento: falta db_health_alert_log — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='net' and table_name='_http_response' and column_name='status_code') then
    raise exception 'system_alert_queue_reintento: net._http_response sin status_code — RECON desactualizado, parar';
  end if;
end $$;

-- ── 1) Tabla cola ────────────────────────────────────────────────────────────

create table if not exists public.system_alert_queue (
  id              bigint generated by default as identity primary key,
  kind            text not null,                 -- 'kind' del body de system-alert (Tipo:/Origen: del correo)
  debounce_kind   text,                           -- si no es null, kind que se escribe en db_health_alert_log SOLO al confirmarse el envío (200)
  subject         text not null,
  message         text not null,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts        int not null default 0,
  request_id      bigint,                         -- id de net.http_post en vuelo; null si no hay ninguna petición pendiente de resolver
  last_error      text,
  created_at      timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at         timestamptz
);

comment on table public.system_alert_queue is
  'Cola con reintento para el canal system-alert (11/08) — mismo patrón que '
  'customer_notification/training_notice (status + attempts + drenaje por '
  'cron, reintenta hasta 3). Sustituye las llamadas directas a '
  'net.http_post desde db_health_watchdog/db_health_writer_regression_check/'
  'db_health_stale_devices_report: net.http_post es fire-and-forget y esas '
  'funciones no podían saber si la entrega tuvo éxito. RLS deny-all '
  'intencional, acceso solo vía SECURITY DEFINER. Retención: 7 días para '
  'filas resueltas (sent/failed).';

alter table public.system_alert_queue enable row level security;

create index if not exists idx_system_alert_queue_drain
  on public.system_alert_queue (status, request_id)
  where status = 'pending';

create index if not exists idx_system_alert_queue_created_at
  on public.system_alert_queue (created_at);

revoke all on table public.system_alert_queue from public, anon, authenticated;

-- ── 2) Helper: encolar (con antiduplicado "ya hay uno en vuelo") ───────────

CREATE OR REPLACE FUNCTION public._queue_system_alert(p_kind text, p_subject text, p_message text, p_debounce_kind text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  -- Si ya hay un aviso del mismo debounce_kind EN VUELO (encolado, sin
  -- resolver todavía — sent o failed), no se duplica: el emisor puede
  -- llamar cada minuto mientras la condición persista, y
  -- system_alert_queue_drain() puede tardar 1 o varios ticks en confirmar o
  -- agotar los 3 intentos. Sin esto, una condición sostenida encolaría un
  -- aviso nuevo cada minuto mientras el anterior sigue sin resolver.
  if p_debounce_kind is not null and exists (
    select 1 from public.system_alert_queue
    where debounce_kind = p_debounce_kind and status = 'pending'
  ) then
    return;
  end if;

  insert into public.system_alert_queue (kind, subject, message, debounce_kind)
  values (p_kind, p_subject, p_message, p_debounce_kind);
end;
$function$;

revoke all on function public._queue_system_alert(text, text, text, text) from public, anon, authenticated;

-- ── 3) Drenaje: resuelve lo que está en vuelo + dispara lo que toca ─────────

CREATE OR REPLACE FUNCTION public.system_alert_queue_drain()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_row         record;
  v_status_code int;
  v_error_msg   text;
  v_secret      text;
  v_new_request bigint;
  v_to_fire     int;
  v_degraded_n  int;
begin
  -- 3.1) Resolver peticiones en vuelo (mandadas en un tick anterior)
  for v_row in
    select * from public.system_alert_queue
    where status = 'pending' and request_id is not null
    order by id
  loop
    select status_code, error_msg into v_status_code, v_error_msg
    from net._http_response where id = v_row.request_id;

    if found then
      if v_status_code = 200 then
        update public.system_alert_queue
          set status = 'sent', sent_at = now(), request_id = null
          where id = v_row.id;
        -- (b) — el antiruido se consume AQUÍ, con la entrega confirmada, no
        -- al encolar. Si nunca se confirma, esta línea nunca se ejecuta.
        if v_row.debounce_kind is not null then
          insert into public.db_health_alert_log (kind, detail)
            values (v_row.debounce_kind, 'entregado por la cola, intento ' || v_row.attempts);
        end if;
      else
        update public.system_alert_queue set
          status     = case when v_row.attempts >= 3 then 'failed' else 'pending' end,
          request_id = null,
          last_error = coalesce('http ' || v_status_code, v_error_msg, 'fallo desconocido')
        where id = v_row.id;
      end if;
    elsif v_row.last_attempt_at < now() - interval '2 minutes' then
      -- pg_net no ha respondido tras 2min (timeout_milliseconds=10000
      -- debería haber resuelto mucho antes) — se da por perdida esa
      -- petición concreta. Mismo case when de arriba: si es el 3er intento,
      -- 'failed' — sin esto, una fila en su último intento sin respuesta se
      -- queda en limbo para siempre (ni se reintenta, ni se marca failed).
      update public.system_alert_queue set
        status     = case when v_row.attempts >= 3 then 'failed' else 'pending' end,
        request_id = null,
        last_error = 'sin respuesta de pg_net tras 2min'
      where id = v_row.id;
    end if;
    -- si no se cumple ninguna condición, la petición sigue en vuelo, se
    -- revisará en el próximo tick.
  end loop;

  -- 3.2) Disparar (primer intento o reintento) las que están listas
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';

  select count(*) into v_to_fire
  from public.system_alert_queue
  where status = 'pending' and request_id is null and attempts < 3;

  if v_secret is null then
    if v_to_fire > 0 then
      raise warning 'system_alert_queue_drain: secret cron_secret ausente en Vault, % aviso(s) en cola sin poder dispararse', v_to_fire;
    end if;
  else
    for v_row in
      select * from public.system_alert_queue
      where status = 'pending' and request_id is null and attempts < 3
      order by id
    loop
      select net.http_post(
        url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body    := jsonb_build_object('subject', v_row.subject, 'message', v_row.message, 'kind', v_row.kind),
        timeout_milliseconds := 10000
      ) into v_new_request;
      update public.system_alert_queue
        set request_id = v_new_request, attempts = attempts + 1, last_attempt_at = now()
        where id = v_row.id;
    end loop;
  end if;

  delete from public.system_alert_queue
    where status in ('sent', 'failed') and created_at < now() - interval '7 days';

  -- 3.3) Meta-aviso (a) — imprescindible, no opcional. "Degradado" = al
  -- menos un FALLO CONFIRMADO en la última hora (last_error solo se rellena
  -- al confirmar un fallo, nunca al disparar — ver nota de la cabecera
  -- sobre el bug encontrado con attempts>0).
  select count(*) into v_degraded_n
  from public.system_alert_queue
  where last_error is not null and created_at >= now() - interval '60 minutes';

  if v_degraded_n > 0 then
    -- Vía 1, independiente del canal de correo: logs de Postgres.
    raise warning 'system_alert_queue_drain: % aviso(s) sin poder entregarse en la última hora — el canal de alertas puede estar caído', v_degraded_n;

    -- Vía 2, mejor esfuerzo por el canal normal — antiruido por CREACIÓN
    -- (no por confirmación, ver nota de diseño de la cabecera: si se
    -- exigiera confirmación, un canal caído de verdad nunca la consumiría y
    -- encolaría una fila nueva cada minuto durante toda la caída).
    if not exists (
      select 1 from public.system_alert_queue
      where debounce_kind = 'db-health-alert-queue-degraded' and created_at >= now() - interval '60 minutes'
    ) then
      perform public._queue_system_alert(
        'db-health',
        'Canal de alertas degradado — ' || v_degraded_n || ' aviso(s) sin entregar en 1h',
        v_degraded_n || ' aviso(s) llevan en cola sin poder entregarse en la última hora (fallo de red/DNS o Resend). '
          || 'Revisa system_alert_queue (status=''failed'' o pending con last_error no nulo) y los logs de Postgres.',
        'db-health-alert-queue-degraded'
      );
    end if;
  end if;
exception when others then
  raise warning 'system_alert_queue_drain: excepción no controlada: %', sqlerrm;
  raise;
end;
$function$;

comment on function public.system_alert_queue_drain() is
  'Drena system_alert_queue cada minuto (cron system-alert-queue-drain): '
  'resuelve peticiones en vuelo contra net._http_response (200→sent, '
  'cualquier otro resultado→reintenta o failed a la 3ª) y dispara las que '
  'estén listas. El antiruido de cada tipo de aviso (db_health_alert_log) '
  'se escribe SOLO al confirmar un 200 — nunca al encolar (11/08, cierre '
  'del bug de fondo). Meta-aviso si hay fallos confirmados en la última '
  'hora — raise warning (independiente del canal) + un aviso más por el '
  'canal normal con antiruido propio de 60min por creación.';

revoke all on function public.system_alert_queue_drain() from public, anon, authenticated;

-- ── 4) db_health_watchdog: encola en vez de llamar a net.http_post directo ──

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
  v_stuck_print     int;
  v_inactive_print  int;
  v_route_failures  int;
begin
  begin
    v_snap       := public.db_health_snapshot();
    v_waiting    := (v_snap->>'waiting_locks')::int;
    v_total_conn := (v_snap->>'total_connections')::int;
    v_max_conn   := (v_snap->>'max_connections')::int;

    -- writer_count ya no se mide aquí: la columna queda NULL en esta fila.
    insert into public.db_health_snapshot_log
      (total_connections, waiting_locks, oldest_tx_seconds)
    values
      (v_total_conn, v_waiting, (v_snap->>'oldest_tx_seconds')::numeric);

    delete from public.db_health_snapshot_log where checked_at < now() - interval '48 hours';
    delete from public.db_health_alert_log where sent_at < now() - interval '30 days';

    -- Aviso 1 — bloqueos sostenidos
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
        'db_health_watchdog detectó más de 3 procesos esperando lock en ' || v_n_snapshots
          || ' snapshots consecutivos de los últimos 2 minutos (ahora mismo: ' || v_waiting || ').' || chr(10)
          || 'Conexiones de cliente: ' || v_total_conn
          || '. Transacción más antigua: ' || (v_snap->>'oldest_tx_seconds') || 's.' || chr(10)
          || 'Así empezó el incidente del 11/08. Revisar pg_stat_activity ya.',
        'db-health-lock'
      );
    end if;

    -- Aviso 2 — conexiones de CLIENTE cerca del máximo
    if v_max_conn > 0 and v_total_conn > 0.8 * v_max_conn
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-connections' and sent_at >= now() - interval '15 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        'BBDD cerca del límite de conexiones — ' || v_total_conn || '/' || v_max_conn,
        'db_health_watchdog detectó ' || v_total_conn || ' conexiones de CLIENTE activas de un máximo de '
          || v_max_conn || ' (>80%).' || chr(10)
          || 'Revisar pg_stat_activity: puede ser el mismo patrón del 11/08.',
        'db-health-connections'
      );
    end if;

    -- Aviso 3 (regresión de escritores) sigue en db_health_writer_regression_check() — cron propio cada 15 min.

    -- Aviso 4 — print_job en pending >2h
    select count(*) into v_stuck_print
    from print_job
    where status = 'pending' and created_at < now() - interval '2 hours';

    if v_stuck_print > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-stuck' and sent_at >= now() - interval '60 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        v_stuck_print || ' trabajo(s) de impresión atascados >2h',
        'db_health_watchdog detectó ' || v_stuck_print || ' print_job en pending desde hace más de 2 horas.' || chr(10)
          || 'Así se acumularon los 76 de Carabanchel (08-09/08) durante 3 días sin que nadie se enterara.',
        'db-health-print-stuck'
      );
    end if;

    -- Aviso 5 — print_job no terminal en impresora inactiva
    select count(*) into v_inactive_print
    from print_job pj
    join printer p on p.id = pj.printer_id
    where pj.status in ('pending', 'sent') and p.is_active = false;

    if v_inactive_print > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-inactive-printer' and sent_at >= now() - interval '60 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        v_inactive_print || ' trabajo(s) de impresión encolados a impresora INACTIVA',
        'db_health_watchdog detectó ' || v_inactive_print || ' print_job (pending/sent) cuya impresora tiene is_active=false.' || chr(10)
          || 'Nunca se van a imprimir: claim_print_jobs solo reclama de impresoras activas.',
        'db-health-print-inactive-printer'
      );
    end if;

    -- Aviso 6 — pedidos aceptados sin ninguna impresora activa
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
        'db_health_watchdog detectó ' || v_route_failures || ' aviso(s) en print_route_failure_log de los últimos 10 minutos.',
        'db-health-print-no-active-printer'
      );
    end if;

  exception when others then
    if not exists (
      select 1 from public.db_health_alert_log
      where kind = 'db-health-watchdog-error' and sent_at >= now() - interval '30 minutes'
    ) then
      perform public._queue_system_alert(
        'db-health-watchdog-error',
        'db_health_watchdog FALLÓ',
        'El vigía de salud de BBDD lanzó una excepción: ' || sqlerrm,
        'db-health-watchdog-error'
      );
    end if;
    raise;
  end;
end;
$function$;

comment on function public.db_health_watchdog() is
  'Registra un snapshot cada minuto (cron db-health-watchdog) y ENCOLA (en '
  'system_alert_queue, ya no llama a net.http_post directo — 11/08) ante 5 '
  'condiciones independientes (bloqueos sostenidos, conexiones de cliente '
  '>80%, print_job pending >2h, print_job no terminal en impresora '
  'inactiva, pedidos sin impresora activa), cada una con su propio antiruido '
  'en db_health_alert_log (consumido solo al confirmarse la entrega, ver '
  'system_alert_queue_drain). La regresión del guard anti-escritura se '
  'evalúa aparte, cada 15 min, en db_health_writer_regression_check(). '
  'Nunca falla en silencio.';

-- ── 5) db_health_writer_regression_check: idem ──────────────────────────────

CREATE OR REPLACE FUNCTION public.db_health_writer_regression_check()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_snap    jsonb;
  v_writers int;
begin
  begin
    v_snap := public.db_health_snapshot();

    -- Guard anti-regresión: funciones de public con `update ... kds_device`.
    -- Esperado SIEMPRE 3. Medido: 283ms (barrido de pg_proc con regex).
    select count(*) into v_writers
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~* 'update\s+(public\.)?kds_device';

    insert into public.db_health_snapshot_log
      (total_connections, waiting_locks, oldest_tx_seconds, writer_count)
    values (
      (v_snap->>'total_connections')::int,
      (v_snap->>'waiting_locks')::int,
      (v_snap->>'oldest_tx_seconds')::numeric,
      v_writers
    );

    -- Autoarmado: el aviso de REGRESIÓN solo tiene sentido si alguna vez estuvo en 3.
    if v_writers <> 3
       and exists (select 1 from public.db_health_snapshot_log where writer_count = 3)
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-writer-regression' and sent_at >= now() - interval '24 hours'
       ) then
      perform public._queue_system_alert(
        'db-health',
        'REGRESIÓN: ' || v_writers || ' funciones escriben kds_device (se esperaban 3)',
        'Alguien ha vuelto a meter una escritura de last_seen_at en una función de LECTURA de kds_device '
          || '(el incidente completo del 11/08, de nuevo).' || chr(10)
          || 'Esperado: kds_heartbeat, report_device_app_version, set_device_mode_by_token — y nada más.' || chr(10)
          || 'Este chequeo corre cada 15 min; los Avisos 1/2 del watchdog (cada minuto) ya habrían cazado el SÍNTOMA antes.',
        'db-health-writer-regression'
      );
    end if;
  exception when others then
    if not exists (
      select 1 from public.db_health_alert_log
      where kind = 'db-health-writer-regression-check-error' and sent_at >= now() - interval '30 minutes'
    ) then
      perform public._queue_system_alert(
        'db-health-writer-regression-check-error',
        'db_health_writer_regression_check FALLÓ',
        'El chequeo de regresión de escritores (cada 15 min) lanzó una excepción: ' || sqlerrm,
        'db-health-writer-regression-check-error'
      );
    end if;
    raise;
  end;
end;
$function$;

comment on function public.db_health_writer_regression_check() is
  'Chequeo cada 15 MIN del guard anti-regresión de escritores de '
  'kds_device. ENCOLA (system_alert_queue, ya no net.http_post directo — '
  '11/08) en vez de avisar directo; antiruido consumido solo al confirmarse '
  'la entrega.';

-- ── 6) db_health_stale_devices_report: idem (sin antiruido — no lo tenía) ──

CREATE OR REPLACE FUNCTION public.db_health_stale_devices_report()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_list  text;
  v_count int;
begin
  -- LEFT JOIN a propósito: un dispositivo con location_id NULL es justo el
  -- que más interesa reportar.
  select string_agg(
           format('%s (%s) — último latido: %s',
             d.label, coalesce(l.name, 'sin local'), coalesce(d.last_seen_at::text, 'nunca')),
           chr(10) order by d.last_seen_at nulls first
         ), count(*)
    into v_list, v_count
  from kds_device d
  left join locations l on l.id = d.location_id
  where d.is_active
    and (d.last_seen_at is null or d.last_seen_at < now() - interval '30 days');

  if v_count is null or v_count = 0 then
    return; -- silencioso: nada que avisar hoy
  end if;

  perform public._queue_system_alert(
    'db-health-stale-devices',
    v_count || ' dispositivo(s) KDS activo(s) sin latido hace más de 30 días',
    'Solo REPORTE — ninguna baja automática. Revisar si siguen en uso o dar de baja a mano (is_active=false):'
      || chr(10) || chr(10) || v_list
  );
exception when others then
  perform public._queue_system_alert(
    'db-health-stale-devices-error',
    'db_health_stale_devices_report FALLÓ',
    'El reporte diario de dispositivos fantasma lanzó una excepción: ' || sqlerrm
  );
  raise;
end;
$function$;

comment on function public.db_health_stale_devices_report() is
  'Reporte DIARIO de kds_device con is_active=true y last_seen_at NULL o '
  '>30 días. Solo aviso — CERO efecto operativo automático. ENCOLA '
  '(system_alert_queue) en vez de avisar directo — 11/08. Sin antiruido '
  'propio (nunca lo tuvo: la cadencia diaria del cron ya lo es).';

select cron.schedule(
  'system-alert-queue-drain',
  '* * * * *',
  $cron$select public.system_alert_queue_drain()$cron$
);

notify pgrst, 'reload schema';
