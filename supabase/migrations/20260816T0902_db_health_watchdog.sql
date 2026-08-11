-- Aplicada: PENDIENTE (Julio, por MCP).
--
-- ENCARGO fix/kds-latido-raiz · Tarea B — vigía de salud de BBDD.
-- El 11/08 nos enteramos de la caída porque la app no cargaba: no había nada que
-- avisara ANTES. Este vigía cierra ese hueco: RPC de chequeo + cron cada minuto +
-- rastro con retención corta + aviso por el canal de notificaciones YA EXISTENTE
-- (edge `system-alert`, ya versionada en supabase/functions/system-alert — no se
-- crea edge nueva: el patrón "cron llama a system-alert vía net.http_post con
-- x-cron-secret de Vault" ya existe en producción, ver el cron
-- `hubrise-order-stuck-watchdog`, que este vigía calca).
--
-- ADENDA (11/08 mañana) sobre esta migración:
--
-- §1 Umbral corregido a persistencia entre snapshots — YA estaba así desde la
-- entrega anterior (db_health_snapshot() es un chequeo instantáneo del conteo
-- agregado de wait_event_type='Lock'; db_health_watchdog() exige que TODOS los
-- snapshots de los últimos 2 min lo rompan y que haya al menos 2, para no
-- disparar con una lectura suelta). La adenda confirma que esta es la lectura
-- correcta: en la madrugada del 11/08 cada espera individual duraba 1-3s
-- (statement_timeout cancelaba antes de los 2min) — un umbral por-proceso
-- nunca habría sonado. Se añade AQUÍ la segunda condición barata que pide la
-- adenda: conexiones totales > 80% de max_connections (agotamiento de pool,
-- el otro modo de fallo de una tormenta de escrituras).
--
-- §5 (reformulado) — Julio retira la auto-baja por 30 días sin latido (rompe
-- con el calendario real de hostelería: un bar cerrado en agosto no es un
-- dispositivo fantasma) y pide en su lugar un REPORTE, sin efecto operativo
-- automático. Se añade db_health_stale_devices_report(): cron DIARIO
-- (separado del vigía de bloqueos, que es cada minuto — mezclar un reporte de
-- inventario de baja frecuencia en el cron crítico de cada minuto sería ruido)
-- que lista kds_device activos sin latido >30 días y avisa solo si hay alguno
-- (silencioso si no).
--
-- §6 Guardia anti-regresión — db_health_snapshot() ahora también cuenta
-- cuántas funciones de public tienen `update ... kds_device` en su cuerpo
-- (regex de la propia adenda: 'update\s+(public\.)?kds_device'). Esperado
-- SIEMPRE 3, y ESTOS SON LOS 3 LEGÍTIMOS (no tocar sin actualizar este
-- comentario y el umbral):
--   1) kds_heartbeat                 — el latido de raíz (este encargo)
--   2) report_device_app_version     — reporte de versión al arrancar la app
--   3) set_device_mode_by_token      — cambio de modo al vincular la tablet
-- Si el conteo != 3 en cualquier snapshot futuro, alguien ha vuelto a meter
-- una escritura en una función de lectura (el incidente completo del 11/08,
-- de nuevo) y el vigía avisa (con antiruido de 24h, no cada minuto).
--
-- §4 de la adenda (kds_authorize no comprueba is_active) — VERIFICADO Y
-- REFUTADO por RECON en vivo, NO se aplica ningún cambio a kds_authorize:
-- kds_resolve_device (la única puerta de entrada por token; barrido de
-- pg_proc confirma que NINGUNA función busca kds_device por token sin pasar
-- por ella) ya filtra `is_active = true`. Probado empíricamente contra 2 de
-- los 3 dispositivos que Julio dio de baja esta mañana (Cocina Alcalá y
-- Tablet J): kds_authorize(location_id, token) con su token real devuelve
-- 'kds: token de dispositivo no válido' — ya no autorizan, hoy, sin tocar
-- nada de esta migración. No hay escritura correctiva que hacer aquí.
--
-- SIN CATCH MUDO: si el propio chequeo falla, el vigía intenta avisar de ESE
-- fallo por el mismo canal (con su propio antiruido de 30min) y relanza la
-- excepción (queda también en cron.job_run_details).
--
-- Antiruido general: cada tipo de aviso (bloqueos, conexiones, regresión,
-- fallo del propio vigía) se debounca por separado en db_health_alert_log —
-- tabla de auditoría de avisos enviados, no solo un flag.
--
-- Validado por MCP con nombres temporales _tmp_check_* antes de escribir este
-- fichero: db_health_snapshot() corrió contra pg_stat_activity real (hoy:
-- writer_count=15 — correcto, 0900/0901 aún no aplicadas, confirma que el
-- guard detecta el estado "no son 3"); la lógica de persistencia de bloqueos
-- se probó aparte con 3 casos (ver commit anterior). AVISO DE TRANSPARENCIA:
-- una de estas pruebas (con writer_count=15 real) SÍ disparó una llamada real
-- a system-alert (aviso 'db-health-writer-regression' de prueba, visible en
-- net._http_response) — inofensivo, ningún dato tocado, pero es un correo de
-- prueba real que habrá llegado a SYSTEM_ALERT_TO. Avisado en el parte, no se
-- oculta.
--
-- ENCARGO fix/limpieza-kds-viejo-y-prevencion (11/08 mediodía) · Tarea C —
-- añade 3 avisos MÁS a este mismo vigía (no se crea otro), pedido explícito
-- del encargo: "no crear otro vigía". Aviso 4 y 5 son los dos pedidos
-- literalmente por la Tarea C (print_job atascado >2h; print_job en impresora
-- inactiva). El Aviso 6 es el rastro que pide la Tarea B ("si no hay ninguna
-- impresora activa, no fallar en silencio... que el vigía de la Tarea C lo
-- recoja") — ver 20260816T0904_print_job_no_fallar_en_silencio.sql, que
-- escribe en print_route_failure_log (tabla creada aquí TAMBIÉN, `if not
-- exists`, para que el orden de aplicación 0902↔0904 no importe).
--
-- RECON que corrige la causa raíz asumida por el encargo (§1): los 76
-- trabajos de Carabanchel NO se encolaron a una impresora ya inactiva — los
-- 7 creadores de print_job que enrutan automáticamente (enqueue_print_job,
-- tg_auto_print_on_accept, tg_auto_print_bag_on_ready, reprint_order[_by_token])
-- YA filtran `is_active` correctamente (verificado leyendo las 7 definiciones
-- vivas). Lo que pasó de verdad, con fecha exacta: la impresora "Cocina" de
-- Carabanchel estuvo ACTIVA todo el tiempo que se crearon los 76 trabajos
-- (08/08 18:57 → 09/08 12:18:04); "Impre" (misma IP) se creó a las 09/08
-- 12:19:26 y "Cocina" se desactivó 24s después, 12:19:50 — CERO trabajos se
-- crearon después de la desactivación. El fallo mudo real es que
-- `upsert_printer` (a diferencia de `delete_printer`, que si bloquea con
-- print_job pendientes) no avisa ni bloquea al desactivar una impresora con
-- trabajos pendientes detrás. NO se añade ese bloqueo aquí a propósito: con
-- tablets polleando cada 3s casi siempre hay algún print_job en pending de
-- los últimos segundos (trabajo normal en curso, no atascado) — bloquear la
-- desactivación con ese mismo predicado habría hecho casi imposible apagar
-- una impresora activa en horario de servicio. El Aviso 5 (periódico, cada
-- minuto) es la red de seguridad correcta para este caso exacto: detecta lo
-- mismo sin arriesgar bloquear una desactivación de emergencia legítima.

-- ── 1) Tablas de rastro y de avisos (retención corta, deny-all — patrón F0.3) ─

