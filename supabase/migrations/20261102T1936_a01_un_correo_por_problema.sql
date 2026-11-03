-- cambia: public.encolar_alerta · prueba: supabase/staging/sql/20261102_a01_un_correo_por_problema_prueba.sql
-- cambia: public.last_catalog_watchdog · prueba: supabase/staging/sql/20261102_a01_un_correo_por_problema_prueba.sql
--
-- supabase/migrations/20261102T1936_a01_un_correo_por_problema.sql
--
-- A01-1 · Un correo por problema, nunca cada hora (02/11/2026).
-- Julio (02/11, 18:56): «hay que cortar estos mensajes inútiles». En 7 días
-- salieron unos 205 correos de aviso, casi 30 al día; «Vende con el local
-- apagado en Folvy: Kitchen Grill LstQ» salió a las 17:01, 17:51 y 18:51.
--
-- Por qué se repetían: la clave del antirruido no era el problema. Los vigías
-- le ponen la FECHA («…_critico_20261026») o un md5 del texto
-- («ingesta_vende_apagado_<md5>»), y la ventana caduca (2 h, 3 h, 20 h): el
-- mismo problema abierto vuelve a mandar correo cada vez.
--
-- Lo que hace (decisiones de Julio del 02/11):
--   · REGLA 2, una vez por problema, para los tipos con vigía programado
--     (public.aviso_tipo, ocho tipos): la clave del problema es la del vigía sin
--     la fecha, sin el md5 y sin la severidad (_aviso_clave). Un problema
--       - ABRE: un correo;
--       - sigue abierto: ningún correo (se cuenta en aviso_problema);
--       - EMPEORA de verdad: sube de severidad (aviso → alto → crítico): un
--         correo «Empeora · …»;
--       - se RESUELVE: el vigía corre bien dos veces seguidas sin verlo
--         (cron.job_run_details de su tarea): un correo «Resuelto · …», y si
--         vuelve, es un problema nuevo. Lo mira avisos_resolver(), cada 10 min.
--     Los demás tipos siguen con su antirruido de siempre (db-health se calla
--     solo con su registro, y «Tickets sin imprimir» ya lo cortó el A01a).
--   · REGLA 5, techo diario: como mucho 10 correos de aviso al día (de Madrid).
--     Lo crítico pasa siempre. Pasado el techo, lo demás no se manda: queda en
--     public.aviso_callado, y sale UN correo «Techo de avisos alcanzado».
--   · El falso «espejo de Last»: last_catalog_watchdog mide las 3 h solo dentro
--     del horario de la sincronización (12–24 UTC, la tarea
--     last-catalog-sync-hourly). A las 12:00:01 la de las 23:00 de ayer lleva 1 h,
--     no 13. Solo cambia esa condición; el resto, byte a byte.
--
-- Simulado sobre los 7 días pasados (regla 31): los ocho tipos pasan de 103
-- correos a 67, con los «Resuelto»; con el techo, ningún día de más de 10.
--
-- Guarda: las dos funciones tienen que ser las medidas el 02/11 en producción
-- y en staging (iguales). Se respaldan antes. El analizador dice «sigue» (no las
-- cuenta en el camino del pedido), pero a encolar_alerta la llega a llamar algún
-- disparador de ventas (trg_sale_push_status, dentro de su propio «exception»):
-- si la lógica nueva falla dentro de encolar_alerta, se avisa y se sigue por el
-- camino de siempre. Un aviso nunca tumba al que lo encola.
--
-- Vuelta atrás: supabase/vuelta-atras/20261102T1936_a01_un_correo_por_problema.down.sql

