-- LOS TRES REMATES DE JULIO (13/09 09:45).
--
-- 1 · EL RASTRO DE «INSTALAR AHORA». Ese boton es el UNICO camino que se salta
--     la ventana, asi que tiene que dejar huella: si una tablet se recarga en
--     plena cena porque alguien lo pulso, se lee, no se deduce.
--
--     Se sella AL PULSAR y no al arrancar, al reves que el paquete: que una
--     persona haya pulsado es verdad tanto si el paquete arranca como si Capgo
--     lo devuelve. Son dos hechos distintos y por eso son dos sellos distintos.
--
--     «Quien» es, aqui, el aparato: una estacion no tiene sesion ni usuario, se
--     identifica por su token. Se dice tal cual en vez de fingir un nombre.
--
-- 2 · EL COMENTARIO QUE PIDIO, y no es cosmetico: `bundle_applied_at` se sella
--     AL ARRANCAR el paquete nuevo, no al aplicarlo, y entre las dos cosas hay
--     un hueco en el que la base dice todavia lo viejo. Quien lea la columna
--     dentro de seis meses tiene que encontrarse eso escrito — es exactamente
--     la suposicion sobre la que se construyo encima de `app_version_at`.
--
-- 3 · La pantalla de oficina expone el sello nuevo. El castellano lo pone el
--     front, aqui solo se devuelve el dato.

alter table public.kds_device
  add column if not exists instalado_a_mano_at timestamptz;

comment on column public.kds_device.bundle_applied is
  'Numero del paquete OTA que corre AHORA en este dispositivo. Lo escribe report_device_bundle_applied AL ARRANCAR el paquete, no al aplicarlo.';

comment on column public.kds_device.bundle_applied_at is
  'Cuando EMPEZO A CORRER ese paquete aqui. OJO AL MATIZ, que ya nos costo caro con app_version_at: se sella AL ARRANCAR el paquete nuevo (que es la unica prueba de que se aplico: si no arrancara, Capgo vuelve al anterior), NO al aplicarlo. Entre aplicar y arrancar hay un hueco de segundos en el que esta columna dice todavia lo viejo, y eso es correcto. Solo se mueve cuando bundle_applied cambia: un reinicio con el mismo paquete no la toca.';

comment on column public.kds_device.instalado_a_mano_at is
  'La ultima vez que alguien pulso «Instalar ahora» en ESTA tablet. Ese boton es el unico camino que se salta la ventana de mantenimiento, asi que deja rastro. Se sella AL PULSAR, no al arrancar: que una persona lo pidiera es verdad aunque el paquete luego no arranque.';

create or replace function public.report_device_instalacion_a_mano(
  p_device_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'token_no_valido');
  end if;

  update kds_device
     set instalado_a_mano_at = now(),
         updated_at          = now()
   where id = v_device.id;

  return jsonb_build_object(
    'ok', true, 'dispositivo', v_device.label, 'sellado_en', now());
end;
$$;

comment on function public.report_device_instalacion_a_mano(text) is
  'La tablet declara que una PERSONA ha pulsado «Instalar ahora», saltandose la ventana. Se sella al pulsar.';

revoke all on function public.report_device_instalacion_a_mano(text) from public;
grant execute on function public.report_device_instalacion_a_mano(text) to anon, authenticated;


-- La pantalla de oficina, con el sello nuevo. DROP + CREATE porque cambia el
-- tipo de retorno (regla 2). Su unico llamador mapea por nombre y ya devuelve
-- [] si la RPC falla, asi que la pantalla aguanta el instante.
drop function if exists public.kds_device_bundle_status(uuid);