create table if not exists public.db_health_snapshot_log (
  id                 bigint generated by default as identity primary key,
  checked_at         timestamptz not null default now(),
  total_connections  int not null,
  waiting_locks      int not null,
  oldest_tx_seconds  numeric not null,
  writer_count       int not null
);

comment on table public.db_health_snapshot_log is
  'RLS deny-all intencional (vigía interno de salud de BBDD). Acceso solo vía '
  'SECURITY DEFINER (fix/kds-latido-raiz, 11/08). Retención: 48h, se autolimpia '
  'en cada ejecución de db_health_watchdog(). waiting_locks = conteo crudo de '
  'pg_stat_activity con wait_event_type=Lock en el momento del snapshot; la '
  'persistencia (>3 durante >2min) se evalúa comparando snapshots consecutivos. '
  'writer_count = nº de funciones public con `update ... kds_device` en su '
  'cuerpo — guard anti-regresión, esperado SIEMPRE 3.';

alter table public.db_health_snapshot_log enable row level security;

create index if not exists idx_db_health_snapshot_log_checked_at
  on public.db_health_snapshot_log (checked_at desc);

create table if not exists public.db_health_alert_log (
  id      bigint generated by default as identity primary key,
  kind    text not null,
  sent_at timestamptz not null default now(),
  detail  text
);

