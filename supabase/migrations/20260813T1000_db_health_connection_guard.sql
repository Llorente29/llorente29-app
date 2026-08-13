-- Aplicada: PENDIENTE (13/08/2026, cocina cerrada).
--
-- VIGÍA DE CONEXIONES — Capa 1 (avisar antes y que el aviso SALGA) + Capa 3 (autodefensa).
-- Diseño: claude_folvy_vigia_conexiones_diseno_20260813.md
-- Incidente: claude_folvy_incidente_20260813_conexiones_causa_raiz.md
--
-- POR QUÉ UNA FUNCIÓN NUEVA Y NO TOCAR db_health_watchdog:
--   1. No romper los 5 avisos que ya funcionan.
--   2. PEQUEÑA = arranca aunque la base esté cargada. db_health_watchdog falló 245 veces con
--      "job startup timeout" el 13/08: era demasiado grande para arrancar en el ahogo.
--   3. Usa current_setting('max_connections') en vez de `select from pg_settings`: esa vista es
--      la que aparece en los logs tardando 10.464 ms (era el propio vigía ahogándose).
--
-- NO crea tablas ni columnas. Reutiliza db_health_snapshot_log y _queue_system_alert.

create or replace function public.db_health_connection_guard()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_max        int;
  v_total      int;
  v_idle       int;
  v_quien      text;
  v_hace10     int;
  v_secret     text;
  v_killed     int := 0;
  v_lista      text;
begin
  -- Lectura BARATA (no pg_settings: esa vista fue la que tardó 10 s el 13/08).
  v_max := current_setting('max_connections')::int;

  select count(*) filter (where backend_type = 'client backend'),
         count(*) filter (where backend_type = 'client backend' and state = 'idle')
    into v_total, v_idle
  from pg_stat_activity;

  -- ── CAPA 3 · AUTODEFENSA (>90%) ────────────────────────────────────────────
  -- Mata SOLO conexiones ociosas de más de 5 min. NUNCA 'active' (trabajo en curso)
  -- ni 'idle in transaction' (transacción abierta: matarla perdería trabajo).
  -- El pool del cliente reabre solo — es comportamiento estándar de cualquier pool.
  if v_total > 0.90 * v_max then
    with muertas as (
      select pid, coalesce(nullif(application_name,''), '(sin nombre)') as app
      from pg_stat_activity
      where backend_type = 'client backend'
        and state = 'idle'
        and state_change < now() - interval '5 minutes'
        and pid <> pg_backend_pid()
        and coalesce(application_name,'') not in ('pg_cron scheduler','mgmt-api','postgres_exporter')
    ), ejecutado as (
      select app, pg_terminate_backend(pid) as ok from muertas
    )
    select count(*) filter (where ok),
           string_agg(distinct app, ', ')
      into v_killed, v_lista
    from ejecutado;

    if coalesce(v_killed,0) > 0 then
      perform public._queue_system_alert(
        'db-health',
        'AUTODEFENSA: liberadas ' || v_killed || ' conexiones ociosas (' || v_total || '/' || v_max || ')',
        'db_health_connection_guard cerró ' || v_killed || ' conexión(es) en estado idle de más de 5 min '
          || 'al superar el 90% del límite. Origen: ' || coalesce(v_lista,'?') || '.' || chr(10)
          || 'Ninguna conexión activa ni con transacción abierta fue tocada; los pools reabren solos.' || chr(10)
          || 'ESTO ES UN SÍNTOMA: revisar quién está abriendo tantas conexiones.',
        'db-health-autodefensa'
      );
    end if;
  end if;

  -- ── CAPA 1 · AVISO TEMPRANO (65%) o POR TENDENCIA (+10 en 10 min) ──────────
  select total_connections into v_hace10
  from public.db_health_snapshot_log
  where checked_at <= now() - interval '10 minutes'
  order by checked_at desc
  limit 1;

  if v_total > 0.65 * v_max
     or (v_hace10 is not null and v_total - v_hace10 >= 10) then

    -- Antiruido: 15 min, igual que el resto de avisos de db-health.
    if not exists (
      select 1 from public.db_health_alert_log
      where kind = 'db-health-conn-guard' and sent_at >= now() - interval '15 minutes'
    ) then

      -- QUIÉN las consume: sin esto el aviso dice "53/60" y hay que entrar a mirar…
      -- y el 13/08 NO SE PODÍA ENTRAR A MIRAR.
      select string_agg(linea, ' · ' order by n desc)
        into v_quien
      from (
        select coalesce(nullif(application_name,''),'(sin nombre)') || ': ' || count(*)
                 || ' (' || count(*) filter (where state='idle') || ' idle)' as linea,
               count(*) as n
        from pg_stat_activity
        where backend_type = 'client backend'
        group by 1
        order by n desc
        limit 3
      ) t;

      -- ENVÍO DIRECTO, sin pasar por system_alert_queue: el 13/08 el drain también
      -- estaba ahogado (250 fallos) — el aviso de "me quedo sin conexiones" NO puede
      -- depender de otro cron que se ahoga en el mismo momento.
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';

      if v_secret is not null then
        perform net.http_post(
          url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/system-alert',
          headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
          body    := jsonb_build_object(
                       'kind',    'db-health',
                       'subject', 'Conexiones subiendo — ' || v_total || '/' || v_max
                                    || case when v_hace10 is not null then ' (hace 10 min: ' || v_hace10 || ')' else '' end,
                       'message', 'Conexiones de cliente: ' || v_total || ' de ' || v_max
                                    || ' (' || v_idle || ' ociosas).' || chr(10)
                                    || 'Quién: ' || coalesce(v_quien,'?') || chr(10)
                                    || 'Autodefensa a partir de ' || ceil(0.90*v_max) || '. Aviso enviado DIRECTO.'
                     ),
          timeout_milliseconds := 5000
        );
        insert into public.db_health_alert_log (kind, detail)
          values ('db-health-conn-guard', v_total || '/' || v_max || ' — ' || coalesce(v_quien,'?'));
      else
        raise warning 'db_health_connection_guard: sin cron_secret, aviso no enviado (%/%)', v_total, v_max;
      end if;
    end if;
  end if;

exception when others then
  -- Nunca tumbar el cron por un fallo del vigía; dejar rastro (regla: nada de catch mudo).
  raise warning 'db_health_connection_guard: excepcion: %', sqlerrm;
end;
$function$;

comment on function public.db_health_connection_guard() is
  'Vigía de conexiones (13/08): avisa al 65% o si suben +10 en 10 min, con QUIÉN las consume y
   envío DIRECTO (no por system_alert_queue, que se ahoga a la vez). A partir del 90% libera
   conexiones idle de más de 5 min (nunca activas ni en transacción). Función pequeña a propósito:
   debe poder arrancar cuando la base ya va mal.';
