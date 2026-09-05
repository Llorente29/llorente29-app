-- ENCARGO fix/limpieza-kds-viejo-y-prevencion — 2 correcciones sobre la 0902.
--
-- Correccion 1: el Aviso 2 comparaba magnitudes distintas. db_health_snapshot()
-- contaba count(*) de pg_stat_activity a secas contra max_connections, pero
-- pg_stat_activity incluye ~9-10 procesos internos (pg_cron launcher, pg_net
-- worker, walwriter, walsender, autovacuum launcher, logical replication
-- launcher, background writer, archiver, checkpointer) que NO ocupan plaza de
-- max_connections. Medido 11/08: 45 en pg_stat_activity vs 20 client backends
-- reales -> el aviso saltaba al ~40% de ocupacion real, no al 80%.
-- Arreglado filtrando backend_type='client backend'. waiting_locks y
-- oldest_tx_seconds se dejan SIN filtrar: un lock o una transaccion larga de
-- autovacuum es un problema real igual que si fuera de un cliente.
--
-- Correccion 2: writer_count sale del chequeo de cada minuto. Medido en
-- produccion: el barrido de pg_proc con regex sobre prosrc cuesta 283ms, y se
-- ejecutaba 1.440 veces/dia para un aviso cuyo antiruido es de 24h. Pasa a
-- funcion y cron propios CADA 15 MIN (decision de Julio): coste ~27s/dia y
-- deteccion <=15min. Se descarto la cadencia diaria porque una regresion
-- desplegada un viernes por la manana no se detectaria hasta el sabado de
-- madrugada, plena hora punta de fin de semana.
-- writer_count queda NULL en las filas del minuto (respuesta honesta a "no se
-- ha medido aqui") en vez de arrastrar el ultimo valor conocido.
-- El autoarmado del guard no se rompe: sigue siendo un exists(... = 3), y ya
-- hay filas historicas con 3.

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='db_health_snapshot') then
    raise exception '0906: falta db_health_snapshot — parar';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='db_health_watchdog') then
    raise exception '0906: falta db_health_watchdog — parar';
  end if;
end $$;

-- 1) writer_count admite NULL
alter table public.db_health_snapshot_log alter column writer_count drop not null;
comment on table public.db_health_snapshot_log is
  'RLS deny-all intencional (vigia interno de salud de BBDD). Retencion 48h. '
  'total_connections = pg_stat_activity filtrado a backend_type=client backend '
  '(corregido 11/08). waiting_locks = conteo crudo de TODO pg_stat_activity. '
  'writer_count es NULL en las filas del chequeo de cada minuto y solo lleva '
  'valor real en la fila que inserta cada 15 min '
  'db_health_writer_regression_check() — esperado SIEMPRE 3 cuando no es NULL.';

-- 2) db_health_snapshot(): conexiones reales, sin writer_count
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
  -- Corregido 11/08: solo client backend cuenta plaza de max_connections.
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
  'Chequeo puro e instantaneo (conexiones de CLIENTE real, procesos esperando '
  'lock, tx mas vieja, max_connections). Sin writer_count desde la 0906.';

