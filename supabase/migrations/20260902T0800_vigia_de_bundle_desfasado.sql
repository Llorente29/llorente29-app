-- 20260902T0800_vigia_de_bundle_desfasado.sql
--
-- NADA AVISA DE UN APARATO QUE SE QUEDA ATRÁS.
--
-- El 01/09 había dos tablets en la misma cocina de Alcalá con DIECIOCHO bundles
-- de diferencia — Pase en el 203 y Cocina en el 185, del 27/08 — y ningún vigía
-- lo dijo. `kds_device_silence_check` mira si un aparato CALLA, no si va
-- DESFASADO. Y un aparato que sirve comandas con código de hace cinco días es
-- tan peligroso como uno apagado; más, porque nadie sospecha de él: late, pinta
-- pedidos y contesta.
--
-- ── POR QUÉ SE LEE DEL TEXTO LIBRE Y NO DE UNA COLUMNA NUEVA ────────────────
-- La tentación es añadir `kds_device.bundle_id int` y que el cliente lo mande
-- limpio. NO FUNCIONA para lo que hace falta: el aparato que va atrasado corre
-- CÓDIGO VIEJO, así que jamás enviará un campo que se añada hoy. El vigía se
-- quedaría ciego exactamente con los aparatos que viene a cazar. Por eso lee lo
-- que los clientes YA mandan: `app_version`, texto libre con la forma
-- "1.0.49 (49) · bundle 203" (ver src/native/appUpdate.ts).
-- Una columna limpia es una buena mejora PARA DESPUÉS, cuando los tres estén al
-- día, y nunca sustituye a esta lectura: sería volver a la misma ceguera.
--
-- ── EL PARSEO FALLA HACIA AVISAR, NUNCA HACIA VERDE ─────────────────────────
-- Si la cadena no casa, el estado es 'desconocido', NO 'al_dia'. Un vigía que
-- no sabe leer una versión y por eso se calla es peor que no tenerlo. Y hay un
-- caso real de esto: una tablet recién instalada que aún no ha aplicado ninguna
-- OTA reporta "1.0.49 (49)" SIN sufijo de bundle — está corriendo el bundle
-- empotrado en el APK, del 31/07, o sea la MÁS atrasada de todas. Esa cae en
-- 'builtin' y se avisa, que es justo lo contrario de lo que haría un LIKE mal
-- puesto.
--
-- ── UN UMBRAL ORDENA, NO ESCONDE (regla 7) ─────────────────────────────────
-- `kds_device_bundle_status` NO filtra nada: es lo que pinta la pantalla de
-- Dispositivos, que alguien abre a propósito, y ahí salen los cuatro aparatos
-- con su estado. El umbral de 24 h vive SOLO en el vigía que interrumpe.
--
-- ── POR QUÉ 24 H Y NO "no está en el último" ───────────────────────────────
-- Estar un bundle por detrás es NORMAL durante horas: UpdateGate aplica en
-- ventana segura y nunca en mitad de un pedido. Avisar de eso sería ruido
-- diario y en dos semanas nadie lee el aviso. Lo que NO es normal es que exista
-- algo más nuevo desde hace más de un día y el aparato siga sin cogerlo. Por eso
-- el desfase se mide en TIEMPO DESDE QUE HAY ALGO MEJOR PUBLICADO, no en número
-- de bundles: 18 bundles publicados todos esta mañana no son un problema; uno
-- solo, publicado hace tres días, sí.
--
-- NO APLICADA. Claude Code propone, Julio ejecuta y verifica.

begin;

-- ── 1 · El último bundle publicado ─────────────────────────────────────────
-- La verdad está en el bucket, que es lo que las tablets se descargan de
-- verdad. No en una tabla que alguien tenga que acordarse de actualizar: una
-- versión que hay que acordarse de subir es una versión que se queda en julio.
create or replace function public._ultimo_bundle_publicado()
returns table (bundle_id int, publicado_en timestamptz)
language sql
stable
security definer
set search_path to 'public', 'storage'
as $$
  select (regexp_replace(o.name, '\D', '', 'g'))::int, o.created_at
  from storage.objects o
  where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
  order by 1 desc
  limit 1;
$$;

revoke all on function public._ultimo_bundle_publicado() from public, anon;
grant execute on function public._ultimo_bundle_publicado() to authenticated, service_role;