do $guarda$
begin
  if md5(pg_get_functiondef('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)'::regprocedure)) <> '3e00b834580b069b93b8b5a1693c9585' then
    raise exception 'A01-1 PARADA: encolar_alerta no es la medida el 02/11 (md5 3e00b834…). Reescribirla pisaría ese cambio.';
  end if;
  if md5(pg_get_functiondef('public.last_catalog_watchdog()'::regprocedure)) <> 'c48e0f7bc1ff688279f84268594611b3' then
    raise exception 'A01-1 PARADA: last_catalog_watchdog no es la medida el 02/11 (md5 c48e0f7b…). Reescribirla pisaría ese cambio.';
  end if;
  if (length(pg_get_functiondef('public.last_catalog_watchdog()'::regprocedure))
      - length(replace(pg_get_functiondef('public.last_catalog_watchdog()'::regprocedure), 'x.max_synced < now() - interval ''3 hours''', '')))
     <> length('x.max_synced < now() - interval ''3 hours''') then
    raise exception 'A01-1 PARADA: la condición del espejo de Last no sale exactamente una vez en last_catalog_watchdog.';
  end if;
end $guarda$;

select public._respaldar_funcion('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)', '20261102T1936_a01_un_correo_por_problema');
select public._respaldar_funcion('public.last_catalog_watchdog()', '20261102T1936_a01_un_correo_por_problema');

-- ── Los tipos con vigía programado: los que siguen la regla 2 ────────────────
create table if not exists public.aviso_tipo (
  kind  text primary key,
  tarea text not null,
  nota  text
);
comment on table public.aviso_tipo is
  'A01-1 (02/11/2026). Los tipos de aviso que siguen «un correo por problema», con la tarea de cron de su vigía: un problema se da por resuelto cuando esa tarea corre bien dos veces sin volver a verlo.';
insert into public.aviso_tipo (kind, tarea, nota) values
  ('ingesta_silencio',             'ingesta-silencio-watchdog',      'ingesta_silencio_watchdog, cada 10 min'),
  ('last-catalog-sync',            'last-catalog-watchdog',          'last_catalog_watchdog, cada 15 min de 12 a 23 UTC'),
  ('venta_producto_sin_casar',     'sales-unmapped-watchdog',        'sales_unmapped_watchdog, cada hora'),
  ('kds_device_desfasado',         'kds-device-stale-bundle-daily',  'kds_device_stale_bundle_check, a las 07:30 UTC'),
  ('kds_device_silencio',          'kds-device-silence-check',       'kds_device_silence_check, cada 5 min'),
  ('comanda_viva_sin_cerrar',      'ventas-cerradas-sin-consumo',    'ventas_cerradas_sin_consumo_watchdog, cada hora'),
  ('venta_en_estado_imposible',    'ventas-cerradas-sin-consumo',    'ventas_cerradas_sin_consumo_watchdog, cada hora'),
  ('ventas_sin_con_que_descontar', 'ventas-cerradas-sin-consumo',    'ventas_cerradas_sin_consumo_watchdog, cada hora')
on conflict (kind) do nothing;

-- ── Cada problema, abierto o resuelto ─────────────────────────────────────────
create table if not exists public.aviso_problema (
  clave         text primary key,
  kind          text not null,
  account_id    uuid,
  location_id   uuid,
  asunto        text,
  abierto_at    timestamptz not null default now(),
  visto_at      timestamptz not null default now(),
  veces         integer not null default 1,
  rango_enviado integer not null default 2,
  resuelto_at   timestamptz,
  sin_resuelto  boolean not null default false
);
comment on table public.aviso_problema is
  'A01-1 (02/11/2026). Un problema por clave (la del vigía sin fecha, md5 ni severidad). Abierto si resuelto_at es null. rango_enviado: la severidad del último correo (1 aviso, 2 alto, 3 crítico). sin_resuelto: los que ya estaban abiertos el día que entró la regla; al resolverse no mandan correo.';
create index if not exists aviso_problema_abiertos on public.aviso_problema (kind) where resuelto_at is null;

-- ── Lo que calla el techo diario (no se pierde) ──────────────────────────────
create table if not exists public.aviso_callado (
  id            bigserial primary key,
  kind          text,
  subject       text,
  message       text,
  debounce_kind text,
  account_id    uuid,
  location_id   uuid,
  brand_id      uuid,
  severity      text,
  motivo        text not null,
  created_at    timestamptz not null default now()
);
comment on table public.aviso_callado is
  'A01-1 (02/11/2026). Los avisos que no se mandaron por el techo diario (10 al día, lo crítico pasa siempre). Se guardan 30 días.';