create function public.kds_device_bundle_status(p_location_id uuid default null)
returns table (
  device_id           uuid,
  label               text,
  local               text,
  is_active           boolean,
  app_version         text,
  bundle_actual       integer,
  ultimo_bundle       integer,
  atraso_bundles      integer,
  horas_desfase       integer,
  last_seen_at        timestamptz,
  estado              text,
  aplicado_en         timestamptz,
  en_ventana          boolean,
  cocina_en_calma     boolean,
  motivo_espera       text,
  instalado_a_mano_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_ultimo int;
begin
  select b.bundle_id into v_ultimo from public._ultimo_bundle_publicado() b;

  return query
  with d as (
    select dev.id, dev.label, coalesce(l.name, 'sin local') as loc, dev.is_active,
           dev.app_version, dev.last_seen_at, dev.account_id, dev.location_id,
           dev.bundle_applied, dev.bundle_applied_at, dev.instalado_a_mano_at,
           -- La columna manda; el texto libre es el respaldo mientras quede
           -- alguna tablet sin el paquete que sabe reportarla.
           coalesce(dev.bundle_applied,
                    (regexp_match(dev.app_version, '· bundle (\d+)'))[1]::int) as b_actual,
           (dev.bundle_applied is null
            and dev.app_version is not null
            and dev.app_version !~ '· bundle \d+')                             as es_builtin
    from kds_device dev
    left join locations l on l.id = dev.location_id
    where dev.account_id = any(public.current_user_account_ids())
      and (p_location_id is null or dev.location_id = p_location_id)
  ),
  -- Las dos llaves se preguntan UNA VEZ POR LOCAL, no por dispositivo: son del
  -- local, no del aparato, y asi dos tablets del mismo sitio no pueden dar
  -- respuestas distintas a la misma pregunta.
  llaves as (
    select dl.location_id,
           (public._ventana_de_mantenimiento(dl.location_id)->>'en_ventana')::boolean as en_ventana,
           (public._ventana_de_mantenimiento(dl.location_id)->>'motivo')              as motivo_ventana,
           (public._cocina_en_calma(dl.location_id)->>'safe')::boolean                as en_calma
    from (select distinct d.location_id from d where d.location_id is not null) dl
  ),
  horas as (
    select d.id,
           case when d.b_actual is not null and v_ultimo > d.b_actual then (
             select round(extract(epoch from (now() - min(o.created_at)))/3600)::int
             from storage.objects o
             where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
               and (regexp_replace(o.name, '\D', '', 'g'))::int > d.b_actual
           ) end as h
    from d
  )
  select
    d.id, d.label, d.loc, d.is_active, d.app_version,
    d.b_actual, v_ultimo,
    case when d.b_actual is not null then v_ultimo - d.b_actual end,
    h.h,
    d.last_seen_at,
    case
      when d.es_builtin                       then 'builtin'
      when d.b_actual is null                 then 'desconocido'
      when d.b_actual >= v_ultimo             then 'al_dia'
      when coalesce(h.h, 0) >= 24             then 'muy_atrasado'
      else 'atrasado'
    end,
    d.bundle_applied_at,
    k.en_ventana,
    k.en_calma,
    -- POR QUE esta esperando. Solo tiene sentido si va por detras: al dia no
    -- espera a nada, y poner un motivo ahi seria ruido con cara de dato.
    case
      when d.b_actual is not null and d.b_actual >= v_ultimo then null
      when not d.is_active                                   then 'aparato_apagado'
      when d.last_seen_at is null
        or d.last_seen_at < now() - interval '30 minutes'     then 'no_da_senales'
      when k.en_ventana is not true                          then coalesce(k.motivo_ventana, 'fuera_de_ventana')
      when k.en_calma is not true                            then 'cocina_ocupada'
      else 'a_punto_de_instalarse'
    end,
    d.instalado_a_mano_at
  from d
  left join llaves k on k.location_id = d.location_id
  left join horas  h on h.id = d.id
  order by
    case when d.b_actual is null then 0 else 1 end,
    d.b_actual asc nulls first, d.label;
end;
$$;

comment on function public.kds_device_bundle_status(uuid) is
  'Estado de cada tablet para la pantalla de oficina: que paquete corre, desde cuando, POR QUE espera si va por detras, y si alguien se salto la ventana a mano.';

revoke all on function public.kds_device_bundle_status(uuid) from public;
grant execute on function public.kds_device_bundle_status(uuid) to authenticated;