-- ── 2 · Estado de cada aparato ─────────────────────────────────────────────
create or replace function public.kds_device_bundle_status(p_location_id uuid default null)
returns table (
  device_id      uuid,
  label          text,
  local          text,
  is_active      boolean,
  app_version    text,
  bundle_actual  int,
  ultimo_bundle  int,
  atraso_bundles int,
  horas_desfase  int,
  last_seen_at   timestamptz,
  estado         text          -- al_dia · atrasado · muy_atrasado · builtin · desconocido
)
language plpgsql
stable
security definer
set search_path to 'public', 'storage'
as $$
declare
  v_ultimo int;
begin
  select b.bundle_id into v_ultimo from public._ultimo_bundle_publicado() b;

  return query
  with d as (
    select dev.id, dev.label, coalesce(l.name, 'sin local') as loc, dev.is_active,
           dev.app_version, dev.last_seen_at, dev.account_id,
           (regexp_match(dev.app_version, '· bundle (\d+)'))[1]::int as b_actual,
           -- Reportó versión pero SIN sufijo de bundle: corre el empotrado del APK.
           (dev.app_version is not null and dev.app_version !~ '· bundle \d+') as es_builtin
    from kds_device dev
    left join locations l on l.id = dev.location_id
    where dev.account_id = any(public.current_user_account_ids())
      and (p_location_id is null or dev.location_id = p_location_id)
  )
  select
    d.id, d.label, d.loc, d.is_active, d.app_version,
    d.b_actual, v_ultimo,
    case when d.b_actual is not null then v_ultimo - d.b_actual end,
    -- Horas desde que se publicó el PRIMER bundle más nuevo que el suyo.
    case when d.b_actual is not null and v_ultimo > d.b_actual then (
      select round(extract(epoch from (now() - min(o.created_at)))/3600)::int
      from storage.objects o
      where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
        and (regexp_replace(o.name, '\D', '', 'g'))::int > d.b_actual
    ) end,
    d.last_seen_at,
    case
      when d.es_builtin                              then 'builtin'
      when d.b_actual is null                        then 'desconocido'
      when d.b_actual >= v_ultimo                    then 'al_dia'
      when (select round(extract(epoch from (now() - min(o.created_at)))/3600)
              from storage.objects o
             where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
               and (regexp_replace(o.name, '\D', '', 'g'))::int > d.b_actual) >= 24
                                                     then 'muy_atrasado'
      else 'atrasado'
    end
  from d
  order by
    case when d.b_actual is null then 0 else 1 end,  -- lo que no se sabe, arriba
    d.b_actual asc nulls first, d.label;
end;
$$;

revoke all on function public.kds_device_bundle_status(uuid) from public, anon;
grant execute on function public.kds_device_bundle_status(uuid) to authenticated, service_role;

-- ── 3 · El vigía diario ────────────────────────────────────────────────────
-- Núcleo SIN guarda de sesión a propósito (lo llama pg_cron, que no tiene
-- auth.uid()). Los permisos son la ÚNICA protección: cerrado a public, anon y
-- authenticated. Se dejó abierto tres veces ya; aquí no.
create or replace function public.kds_device_stale_bundle_check()
returns integer
language plpgsql
security definer
set search_path to 'public', 'storage'
as $$
declare
  v_ultimo int;
  v_d      record;
  v_n      int := 0;
  v_txt    text;