comment on table public.db_health_alert_log is
  'RLS deny-all intencional. Auditoría + antiruido de los avisos que manda '
  'db_health_watchdog()/db_health_stale_devices_report() — un aviso de tipo '
  '`kind` no se repite mientras exista una fila reciente de ese kind dentro de '
  'su ventana de debounce (15min bloqueos/conexiones, 24h regresión, 30min '
  'fallo del propio vigía). Retención: 30 días.';

alter table public.db_health_alert_log enable row level security;

create index if not exists idx_db_health_alert_log_kind_sent_at
  on public.db_health_alert_log (kind, sent_at desc);

-- print_route_failure_log: la crea también 20260816T0904 (Tarea B del encargo
-- fix/limpieza-kds-viejo-y-prevencion, 11/08) — `if not exists` a propósito en
-- los dos ficheros para que el orden de aplicación entre 0902 y 0904 no importe.
-- Rastro que escriben tg_auto_print_on_accept/tg_auto_print_bag_on_ready cuando
-- un pedido no tiene NINGUNA impresora activa a la que imprimir (fallo mudo real
-- detectado 11/08: hoy esas funciones no dejan rastro si el local se queda sin
-- impresoras activas — el pedido se acepta y nunca imprime nada, sin aviso).
create table if not exists public.print_route_failure_log (
  id           bigint generated by default as identity primary key,
  account_id   uuid not null,
  location_id  uuid not null,
  sale_id      uuid,
  doc_type     text,
  detail       text not null,
  created_at   timestamptz not null default now()
);

comment on table public.print_route_failure_log is
  'RLS deny-all intencional. Rastro de "pedido aceptado sin impresora activa a '
  'la que imprimir" (fix/limpieza-kds-viejo-y-prevencion, 11/08) — lo escriben '
  'los triggers de auto-impresión, lo lee db_health_watchdog(). Sin retención '
  'explícita aquí (tabla de bajo volumen, un local mal configurado no genera '
  'mucho ruido); revisar manualmente si crece.';

alter table public.print_route_failure_log enable row level security;

create index if not exists idx_print_route_failure_log_created_at
  on public.print_route_failure_log (location_id, created_at desc);

-- ── 2) RPC de chequeo (puro, instantáneo, sin efectos secundarios) ────────────

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
  v_writer_count int;
  v_max_conn     int;
begin
  select count(*) into v_total_conn from pg_stat_activity;

  select count(*) into v_waiting_lock
  from pg_stat_activity
  where wait_event_type = 'Lock';

  select extract(epoch from max(now() - xact_start)) into v_oldest_tx_s
  from pg_stat_activity
  where xact_start is not null;

  -- Guard anti-regresión (§6): esperado SIEMPRE 3 — ver los 3 nombres
  -- legítimos documentados en la cabecera de este fichero.
  select count(*) into v_writer_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~* 'update\s+(public\.)?kds_device';

  select setting::int into v_max_conn from pg_settings where name = 'max_connections';

  return jsonb_build_object(
    'total_connections', v_total_conn,
    'waiting_locks',     v_waiting_lock,
    'oldest_tx_seconds', coalesce(round(v_oldest_tx_s), 0),
    'writer_count',      v_writer_count,
    'max_connections',   v_max_conn
  );
end;
$function$;

comment on function public.db_health_snapshot() is
  'Chequeo puro e instantáneo de salud de BBDD (conexiones, procesos '
  'esperando lock AHORA, tx más vieja, conteo anti-regresión de escritores de '
  'kds_device, max_connections). Sin efectos secundarios y sin juicio de '
  'persistencia — eso lo hace db_health_watchdog() comparando snapshots.';

-- ── 3) Vigía: registra + evalúa 3 condiciones + avisa (con antiruido) ────────

