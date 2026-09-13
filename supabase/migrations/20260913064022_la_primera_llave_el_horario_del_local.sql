-- PIEZA 3 · LA PRIMERA LLAVE: el horario del local. Ver el fichero de la
-- migración en el repositorio para el razonamiento completo y lo medido.

create or replace function public._ventana_de_mantenimiento(
  p_location_id uuid,
  p_margen_min  integer default 45
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_margen      interval := make_interval(mins => greatest(0, coalesce(p_margen_min, 45)));
  v_ahora       timestamp;   -- hora de Madrid, sin zona (regla 4: se convierte ANTES)
  v_hoy         date;
  v_filas_hoy   integer := 0;
  v_en_servicio boolean := false;
  v_hasta       timestamp;
begin
  v_ahora := now() at time zone 'Europe/Madrid';
  v_hoy   := v_ahora::date;

  select count(*) into v_filas_hoy
    from business_hours bh
   where bh.location_id = p_location_id
     and bh.brand_id is null
     and bh.weekday = extract(dow from v_hoy)::smallint;

  -- Un día sin horario declarado NO es un día libre: la ausencia de un dato no
  -- prueba que el local cierre. La duda va siempre a favor de esperar.
  if v_filas_hoy = 0 then
    return jsonb_build_object(
      'en_ventana', false, 'motivo', 'sin_horario_declarado_hoy',
      'hasta', null, 'margen_minutos', extract(epoch from v_margen)::int / 60);
  end if;

  -- Se miran AYER, HOY y MAÑANA porque los márgenes cruzan la medianoche: el de
  -- después del último tramo de ayer entra en la madrugada de hoy.
  with dias as (
    select generate_series(v_hoy - 1, v_hoy + 1, interval '1 day')::date as d
  ),
  tramos as (
    select
      (d.d + bh.open_time) - v_margen as empieza,
      (case when bh.close_time <= bh.open_time
            then d.d + bh.close_time + interval '1 day'
            else d.d + bh.close_time
       end) + v_margen                as termina
    from dias d
    join business_hours bh
      on bh.location_id = p_location_id
     and bh.brand_id is null
     and bh.weekday = extract(dow from d.d)::smallint
  )
  select coalesce(bool_or(v_ahora >= t.empieza and v_ahora < t.termina), false),
         min(t.empieza) filter (where t.empieza > v_ahora)
    into v_en_servicio, v_hasta
    from tramos t;

  return jsonb_build_object(
    'en_ventana',     not v_en_servicio,
    'motivo',         case when v_en_servicio then 'servicio_o_margen' else null end,
    'hasta',          case when v_en_servicio then null else v_hasta end,
    'margen_minutos', extract(epoch from v_margen)::int / 60);
end;
$$;

comment on function public._ventana_de_mantenimiento(uuid, integer) is
  'Primera llave: ¿está el local FUERA de su horario de servicio, con 45 min de margen por los dos lados? Un día sin horario declarado NO es ventana.';


-- La SEGUNDA llave, palabra por palabra la de siempre, sacada aparte por el
-- mismo motivo que la primera: la pregunta también la hace la oficina, y dos
-- copias de esta regla derivarían.
create or replace function public._cocina_en_calma(
  p_location_id   uuid,
  p_quiet_minutes integer default 20
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pending_jobs  integer := 0;
  v_active_orders integer := 0;
  v_last_sale_min integer;
  v_quiet         integer := greatest(0, coalesce(p_quiet_minutes, 20));
  v_reasons       text[] := '{}';
begin
  select count(*) into v_pending_jobs
    from print_job j
   where j.location_id = p_location_id
     and ((j.status = 'pending' and j.created_at > now() - interval '2 hours')
       or (j.status = 'sent' and j.sent_at > now() - interval '60 minutes'));

  select count(*) into v_active_orders
    from sale s
   where s.location_id = p_location_id
     and s.order_status is not null
     and s.order_status not in ('completed', 'cancelled')
     and s.created_at > now() - interval '12 hours';

  select floor(extract(epoch from (now() - max(s.created_at))) / 60)::int
    into v_last_sale_min
    from sale s
   where s.location_id = p_location_id
     and s.created_at > now() - interval '24 hours';

  if v_pending_jobs > 0 then
    v_reasons := array_append(v_reasons, 'trabajos_de_impresion_vivos');
  end if;
  if v_active_orders > 0 then
    v_reasons := array_append(v_reasons, 'pedidos_en_curso');
  end if;
  if v_last_sale_min is not null and v_last_sale_min < v_quiet then
    v_reasons := array_append(v_reasons, 'venta_reciente');
  end if;

  return jsonb_build_object(
    'safe',               (array_length(v_reasons, 1) is null),
    'reasons',            to_jsonb(v_reasons),
    'pending_jobs',       v_pending_jobs,
    'active_orders',      v_active_orders,
    'minutes_since_sale', v_last_sale_min,
    'quiet_minutes',      v_quiet);
end;
$$;

comment on function public._cocina_en_calma(uuid, integer) is
  'Segunda llave: ¿está la cocina de este local en calma? Es la guarda de siempre, sacada aparte para que la oficina pregunte lo mismo que decide la tablet.';


create or replace function public.station_update_window(
  p_device_token  text,
  p_quiet_minutes integer default 20
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device  kds_device;
  v_calma   jsonb;
  v_ventana jsonb;
  v_reasons jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    return jsonb_build_object('ok', false, 'safe', false, 'en_ventana', false,
                              'reasons', to_jsonb(array['token_no_valido']));
  end if;

  v_calma   := public._cocina_en_calma(v_device.location_id, p_quiet_minutes);
  v_ventana := public._ventana_de_mantenimiento(v_device.location_id);

  -- `reasons` junta los motivos de las dos llaves, pero `safe` sigue saliendo
  -- SOLO de la actividad. Si `safe` se calculara de «no hay motivos», meter el
  -- horario aquí le cambiaría el significado por la puerta de atrás y dejaría
  -- de ser la segunda llave: serían las dos mezcladas en una.
  v_reasons := v_calma->'reasons';
  if (v_ventana->>'en_ventana')::boolean is not true then
    v_reasons := v_reasons || to_jsonb(array[coalesce(v_ventana->>'motivo', 'fuera_de_ventana')]);
  end if;

  return jsonb_build_object(
    'ok',                 true,
    'safe',               (v_calma->>'safe')::boolean,
    'reasons',            v_reasons,
    'pending_jobs',       (v_calma->>'pending_jobs')::int,
    'active_orders',      (v_calma->>'active_orders')::int,
    'minutes_since_sale', (v_calma->>'minutes_since_sale')::int,
    'quiet_minutes',      (v_calma->>'quiet_minutes')::int,
    'en_ventana',         (v_ventana->>'en_ventana')::boolean,
    'motivo_ventana',     v_ventana->>'motivo',
    'ventana_hasta',      v_ventana->>'hasta',
    'margen_minutos',     (v_ventana->>'margen_minutos')::int
  );
end;
$$;

comment on function public.station_update_window(text, integer) is
  'Las dos llaves de la actualización de una estación: en_ventana (fuera del horario del local, 45 min de margen) y safe (la cocina en calma). Las dos tienen que abrir.';

-- Los dos ayudantes no los llama nadie de fuera: solo las dos funciones que
-- responden a la tablet y a la oficina, que son SECURITY DEFINER de postgres.
revoke all on function public._ventana_de_mantenimiento(uuid, integer) from public;
revoke all on function public._cocina_en_calma(uuid, integer) from public;
revoke all on function public.station_update_window(text, integer) from public;
grant execute on function public.station_update_window(text, integer) to anon, authenticated;