-- 3) db_health_watchdog(): igual, menos el Aviso 3 (trasladado)
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

    -- writer_count ya no se mide aqui: la columna queda NULL en esta fila.
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
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', 'BBDD con bloqueos — ' || v_waiting || ' proceso(s) esperando lock, sostenido >2min',
            'message', 'db_health_watchdog detecto mas de 3 procesos esperando lock en ' || v_n_snapshots
                       || ' snapshots consecutivos de los ultimos 2 minutos (ahora mismo: ' || v_waiting || ').' || chr(10)
                       || 'Conexiones de cliente: ' || v_total_conn
                       || '. Transaccion mas antigua: ' || (v_snap->>'oldest_tx_seconds') || 's.' || chr(10)
                       || 'Asi empezo el incidente del 11/08. Revisar pg_stat_activity ya.',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-lock', v_waiting || ' esperando lock');
      end if;
    end if;

    -- Aviso 2 — conexiones de CLIENTE cerca del maximo (corregido 11/08)
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
            'subject', 'BBDD cerca del limite de conexiones — ' || v_total_conn || '/' || v_max_conn,
            'message', 'db_health_watchdog detecto ' || v_total_conn || ' conexiones de CLIENTE activas de un maximo de '
                       || v_max_conn || ' (>80%).' || chr(10)
                       || 'Revisar pg_stat_activity: puede ser el mismo patron del 11/08.',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-connections', v_total_conn || '/' || v_max_conn);
      end if;
    end if;

    -- Aviso 3 (regresion de escritores) TRASLADADO a
    -- db_health_writer_regression_check() — cron propio cada 15 min.

    -- Aviso 4 — print_job en pending >2h
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
            'subject', v_stuck_print || ' trabajo(s) de impresion atascados >2h',
            'message', 'db_health_watchdog detecto ' || v_stuck_print || ' print_job en pending desde hace mas de 2 horas.' || chr(10)
                       || 'Asi se acumularon los 76 de Carabanchel (08-09/08) durante 3 dias sin que nadie se enterara.',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-print-stuck', v_stuck_print || ' trabajos');
      end if;
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
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', v_inactive_print || ' trabajo(s) de impresion encolados a impresora INACTIVA',
            'message', 'db_health_watchdog detecto ' || v_inactive_print || ' print_job (pending/sent) cuya impresora tiene is_active=false.' || chr(10)
                       || 'Nunca se van a imprimir: claim_print_jobs solo reclama de impresoras activas.',
            'kind', 'db-health'
          ),
          timeout_milliseconds := 10000
        );
        insert into public.db_health_alert_log (kind, detail) values ('db-health-print-inactive-printer', v_inactive_print || ' trabajos');
      end if;
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
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body    := jsonb_build_object(
            'subject', 'Pedido(s) aceptado(s) sin impresora activa en el local',
            'message', 'db_health_watchdog detecto ' || v_route_failures || ' aviso(s) en print_route_failure_log de los ultimos 10 minutos.',
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
              'subject', 'db_health_watchdog FALLO',
              'message', 'El vigia de salud de BBDD lanzo una excepcion: ' || sqlerrm,
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
  'Snapshot cada minuto (cron db-health-watchdog) + 5 avisos independientes '
  '(bloqueos sostenidos, conexiones de cliente >80%, print_job pending >2h, '
  'print_job en impresora inactiva, pedidos sin impresora activa), cada uno con '
  'su antiruido. La regresion de escritores se evalua aparte cada 15 min en '
  'db_health_writer_regression_check(). Nunca falla en silencio.';

-- 4) Nueva funcion: regresion de escritores, cada 15 min
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
    -- Guard anti-regresion: funciones de public con `update ... kds_device`.
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

    -- Autoarmado: el aviso de REGRESION solo tiene sentido si alguna vez estuvo en 3.
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
            'subject', 'REGRESION: ' || v_writers || ' funciones escriben kds_device (se esperaban 3)',
            'message', 'Alguien ha vuelto a meter una escritura de last_seen_at en una funcion de LECTURA de kds_device '
                       || '(el incidente completo del 11/08, de nuevo).' || chr(10)
                       || 'Esperado: kds_heartbeat, report_device_app_version, set_device_mode_by_token — y nada mas.' || chr(10)
                       || 'Este chequeo corre cada 15 min; los Avisos 1/2 del watchdog (cada minuto) ya habrian cazado el SINTOMA antes.',
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
              'subject', 'db_health_writer_regression_check FALLO',
              'message', 'El chequeo de regresion de escritores (cada 15 min) lanzo una excepcion: ' || sqlerrm,
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
  'Chequeo cada 15 MIN (cron db-health-writer-regression-15m) del guard '
  'anti-regresion de escritores de kds_device (esperado SIEMPRE 3). Trasladado '
  'desde db_health_watchdog() el 11/08 por coste (283ms medido). Inserta 1 fila '
  'cada 15 min con writer_count real; el resto de filas lo dejan NULL.';

revoke all on function public.db_health_writer_regression_check() from public, anon, authenticated;

-- 5) Cron cada 15 minutos
select cron.schedule(
  'db-health-writer-regression-15m',
  '*/15 * * * *',
  $cron$select public.db_health_writer_regression_check()$cron$
);

notify pgrst, 'reload schema';