CREATE OR REPLACE FUNCTION public.db_health_watchdog()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_snap            jsonb;
  v_waiting         int;
  v_writers         int;
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
    v_writers    := (v_snap->>'writer_count')::int;
    v_total_conn := (v_snap->>'total_connections')::int;
    v_max_conn   := (v_snap->>'max_connections')::int;

    insert into public.db_health_snapshot_log
      (total_connections, waiting_locks, oldest_tx_seconds, writer_count)
    values
      (v_total_conn, v_waiting, (v_snap->>'oldest_tx_seconds')::numeric, v_writers);

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
                       || 'Conexiones totales: ' || v_total_conn
                       || '. Transacción más antigua: ' || (v_snap->>'oldest_tx_seconds') || 's.' || chr(10)
                       || 'Así empezó el incidente del 11/08 (caída ~45 min con los 3 locales cerrados). Revisar pg_stat_activity ya.',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-lock', v_waiting || ' esperando lock');
      end if;
    end if;

    -- Aviso 2 — conexiones cerca del máximo (>80% de max_connections): el
    -- otro modo de fallo de una tormenta de escrituras (agotamiento de pool).
    -- Instantáneo, no exige persistencia. Antiruido: 15 min.
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
            'message', 'db_health_watchdog detectó ' || v_total_conn || ' conexiones activas de un máximo de '
                       || v_max_conn || ' (>80%).' || chr(10)
                       || 'Revisar pg_stat_activity: puede ser el mismo patrón del 11/08 (tormenta de escrituras agotando el pool).',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-connections', v_total_conn || '/' || v_max_conn);
      end if;
    end if;

    -- Aviso 3 — guard anti-regresión (§6): esperado SIEMPRE 3 escritores de
    -- kds_device (ver los 3 nombres legítimos en la cabecera del fichero).
    -- CORRECCIÓN (Julio, 11/08 2ª vuelta): hoy writer_count=16 porque 0900
    -- ya está aplicada pero 0901 (la que quita las 13 escrituras) todavía
    -- no — con el guard tal cual, el vigía mandaría un falso positivo desde
    -- su primer minuto de vida. El aviso solo tiene sentido para una
    -- REGRESIÓN: "ya estuvo en 3 alguna vez y ahora ya no". Se arma solo
    -- (sin flag manual ni fecha) exigiendo que exista al menos un snapshot
    -- histórico con writer_count=3 — antes de aplicar 0901 esa condición es
    -- imposible (nunca ha sido 3), así que el guard queda callado sin más;
    -- en cuanto 0901 se aplique y el cron registre su primer snapshot en 3,
    -- el guard se arma automáticamente para cualquier regresión futura.
    -- Límite conocido y documentado (no oculto): db_health_snapshot_log tiene
    -- retención de 48h — si una regresión futura durase >48h sin corregirse,
    -- el último snapshot bueno (writer_count=3) caería fuera de la ventana y
    -- este aviso dejaría de repetirse; para entonces ya habrían saltado ≥2
    -- avisos (antiruido 24h) sin que nadie actuara, así que es un caso de
    -- segundo orden. No se alarga la retención solo por esto (el encargo
    -- pide tabla pequeña a propósito).
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
                       || 'select proname from pg_proc join pg_namespace on ... where prosrc ~* ''update\s+(public\.)?kds_device'' para ver cuál.',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-writer-regression', v_writers || ' escritores');
      end if;
    end if;

    -- Aviso 4 (11/08, encargo fix/limpieza-kds-viejo-y-prevencion, Tarea C.1) —
    -- print_job en pending >2h: habría cazado el bloqueo de Carabanchel (76
    -- trabajos, 08-09/08) a las pocas horas en vez de a los 3 días. Antiruido
    -- 60min (no 24h: mientras un local tenga trabajos realmente atascados
    -- queremos que insista más a menudo que una regresión de código).
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

    -- Aviso 5 (Tarea C.2) — print_job no terminal (pending/sent) cuya impresora
    -- está is_active=false: error de configuración, no incidencia de red — la
    -- causa exacta del bloqueo de Carabanchel (76 trabajos correctamente
    -- encolados a "Cocina" MIENTRAS estaba activa, huérfanos en cuanto se
    -- desactivó 24s después de crear "Impre" como sustituta). Aviso INMEDIATO,
    -- sin exigir persistencia (a diferencia del Aviso 1): esto nunca es
    -- transitorio, siempre es una impresora mal apagada con cola detrás.
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

    -- Aviso 6 (Tarea B del mismo encargo, "no fallar en silencio") — pedidos
    -- aceptados sin NINGUNA impresora activa en el local: rastro que dejan
    -- tg_auto_print_on_accept/tg_auto_print_bag_on_ready en
    -- print_route_failure_log (ver tabla arriba). Ventana de 10min (~10 ciclos
    -- de este cron) más antiruido de 60min: suficiente para no perder el primer
    -- aviso aunque el cron llegue tarde un minuto.
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
    -- Sin catch mudo: si el propio chequeo falla, eso también es un aviso
    -- (con su propio antiruido de 30min para no repetir cada minuto).
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
      null; -- último recurso; queda igualmente en cron.job_run_details
    end;
    raise;
  end;
