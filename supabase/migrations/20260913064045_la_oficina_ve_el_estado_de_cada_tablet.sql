-- §3b · LA LÍNEA DE LA OFICINA: qué le ha pasado a cada tablet, y cuándo.
-- Ver el fichero de la migración en el repositorio para el razonamiento.
--
-- ES DROP + CREATE, y tiene que serlo (regla 2): cambia el tipo de retorno de
-- la TABLE. Su único llamador, `listDeviceBundleStatus`, mapea por nombre y ya
-- devuelve [] si la RPC falla, así que la pantalla aguanta el instante.

drop function if exists public.kds_device_bundle_status(uuid);

create function public.kds_device_bundle_status(p_location_id uuid default null)
returns table (
  device_id       uuid,
  label           text,
  local           text,
  is_active       boolean,
  app_version     text,
  bundle_actual   integer,
  ultimo_bundle   integer,
  atraso_bundles  integer,
  horas_desfase   integer,
  last_seen_at    timestamptz,
  estado          text,
  aplicado_en     timestamptz,
  en_ventana      boolean,
  cocina_en_calma boolean,
  motivo_espera   text
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
           dev.bundle_applied, dev.bundle_applied_at,
           -- La columna manda; el texto libre es el respaldo mientras quede
           -- alguna tablet sin el paquete que sabe reportarla. Quitarlo hoy
           -- dejaría en blanco a las tres que corren el 285.
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
  -- local, no del aparato, y así dos tablets del mismo sitio no pueden dar
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
    -- POR QUÉ está esperando. Solo tiene sentido si va por detrás: al día no
    -- espera a nada, y poner un motivo ahí sería ruido con cara de dato.
    case
      when d.b_actual is not null and d.b_actual >= v_ultimo then null
      when not d.is_active                                   then 'aparato_apagado'
      when d.last_seen_at is null
        or d.last_seen_at < now() - interval '30 minutes'     then 'no_da_senales'
      when k.en_ventana is not true                          then coalesce(k.motivo_ventana, 'fuera_de_ventana')
      when k.en_calma is not true                            then 'cocina_ocupada'
      else 'a_punto_de_instalarse'
    end
  from d
  left join llaves k on k.location_id = d.location_id
  left join horas  h on h.id = d.id
  order by
    case when d.b_actual is null then 0 else 1 end,
    d.b_actual asc nulls first, d.label;
end;
$$;

comment on function public.kds_device_bundle_status(uuid) is
  'Estado de cada tablet para la pantalla de oficina: qué paquete corre, desde cuándo, y POR QUÉ está esperando si va por detrás. Las dos llaves se preguntan a los mismos ayudantes que usa la tablet.';

revoke all on function public.kds_device_bundle_status(uuid) from public;
grant execute on function public.kds_device_bundle_status(uuid) to authenticated;