alter table public.aviso_tipo enable row level security;
alter table public.aviso_problema enable row level security;
alter table public.aviso_callado enable row level security;
revoke all on public.aviso_tipo, public.aviso_problema, public.aviso_callado from public, anon, authenticated;

-- ── Ayudantes ────────────────────────────────────────────────────────────────
-- La clave del problema: la del vigía sin md5, sin fecha y sin severidad.
create or replace function public._aviso_clave(p_debounce_kind text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(p_debounce_kind, '_[0-9a-f]{32}$', ''),
           '_\d{8}$', ''),
         '_(critico|alto|aviso|CRITICO|ALTO|AVISO)$', '')
$$;

-- La severidad como número: la que se pasa, o la que lleva la clave; sin ninguna, alto (como aguas abajo).
create or replace function public._aviso_rango(p_severity text, p_debounce_kind text)
returns integer language sql immutable set search_path = '' as $$
  select case lower(coalesce(p_severity,
                             substring(p_debounce_kind from '_(critico|alto|aviso|CRITICO|ALTO|AVISO)(?:_\d{8})?$'),
                             'alto'))
           when 'aviso' then 1 when 'medio' then 1 when 'bajo' then 1
           when 'critico' then 3 when 'crítico' then 3
           else 2 end
$$;

-- Las pasadas buenas de una tarea desde un momento (cron.job_run_details).
create or replace function public._aviso_pasadas_desde(p_tarea text, p_desde timestamptz)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = p_tarea and d.status = 'succeeded' and d.start_time > p_desde
$$;