end;
$function$;

comment on function public.db_health_watchdog() is
  'Registra un snapshot cada minuto (cron db-health-watchdog) y avisa por '
  'system-alert ante 6 condiciones independientes, cada una con su propio '
  'antiruido en db_health_alert_log: (1) bloqueos sostenidos >2min, (2) '
  'conexiones >80% de max_connections, (3) regresión del guard anti-escritura '
  '(writer_count != 3), (4) print_job en pending >2h, (5) print_job no '
  'terminal en impresora is_active=false, (6) pedidos aceptados sin ninguna '
  'impresora activa (print_route_failure_log). Nunca falla en silencio.';

-- ── 4) Reporte DIARIO de dispositivos fantasma (§5 reformulado — SIN baja '
-- automática, solo aviso; separado del vigía de cada minuto a propósito) ────

CREATE OR REPLACE FUNCTION public.db_health_stale_devices_report()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_secret text;
  v_list   text;
  v_count  int;
begin
  -- LEFT JOIN a propósito (corrección Julio 11/08): un dispositivo con
  -- location_id NULL es justo el que más interesa reportar — con INNER JOIN
  -- desaparecía en vez de destacar.
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

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null then
    raise warning 'db_health_stale_devices_report: secret cron_secret ausente en Vault, no se pudo avisar';
    return;
  end if;

  perform net.http_post(
    url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object(
      'subject', v_count || ' dispositivo(s) KDS activo(s) sin latido hace más de 30 días',
      'message', 'Solo REPORTE — ninguna baja automática. Revisar si siguen en uso o dar de baja a mano (is_active=false):'
                 || chr(10) || chr(10) || v_list,
      'kind', 'db-health-stale-devices'
    ),
    timeout_milliseconds := 10000
  );
exception when others then
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
    if v_secret is not null then
      perform net.http_post(
        url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body    := jsonb_build_object(
          'subject', 'db_health_stale_devices_report FALLÓ',
          'message', 'El reporte diario de dispositivos fantasma lanzó una excepción: ' || sqlerrm,
          'kind', 'db-health-stale-devices-error'
        ),
        timeout_milliseconds := 10000
      );
    end if;
  exception when others then
    null;
  end;
  raise;
end;
$function$;

comment on function public.db_health_stale_devices_report() is
  'Reporte DIARIO (cron db-health-stale-devices-daily, 06:00 UTC ≈ 08:00 '
  'Madrid en verano) de kds_device '
  'con is_active=true y last_seen_at NULL o >30 días. Solo aviso — CERO '
  'efecto operativo automático (§5 de la adenda, retirada la auto-baja: no '
  'penaliza a un local cerrado por vacaciones). Silencioso si no hay nada '
  'que reportar.';

-- No exponer a clientes: solo el cron (postgres) las llama.
revoke all on function public.db_health_snapshot() from public, anon, authenticated;
revoke all on function public.db_health_watchdog() from public, anon, authenticated;
revoke all on function public.db_health_stale_devices_report() from public, anon, authenticated;

-- ── 5) Crons ─────────────────────────────────────────────────────────────────

select cron.schedule(
  'db-health-watchdog',
  '* * * * *',
  $cron$select public.db_health_watchdog()$cron$
);

-- 06:00 UTC (corrección Julio 11/08): cron.timezone de este proyecto es GMT
-- fijo, sin DST (verificado: show timezone / cron.timezone = 'GMT'). 06:00
-- UTC = 08:00 Madrid en horario de verano (CEST, UTC+2, que es lo que rige
-- ahora mismo, 11/08). En horario de invierno (CET, UTC+1) esto cae a las
-- 07:00 Madrid — pg_cron no soporta DST, ningún cron fijo da las 8 reales
-- los 365 días del año. Deuda menor, no se resuelve aquí.
select cron.schedule(
  'db-health-stale-devices-daily',
  '0 6 * * *',
  $cron$select public.db_health_stale_devices_report()$cron$
);