begin
  select b.bundle_id into v_ultimo from public._ultimo_bundle_publicado() b;
  if v_ultimo is null then
    raise warning 'kds_device_stale_bundle_check: no hay ningun bundle en el bucket apps';
    return 0;
  end if;

  for v_d in
    select dev.id, dev.label, coalesce(l.name,'sin local') as loc, dev.account_id,
           dev.app_version,
           (regexp_match(dev.app_version, '· bundle (\d+)'))[1]::int as b_actual,
           (dev.app_version is not null and dev.app_version !~ '· bundle \d+') as es_builtin
    from kds_device dev
    left join locations l on l.id = dev.location_id
    where dev.is_active
      -- Un aparato que nunca ha reportado no es cosa de este vigia: o esta
      -- mudo (y de eso avisa kds_device_silence_check) o nunca se uso.
      and dev.app_version is not null
  loop
    v_txt := null;

    if v_d.es_builtin then
      v_txt := 'Nunca ha aplicado ninguna actualizacion: sigue con el codigo empotrado en el APK. '
            || 'Es la version mas antigua que puede correr un aparato.';
    elsif v_d.b_actual is null then
      -- No sabemos leer su version. Se avisa igual: callarse aqui es como el
      -- "sin alertas" en verde de Alcala del 29/08.
      v_txt := 'No se ha podido leer que version corre (reporta "' || v_d.app_version || '"). '
            || 'Mientras no se pueda leer, este aparato NO esta vigilado.';
    elsif v_d.b_actual < v_ultimo then
      declare v_h int;
      begin
        select round(extract(epoch from (now() - min(o.created_at)))/3600)::int into v_h
        from storage.objects o
        where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
          and (regexp_replace(o.name,'\D','','g'))::int > v_d.b_actual;
        if v_h >= 24 then
          v_txt := 'Corre el bundle ' || v_d.b_actual || ' y el ultimo publicado es el ' || v_ultimo
                || ' (' || (v_ultimo - v_d.b_actual) || ' por detras). '
                || 'Hay version mas nueva desde hace ' || v_h || ' horas y no la ha cogido.';
        end if;
      end;
    end if;

    continue when v_txt is null;

    v_n := v_n + 1;
    raise warning 'kds_device_stale_bundle_check: % (%) desfasado', v_d.label, v_d.loc;

    perform public._queue_system_alert(
      'kds_device_desfasado',
      'Tablet con codigo viejo: ' || v_d.label || ' (' || v_d.loc || ')',
      'La tablet "' || v_d.label || '" del local ' || v_d.loc || ' esta sirviendo comandas con '
      || 'codigo antiguo. ' || v_txt || ' '
      || 'Late y contesta con normalidad, que es lo que hace esto dificil de notar. '
      || 'Suele bastar con dejarla encendida y con red un rato fuera de servicio: la '
      || 'actualizacion se aplica sola en ventana segura, nunca en mitad de un pedido.',
      'kds_desfasado_' || v_d.id::text,
      interval '20 hours'   -- una vez al dia, con margen para que no se salte un dia
    );
  end loop;

  return v_n;
end;
$$;

revoke all on function public.kds_device_stale_bundle_check() from public, anon, authenticated;
grant execute on function public.kds_device_stale_bundle_check() to service_role;

-- ── 4 · Programacion ───────────────────────────────────────────────────────
-- 09:30 Madrid: antes del servicio y despues de que alguien haya encendido las
-- tablets. A las 06:00 estarian apagadas y el aviso llegaria sin que nadie
-- pueda hacer nada.
select cron.unschedule('kds-device-stale-bundle-daily')
where exists (select 1 from cron.job where jobname = 'kds-device-stale-bundle-daily');

select cron.schedule(
  'kds-device-stale-bundle-daily',
  '30 7 * * *',   -- UTC = 09:30 Madrid en horario de verano
  $cron$select public.kds_device_stale_bundle_check()$cron$
);

-- ── 5 · Verificacion ───────────────────────────────────────────────────────
do $verif$
declare
  v_n int;
begin
  if to_regprocedure('public.kds_device_bundle_status(uuid)') is null then
    raise exception 'kds_device_bundle_status no quedo creada';
  end if;

  -- Nacen cerradas. El nucleo lo llama pg_cron; si anon o authenticated pueden
  -- ejecutarlo, el permiso es la unica proteccion y esta rota.
  if has_function_privilege('anon', 'public.kds_device_stale_bundle_check()', 'execute')
     or has_function_privilege('authenticated', 'public.kds_device_stale_bundle_check()', 'execute') then
    raise exception 'el vigia nacio alcanzable por anon o authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.kds_device_stale_bundle_check()', 'execute') then
    raise exception 'service_role no puede ejecutar el vigia';
  end if;

  if not exists (select 1 from cron.job where jobname = 'kds-device-stale-bundle-daily' and active) then
    raise exception 'el cron diario no quedo programado';
  end if;

  -- Con los datos de hoy tiene que ver EXACTAMENTE un aparato desfasado:
  -- Cocina (Alcala), bundle 185 del 27/08 contra el 203. Si sale 0, el parseo
  -- no esta leyendo el texto libre y el vigia es un placebo.
  select count(*) into v_n
  from kds_device dev
  where dev.is_active and dev.app_version is not null
    and (regexp_match(dev.app_version, '· bundle (\d+)'))[1]::int
        < (select bundle_id from public._ultimo_bundle_publicado());
  if v_n = 0 then
    raise exception 'el parseo de app_version no lee ningun bundle: el vigia seria un placebo';
  end if;
  raise notice 'VERIFICACION OK: % aparato(s) por detras del ultimo bundle', v_n;
end;
$verif$;

commit;