-- Encola respetando el techo diario (10 al día de Madrid; lo crítico pasa).
create or replace function public._aviso_poner_en_cola(
  p_kind text, p_subject text, p_message text, p_debounce_kind text,
  p_account_id uuid, p_location_id uuid, p_brand_id uuid, p_severity text, p_rango integer)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  k_techo constant integer := 10;
  v_hoy timestamptz := (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
  v_id bigint;
begin
  if p_rango < 3 and (select count(*) from public.system_alert_queue
                       where created_at >= v_hoy and public._aviso_rango(severity, debounce_kind) < 3
                         and debounce_kind is distinct from 'aviso-techo-diario') >= k_techo then
    insert into public.aviso_callado (kind, subject, message, debounce_kind, account_id, location_id, brand_id, severity, motivo)
    values (p_kind, p_subject, p_message, p_debounce_kind, p_account_id, p_location_id, p_brand_id, p_severity, 'techo diario');
    if not exists (select 1 from public.system_alert_queue
                    where debounce_kind = 'aviso-techo-diario' and created_at >= v_hoy) then
      insert into public.system_alert_queue (kind, subject, message, debounce_kind, severity)
      values ('aviso-techo', 'Techo de avisos alcanzado: hoy ya van ' || k_techo,
              'Hoy ya han salido ' || k_techo || ' avisos. Hasta mañana solo salen los críticos; los demás se guardan '
              || 'sin mandar en aviso_callado (empezando por: ' || coalesce(p_subject, p_kind) || ').',
              'aviso-techo-diario', 'aviso');
    end if;
    return null;
  end if;
  insert into public.system_alert_queue (kind, subject, message, debounce_kind, account_id, location_id, brand_id, severity)
  values (p_kind, p_subject, p_message, p_debounce_kind, p_account_id, p_location_id, p_brand_id, p_severity)
  returning id into v_id;
  return v_id;
end $$;

-- Horas sin sincronizar contadas solo dentro del horario de la sincronización de
-- Last (de 12 a 24 UTC, last-catalog-sync-hourly «0 12-23 * * *»).
create or replace function public._last_horas_en_horario(p_desde timestamptz, p_ahora timestamptz default now())
returns numeric language sql stable set search_path = '' as $$
  select case when p_desde is null then 999::numeric else
    coalesce((select sum(greatest(0, extract(epoch from (
                 least(p_ahora at time zone 'UTC', d + interval '24 hours')
               - greatest(p_desde at time zone 'UTC', d + interval '12 hours')))))
                from generate_series(date_trunc('day', p_desde at time zone 'UTC'),
                                     date_trunc('day', p_ahora at time zone 'UTC'), interval '1 day') d), 0) / 3600.0
  end
$$;

-- ── encolar_alerta: la de antes, con la regla 2 y el techo ───────────────────
CREATE OR REPLACE FUNCTION public.encolar_alerta(p_kind text, p_subject text, p_message text, p_debounce_kind text DEFAULT NULL::text, p_debounce_window interval DEFAULT NULL::interval, p_account_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_brand_id uuid DEFAULT NULL::uuid, p_severity text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id bigint;
  v_cuenta uuid;
  v_clave text;
  v_rango integer;
  v_p public.aviso_problema%ROWTYPE;
  v_asunto text := p_subject;
BEGIN
  -- DM1 · PR 2a (31/10): una cuenta de demo no cuenta en los avisos. La del
  -- aviso, o la de su local, o la de su marca; sin ninguna, sigue como antes.
  v_cuenta := coalesce(
    p_account_id,
    (SELECT l.account_id FROM public.locations l WHERE l.id = p_location_id),
    (SELECT b.account_id FROM public.brand b WHERE b.id = p_brand_id));
  IF v_cuenta IS NOT NULL AND NOT public.cuenta_puede_salir(v_cuenta) THEN
    RETURN NULL;
  END IF;

  v_rango := public._aviso_rango(p_severity, p_debounce_kind);

  -- A01-1 (02/11): un correo por problema, para los tipos con vigía programado.
  -- Abre: un correo. Sigue abierto: ninguno. Empeora (sube de severidad): uno.
  -- Se resuelve: lo dice avisos_resolver(). Si esto falla, se avisa y se sigue
  -- por el camino de siempre: un aviso nunca tumba al que lo encola.
  IF p_debounce_kind IS NOT NULL AND EXISTS (SELECT 1 FROM public.aviso_tipo t WHERE t.kind = p_kind) THEN
    BEGIN
      v_clave := public._aviso_clave(p_debounce_kind);
      INSERT INTO public.aviso_problema (clave, kind, account_id, location_id, asunto, rango_enviado, resuelto_at)
      VALUES (v_clave, p_kind, p_account_id, p_location_id, p_subject, 0, now())
      ON CONFLICT (clave) DO NOTHING;
      SELECT * INTO v_p FROM public.aviso_problema WHERE clave = v_clave FOR UPDATE;

      IF v_p.resuelto_at IS NULL THEN
        IF v_rango <= v_p.rango_enviado THEN
          UPDATE public.aviso_problema SET visto_at = now(), veces = veces + 1 WHERE clave = v_clave;
          RETURN NULL;
        END IF;
        UPDATE public.aviso_problema
           SET visto_at = now(), veces = veces + 1, rango_enviado = v_rango, asunto = p_subject
         WHERE clave = v_clave;
        v_asunto := 'Empeora · ' || p_subject;
      ELSE
        -- Nuevo, o vuelve después de resuelto: es un problema nuevo.
        UPDATE public.aviso_problema
           SET kind = p_kind, account_id = p_account_id, location_id = p_location_id, asunto = p_subject,
               abierto_at = now(), visto_at = now(), veces = 1, rango_enviado = v_rango,
               resuelto_at = NULL, sin_resuelto = false
         WHERE clave = v_clave;
      END IF;

      RETURN public._aviso_poner_en_cola(p_kind, v_asunto, p_message, p_debounce_kind,
                                         p_account_id, p_location_id, p_brand_id, p_severity, v_rango);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'encolar_alerta: la regla de un correo por problema ha fallado (%), sigue por el camino de siempre', SQLERRM;
    END;
  END IF;

  -- El antirruido, igual que antes. Devuelve NULL cuando NO encola, para que
  -- el llamador pueda distinguir «encolado» de «callado a propósito». La vieja
  -- devolvía void y las dos cosas se veían igual desde fuera.
  IF p_debounce_kind IS NOT NULL THEN
    -- 1) Ya hay uno pendiente con esta clave: no apilar.
    IF EXISTS (
      SELECT 1 FROM public.system_alert_queue
       WHERE debounce_kind = p_debounce_kind AND status = 'pending'
    ) THEN
      RETURN NULL;
    END IF;

    -- 2) Ya se encoló uno con esta clave dentro de la ventana: no repetir.
    IF p_debounce_window IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.system_alert_queue
       WHERE debounce_kind = p_debounce_kind
         AND created_at > now() - p_debounce_window
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  -- A01-1: con el techo diario (10 al día; lo crítico pasa siempre).
  RETURN public._aviso_poner_en_cola(p_kind, p_subject, p_message, p_debounce_kind,
                                     p_account_id, p_location_id, p_brand_id, p_severity, v_rango);
