-- ═══════════════════════════════════════════════════════════════════════════
-- EL VIGÍA DE TABLETS DEJA DE INVENTARSE EL HORARIO · 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── LO QUE HABÍA, Y LO QUE COSTÓ ──────────────────────────────────────────
--
-- `kds_device_silence_check` corre cada 5 minutos (cron 43) y avisa de una
-- tablet que lleva rato sin latir. Para no gritar de madrugada tenía esto:
--
--     v_hora := extract(hour from (now() at time zone 'Europe/Madrid'));
--     if not (v_hora >= 11 or v_hora < 1) then return 0; end if;
--
-- Once de la mañana a la una. A pelo, igual para todos los locales, todos los
-- días del año. No lee `business_hours` ni `business_hours_exception`.
--
-- MEDIDO en la base entera (tabla completa, y se etiqueta como tal, regla 9):
-- de los 32 tramos horarios que existen, CERO abren antes de las 11:00 y CERO
-- cierran después de la 01:00. La apertura más temprana de toda la base es a
-- las 13:00. O sea que la ventana de este vigía es DOS HORAS más ancha que la
-- realidad por delante, todos los días, y nunca más estrecha.
--
-- Eso no es una hipótesis: es exactamente lo que pasó. De los 5 avisos
-- `kds_device_silencio` que existen, TRES salieron a las 11:00:00 clavadas
--
--     10/09 (jue) 11:00:00 · Pase (Alcalá) ·  44 min sin latir
--     11/09 (vie) 11:00:00 · Pase (Alcalá) · 570 min sin latir
--     12/09 (sáb) 11:00:00 · Pase (Alcalá) · 550 min sin latir
--
-- 570 minutos son nueve horas y media: la tablet llevaba apagada desde la
-- madrugada. No se había roto nada. Se había hecho de noche. El vigía disparó
-- en el primer tic de una ventana que abre dos horas antes que el local, y el
-- aviso decía «en horario de servicio», que era falso.
--
-- Los otros dos SÍ eran de verdad, y son la otra mitad de la prueba:
--
--     10/09 (jue) 21:00:00 · Pase (Alcalá)      · 10 min
--     11/09 (vie) 20:35:00 · camichi4 (Caraban) · 15 min
--
-- ── LOS DOS ARREGLOS ──────────────────────────────────────────────────────
--
-- 1. El horario se LEE, no se supone. Excepción del día si la hay, patrón
--    semanal si no — la misma precedencia que `is_brand_open` y que
--    `_ventana_de_mantenimiento`, copiada de allí y no inventada.
--
-- 2. El silencio se cuenta desde que ABRE, no desde el último latido. Una
--    tablet que ha estado apagada toda la noche y el local abre a las 13:00 no
--    lleva 570 minutos callada «en servicio»: lleva los que hayan pasado desde
--    las 13:00. Sin esto, el arreglo 1 solo habría movido el falso aviso de las
--    11:00 a las 13:00.
--
-- ── LA AUSENCIA DE HORARIO NO CIERRA NADA, Y AQUÍ MENOS ───────────────────
--
-- 🔴 Esta mañana apliqué justo lo contrario en la ventana de mantenimiento --que
-- un día sin fila semanal declaraba el cierre-- y lo reverti 71 segundos
-- después: Alcalá vendió 487 veces en diez lunes sin tener el lunes declarado.
--
-- Pero la dirección segura NO es la misma en los dos sitios, y ese es el
-- fondo del asunto:
--
--   · En la VENTANA de mantenimiento, «cerrado» significa ventana libre, o sea
--     PERMISO para tocar. Equivocarse hacia «cerrado» actualiza tablets en
--     mitad del servicio. Sin dato ⇒ se espera.
--   · En este VIGÍA, «cerrado» significa callarse. Equivocarse hacia «cerrado»
--     se traga una avería de verdad. Sin dato ⇒ se habla.
--
-- Por eso aquí hay CUATRO estados y no tres, y el lunes de Alcalá cae en el que
-- habla:
--
--   en_servicio             un tramo cubre este instante
--   cerrado_declarado       o una excepción de hoy dice cerrado, o el día SÍ
--                           tiene tramos y ninguno cubre ahora  → se calla
--   sin_horario_declarado_hoy  hoy no tiene ni excepción ni tramos, aunque
--                           otros días sí                       → HABLA
--   sin_horario             el local no tiene nada declarado    → HABLA
--
-- ── Y DE PASO, LO DEL #28 ─────────────────────────────────────────────────
--
-- Los 5 avisos `kds_device_silencio` están escritos con `account_id` y
-- `location_id` en NULL — la misma mezcla de cuentas del vigía 45. Como hay que
-- reescribir la función entera, pasa a `encolar_alerta`, que los lleva.
--
-- ── POR QUÉ DROP + CREATE ─────────────────────────────────────────────────
--
-- Se le añade `p_ahora` para poder ENSAYARLA en un instante elegido. Añadir un
-- parámetro es DROP + CREATE, nunca CREATE OR REPLACE (regla 2): replace
-- dejaría las dos firmas vivas y el cron 43, que llama con un argumento, se
-- volvería ambiguo. Y DROP + CREATE devuelve los permisos por defecto del
-- esquema, que fue la regresión del #28 esta misma mañana — así que abajo se
-- vuelven a poner EXACTOS y se comprueba con una aserción.
--
-- Permisos medidos ANTES: postgres=X/postgres, service_role=X/postgres.
--
-- ── LA BANDA, CONTADA ─────────────────────────────────────────────────────
--
-- Al vigía lo llaman: 0 funciones, 0 disparadores, 1 cron — el suyo, el 43.
-- Nada del camino del pedido. Ni el DROP+CREATE de una función ni el
-- CREATE OR REPLACE del ayudante toman cierre exclusivo sobre ninguna tabla
-- del pedido. (El primer contador que escribí dio «0 crons» y era FALSO: mi
-- regex excluía el punto de `public.`, que es justo como se llama. Se corrigió
-- y se volvió a contar.)

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · EN QUÉ ESTÁ EL LOCAL AHORA MISMO
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public._servicio_del_local(
  p_location_id uuid,
  p_ts          timestamptz default now()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hoy      date     := (p_ts at time zone 'Europe/Madrid')::date;
  v_ahora    time     := (p_ts at time zone 'Europe/Madrid')::time;
  v_ayer     date     := v_hoy - 1;
  v_dow      smallint := extract(dow from v_hoy)::smallint;       -- 0 = domingo
  v_dow_ayer smallint := extract(dow from v_ayer)::smallint;
  v_hay_exc  boolean;
  v_desde    time;
begin
  -- Igual que `is_brand_open` y que `_ventana_de_mantenimiento`: si hay
  -- excepción para esa fecha, manda la excepción y el patrón semanal no pinta.
  select exists (select 1 from business_hours_exception e
                  where e.location_id = p_location_id
                    and e.brand_id is null
                    and e.exception_date = v_hoy)
    into v_hay_exc;

  if v_hay_exc then
    select e.open_time into v_desde
      from business_hours_exception e
     where e.location_id = p_location_id
       and e.brand_id is null
       and e.exception_date = v_hoy
       and e.is_closed = false
       and e.open_time is not null and e.close_time is not null
       and ( (e.close_time >  e.open_time and v_ahora >= e.open_time and v_ahora < e.close_time)
          or (e.close_time <= e.open_time and (v_ahora >= e.open_time or v_ahora < e.close_time)) )
     order by e.open_time
     limit 1;

    if v_desde is not null then
      return jsonb_build_object('estado', 'en_servicio', 'origen', 'excepcion',
                                'desde', ((v_hoy + v_desde) at time zone 'Europe/Madrid'));
    end if;
    return jsonb_build_object('estado', 'cerrado_declarado', 'origen', 'excepcion', 'desde', null);
  end if;

  -- Tramo de HOY que cubre este instante.
  select h.open_time into v_desde
    from business_hours h
   where h.location_id = p_location_id
     and h.brand_id is null
     and h.weekday = v_dow
     and ( (h.close_time >  h.open_time and v_ahora >= h.open_time and v_ahora < h.close_time)
        or (h.close_time <= h.open_time and v_ahora >= h.open_time) )   -- abre hoy, cierra mañana
   order by h.open_time
   limit 1;

  if v_desde is not null then
    return jsonb_build_object('estado', 'en_servicio', 'origen', 'semanal',
                              'desde', ((v_hoy + v_desde) at time zone 'Europe/Madrid'));
  end if;

  -- Tramo de AYER que cruza medianoche y sigue abierto ahora.
  select h.open_time into v_desde
    from business_hours h
   where h.location_id = p_location_id
     and h.brand_id is null
     and h.weekday = v_dow_ayer
     and h.close_time <= h.open_time
     and v_ahora < h.close_time
   order by h.open_time
   limit 1;

  if v_desde is not null then
    return jsonb_build_object('estado', 'en_servicio', 'origen', 'semanal_ayer',
                              'desde', ((v_ayer + v_desde) at time zone 'Europe/Madrid'));
  end if;

  -- Ni excepción ni tramo abierto. Queda decidir si el día está DECLARADO
  -- cerrado o simplemente no se sabe, que no es lo mismo y aquí se paga caro.
  if exists (select 1 from business_hours h
              where h.location_id = p_location_id and h.brand_id is null and h.weekday = v_dow)
  then
    return jsonb_build_object('estado', 'cerrado_declarado', 'origen', 'semanal', 'desde', null);
  end if;

  if exists (select 1 from business_hours h
              where h.location_id = p_location_id and h.brand_id is null)
  then
    -- Tiene horario, pero no de HOY. El lunes de Alcalá vive aquí.
    return jsonb_build_object('estado', 'sin_horario_declarado_hoy', 'origen', 'semanal', 'desde', null);
  end if;

  return jsonb_build_object('estado', 'sin_horario', 'origen', null, 'desde', null);
end;
$fn$;

revoke all on function public._servicio_del_local(uuid, timestamptz) from public;
grant execute on function public._servicio_del_local(uuid, timestamptz) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · EL VIGÍA
-- ───────────────────────────────────────────────────────────────────────────
drop function if exists public.kds_device_silence_check(integer);

create function public.kds_device_silence_check(
  p_minutos int         default 10,
  p_ahora   timestamptz default null     -- sólo para ensayar en un instante elegido
) returns int
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_ahora     timestamptz := coalesce(p_ahora, now());
  v_umbral    int         := greatest(p_minutos, 3);
  v_d         record;
  v_serv      jsonb;
  v_estado    text;
  v_desde     timestamptz;
  v_ref       timestamptz;
  v_min       int;
  v_n         int := 0;   -- avisadas
  v_calla     int := 0;   -- calladas con el local cerrado (no se avisan, pero se cuentan)
  v_coletilla text;
begin
  for v_d in
    select d.id, d.label, d.account_id, d.location_id, d.app_version, d.last_seen_at,
           coalesce(l.name, 'sin local') as local
      from kds_device d
      left join locations l on l.id = d.location_id
     where d.is_active
       and d.last_seen_at is not null
  loop
    v_serv   := public._servicio_del_local(v_d.location_id, v_ahora);
    v_estado := v_serv->>'estado';
    v_desde  := nullif(v_serv->>'desde', '')::timestamptz;

    -- CERRADO DECLARADO es el único estado que calla. La ausencia de horario
    -- nunca calla: no saber si están trabajando no es saber que no lo están.
    if v_estado = 'cerrado_declarado' then
      if v_d.last_seen_at < v_ahora - make_interval(mins => v_umbral) then
        v_calla := v_calla + 1;
      end if;
      continue;
    end if;

    -- El silencio se cuenta desde que abre, no desde el último latido: lo que
    -- pasa con la tablet apagada fuera de servicio no es noticia de nadie.
    v_ref := greatest(v_d.last_seen_at, coalesce(v_desde, v_d.last_seen_at));
    v_min := round(extract(epoch from (v_ahora - v_ref)) / 60)::int;

    continue when v_min < v_umbral;

    v_coletilla := case v_estado
      when 'en_servicio' then
        'Lleva ' || v_min || ' minutos sin dar senal de vida en horario de servicio'
        || case when v_desde is not null and v_d.last_seen_at < v_desde
                then ' (se cuenta desde que abrio el local, no desde su ultimo latido)' else '' end
        || '. '
      when 'sin_horario_declarado_hoy' then
        'Lleva ' || v_min || ' minutos sin dar senal de vida. Este local NO tiene horario '
        || 'declarado para hoy, asi que no se puede saber si estabais trabajando: se avisa por '
        || 'si acaso. Declarar el horario de hoy hace que este aviso deje de salir en balde. '
      else
        'Lleva ' || v_min || ' minutos sin dar senal de vida. Este local no tiene ningun horario '
        || 'declarado, asi que no se puede saber si estabais trabajando: se avisa por si acaso. '
      end;

    v_n := v_n + 1;
    raise warning 'kds_device_silence_check: % (%) lleva % min sin latir [%]',
                  v_d.label, v_d.local, v_min, v_estado;

    perform public.encolar_alerta(
      'kds_device_silencio',
      'Tablet sin senal: ' || v_d.label || ' (' || v_d.local || ')',
      'La tablet "' || v_d.label || '" del local ' || v_d.local || '. ' || v_coletilla
      || 'Version: ' || coalesce(v_d.app_version, 'desconocida') || '. '
      || 'Si la pantalla pide vincular, apagar y encender la tablet suele bastar. '
      || 'Mientras tanto los pedidos SIGUEN entrando en Folvy y se pueden ver desde cualquier '
      || 'movil u ordenador en Pedidos.',
      'kds_silencio_' || v_d.id::text,
      interval '4 hours',
      v_d.account_id,
      v_d.location_id,
      null::uuid,
      'alto'
    );
  end loop;

  -- Regla 7: el umbral decide a quién se INTERRUMPE, nunca qué existe. Las
  -- calladas con el local cerrado no avisan, pero se dicen en el log del cron.
  if v_calla > 0 then
    raise notice 'kds_device_silence_check: % tablet(s) calladas con el local cerrado, no se avisan', v_calla;
  end if;

  return v_n;
end;
$fn$;

-- Permisos EXACTOS a como estaban antes del drop (#28, esta misma mañana).
revoke all on function public.kds_device_silence_check(int, timestamptz) from public;
revoke execute on function public.kds_device_silence_check(int, timestamptz) from anon, authenticated;
grant execute on function public.kds_device_silence_check(int, timestamptz) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · ENSAYO · contra la población REAL, y por los CAMINOS (reglas 10 y 31)
-- ───────────────────────────────────────────────────────────────────────────
--
-- No es un ensayo de la fórmula: escribe de verdad por `encolar_alerta` y
-- comprueba lo que cae en `system_alert_queue`. Todo dentro de un bloque que
-- revienta a propósito al final, así que no queda nada.
do $ensayo$
declare
  ALCALA      constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  CARABANCHEL constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';
  v_j      jsonb;
  v_sin    uuid;
  v_dev    uuid;
  v_cta    uuid;
  v_ret    int;
  v_filas  int;
  v_acc    int;
  v_loc    int;
  v_msg    text;
begin
  -- ── A · Alcalá HOY: excepción de cierre escrita hace un rato. Se calla.
  v_j := public._servicio_del_local(ALCALA, timestamp '2026-09-14 14:00' at time zone 'Europe/Madrid');
  if v_j->>'estado' <> 'cerrado_declarado' or v_j->>'origen' <> 'excepcion' then
    raise exception 'A · Alcala hoy 14:00 deberia ser cerrado_declarado/excepcion y es %', v_j;
  end if;

  -- ── B · Carabanchel HOY a las 12:05: el lunes TIENE tramos (13:00-15:45 y
  --       20:00-23:45) y ninguno cubre las 12:05. Cerrado declarado.
  --       Aquí es donde el vigía viejo decía «horario de servicio».
  v_j := public._servicio_del_local(CARABANCHEL, timestamp '2026-09-14 12:05' at time zone 'Europe/Madrid');
  if v_j->>'estado' <> 'cerrado_declarado' or v_j->>'origen' <> 'semanal' then
    raise exception 'B · Carabanchel hoy 12:05 deberia ser cerrado_declarado/semanal y es %', v_j;
  end if;

  -- ── C y D · Carabanchel en sus dos tramos de hoy, con la hora de apertura.
  v_j := public._servicio_del_local(CARABANCHEL, timestamp '2026-09-14 14:00' at time zone 'Europe/Madrid');
  if v_j->>'estado' <> 'en_servicio'
     or (v_j->>'desde')::timestamptz <> (timestamp '2026-09-14 13:00' at time zone 'Europe/Madrid') then
    raise exception 'C · Carabanchel hoy 14:00 deberia abrir a las 13:00 y da %', v_j;
  end if;
  v_j := public._servicio_del_local(CARABANCHEL, timestamp '2026-09-14 21:00' at time zone 'Europe/Madrid');
  if v_j->>'estado' <> 'en_servicio'
     or (v_j->>'desde')::timestamptz <> (timestamp '2026-09-14 20:00' at time zone 'Europe/Madrid') then
    raise exception 'D · Carabanchel hoy 21:00 deberia abrir a las 20:00 y da %', v_j;
  end if;

  -- ── E · 🔴 EL LUNES DE ALCALÁ, que es el caso por el que esto tiene cuatro
  --       estados. El 21/09 no tendrá excepción y Alcalá no tiene lunes en
  --       `business_hours` — pero vendió 487 veces en diez lunes. Ausencia NO
  --       es cierre: tiene que caer en el estado que HABLA.
  v_j := public._servicio_del_local(ALCALA, timestamp '2026-09-21 14:00' at time zone 'Europe/Madrid');
  if v_j->>'estado' <> 'sin_horario_declarado_hoy' then
    raise exception 'E · el lunes de Alcala deberia ser sin_horario_declarado_hoy y es %', v_j;
  end if;

  -- ── F · Un local sin NADA declarado. Hay 4 de 7 en la base.
  select l.id into v_sin from locations l
   where not exists (select 1 from business_hours h where h.location_id = l.id)
     and not exists (select 1 from business_hours_exception e where e.location_id = l.id)
   limit 1;
  if v_sin is null then
    raise exception 'F · NO ENSAYADO: no hay ningun local sin horario en la base';
  end if;
  v_j := public._servicio_del_local(v_sin, now());
  if v_j->>'estado' <> 'sin_horario' then
    raise exception 'F · un local sin horario deberia ser sin_horario y es %', v_j;
  end if;

  -- ── G · EL CAMINO DE ESCRITURA, en servicio. Se retrasa el latido de la
  --       tablet de Carabanchel y se corre el vigía en un instante de servicio
  --       de verdad. Tiene que caer UNA fila, y CON cuenta y local (#28).
  select d.id, d.account_id into v_dev, v_cta
    from kds_device d where d.location_id = CARABANCHEL and d.is_active limit 1;

  update kds_device set last_seen_at = timestamp '2026-09-14 20:20' at time zone 'Europe/Madrid'
   where id = v_dev;

  v_ret := public.kds_device_silence_check(10, timestamp '2026-09-14 21:00' at time zone 'Europe/Madrid');

  select count(*), count(account_id), count(location_id), max(message)
    into v_filas, v_acc, v_loc, v_msg
    from system_alert_queue
   where kind = 'kds_device_silencio' and created_at > now() - interval '1 minute';

  if v_filas <> 1 then raise exception 'G · deberia encolar 1 aviso y encolo %', v_filas; end if;
  if v_acc <> 1 or v_loc <> 1 then
    raise exception 'G · el aviso sigue sin cuenta ni local: account=% location=%', v_acc, v_loc;
  end if;
  if v_msg !~ 'Lleva 40 minutos' then
    raise exception 'G · deberia contar 40 minutos (20:20 -> 21:00) y dice: %', left(v_msg, 200);
  end if;
  if v_ret <> 1 then raise exception 'G · deberia devolver 1 y devolvio %', v_ret; end if;

  -- ── H · EL MISMO SILENCIO, CON EL LOCAL CERRADO. Mismo latido de las 20:20,
  --       pero se mira a las 12:05, cuando Carabanchel no ha abierto. Ni una
  --       fila, y el vigía devuelve 0. Esto es lo que no hacía antes.
  delete from system_alert_queue where kind = 'kds_device_silencio' and created_at > now() - interval '1 minute';
  update kds_device set last_seen_at = timestamp '2026-09-14 03:00' at time zone 'Europe/Madrid'
   where id = v_dev;
  v_ret := public.kds_device_silence_check(10, timestamp '2026-09-14 12:05' at time zone 'Europe/Madrid');
  select count(*) into v_filas from system_alert_queue
   where kind = 'kds_device_silencio' and created_at > now() - interval '1 minute';
  if v_filas <> 0 or v_ret <> 0 then
    raise exception 'H · con el local cerrado no deberia avisar y encolo % (devolvio %)', v_filas, v_ret;
  end if;

  -- ── I · LA TABLET APAGADA TODA LA NOCHE, el caso de los tres falsos avisos.
  --       Latido a las 03:00, se mira a las 13:05, cinco minutos despues de
  --       abrir. El vigia viejo habria dicho «610 minutos». El nuevo cuenta 5 y
  --       se calla, porque 5 < 10.
  v_ret := public.kds_device_silence_check(10, timestamp '2026-09-14 13:05' at time zone 'Europe/Madrid');
  select count(*) into v_filas from system_alert_queue
   where kind = 'kds_device_silencio' and created_at > now() - interval '1 minute';
  if v_filas <> 0 or v_ret <> 0 then
    raise exception 'I · cinco minutos despues de abrir no es noticia y encolo % (devolvio %)', v_filas, v_ret;
  end if;

  -- ── J · ...pero si a las 13:20 sigue sin latir, SÍ. Veinte minutos de
  --       servicio callada es una averia de verdad. El arreglo no es «callarse
  --       mas»: es contar desde que abre.
  v_ret := public.kds_device_silence_check(10, timestamp '2026-09-14 13:20' at time zone 'Europe/Madrid');
  select count(*), max(message) into v_filas, v_msg from system_alert_queue
   where kind = 'kds_device_silencio' and created_at > now() - interval '1 minute';
  if v_filas <> 1 or v_ret <> 1 then
    raise exception 'J · veinte minutos de servicio callada SI es noticia y encolo % (devolvio %)', v_filas, v_ret;
  end if;
  if v_msg !~ 'Lleva 20 minutos' or v_msg !~ 'desde que abrio el local' then
    raise exception 'J · deberia decir 20 minutos y de donde los cuenta, y dice: %', left(v_msg, 300);
  end if;

  raise notice 'ENSAYO OK · A,B,C,D,E,F (estados) y G,H,I,J (camino de escritura)';
  raise notice 'NO ENSAYADO · el tramo que cruza medianoche: en la base entera hay 0 tramos '
               'con close_time <= open_time, asi que esa rama no tiene poblacion contra la que probarse.';

  raise exception 'FIN DEL ENSAYO';
exception
  when others then
    if sqlerrm = 'FIN DEL ENSAYO' then
      raise notice 'ensayo revertido, no queda nada escrito';
    else
      raise;
    end if;
end;
$ensayo$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4 · PERMISOS EXACTOS, comprobados (la regresión del #28 fue esta mañana)
-- ───────────────────────────────────────────────────────────────────────────
do $permisos$
declare v_acl text;
begin
  select coalesce((select string_agg(x, ', ' order by x) from unnest(p.proacl::text[]) x), '(por defecto)')
    into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'kds_device_silence_check';

  if v_acl <> 'postgres=X/postgres, service_role=X/postgres' then
    raise exception 'los permisos del vigia no son los de antes del drop: %', v_acl;
  end if;
  raise notice 'permisos del vigia: % (iguales que antes)', v_acl;
end;
$permisos$;