END;
$function$;

-- ── Resolver: dos pasadas buenas del vigía sin verlo ─────────────────────────
create or replace function public.avisos_resolver()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_n integer := 0;
begin
  for r in
    select p.*, t.tarea from public.aviso_problema p join public.aviso_tipo t on t.kind = p.kind
     where p.resuelto_at is null
     order by p.visto_at
     for update of p skip locked
  loop
    if public._aviso_pasadas_desde(r.tarea, r.visto_at) >= 2 then
      update public.aviso_problema set resuelto_at = now() where clave = r.clave;
      v_n := v_n + 1;
      if not r.sin_resuelto then
        perform public._aviso_poner_en_cola(
          r.kind, 'Resuelto · ' || coalesce(r.asunto, r.kind),
          'Ya no se ve: el vigía (' || r.tarea || ') ha pasado dos veces sin encontrarlo. '
          || 'Abierto desde el ' || to_char(r.abierto_at at time zone 'Europe/Madrid', 'DD/MM HH24:MI')
          || '; visto por última vez el ' || to_char(r.visto_at at time zone 'Europe/Madrid', 'DD/MM HH24:MI')
          || ' (' || r.veces || ' veces).',
          null, r.account_id, r.location_id, null, 'aviso', 1);
      end if;
    end if;
  end loop;
  delete from public.aviso_callado where created_at < now() - interval '30 days';
  return v_n;
end $$;

revoke all on function public._aviso_pasadas_desde(text, timestamptz) from public, anon, authenticated;
revoke all on function public._aviso_poner_en_cola(text, text, text, text, uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.avisos_resolver() from public, anon, authenticated;

-- Los que ya estaban abiertos hoy (los vigías los siguen viendo): entran como
-- abiertos y sin correo de «Resuelto», para que el día que entra la regla no
-- salga un correo por cada uno.
insert into public.aviso_problema (clave, kind, account_id, location_id, asunto, abierto_at, visto_at, veces, rango_enviado, sin_resuelto)
select public._aviso_clave(q.debounce_kind), (array_agg(q.kind order by q.created_at desc))[1],
       (array_agg(q.account_id order by q.created_at desc))[1], (array_agg(q.location_id order by q.created_at desc))[1],
       (array_agg(q.subject order by q.created_at desc))[1], min(q.created_at), max(q.created_at), count(*)::integer,
       max(public._aviso_rango(q.severity, q.debounce_kind)), true
  from public.system_alert_queue q join public.aviso_tipo t on t.kind = q.kind
 where q.debounce_kind is not null and q.created_at > now() - interval '24 hours'
 group by public._aviso_clave(q.debounce_kind)
on conflict (clave) do nothing;

-- ── last_catalog_watchdog: las 3 h, solo en el horario de la sincronización ──
do $last$
begin
  execute replace(pg_get_functiondef('public.last_catalog_watchdog()'::regprocedure),
                  'x.max_synced < now() - interval ''3 hours''',
                  'public._last_horas_en_horario(x.max_synced) > 3');
end $last$;

-- ── La tarea que resuelve, cada 10 min ───────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-resolver') then
      perform cron.unschedule('avisos-resolver');
    end if;
    perform cron.schedule('avisos-resolver', '*/10 * * * *', $cron$select public.avisos_resolver()$cron$);
  end if;
end $$;
