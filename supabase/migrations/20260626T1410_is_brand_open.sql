-- 20260626T1410_is_brand_open.sql
-- Aplicada: 2026-06-26 (SQL Editor)
-- Funcion canonica "esta abierta esta marca en este local en este instante".
-- Transversal: Shop checkout, auto-aceptacion HubRise, alarma de disponibilidad.
-- Resuelve: excepcion del dia -> horario de la marca -> horario general del local.
-- Tramos partidos (varias filas) y cruce de medianoche (close < open = dia siguiente).

create or replace function is_brand_open(
  p_location_id uuid,
  p_brand_id uuid,
  p_ts timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_local_date date := (p_ts at time zone 'Europe/Madrid')::date;
  v_local_time time := (p_ts at time zone 'Europe/Madrid')::time;
  v_prev_date date := v_local_date - 1;
  v_dow smallint := extract(dow from v_local_date)::smallint;
  v_dow_prev smallint := extract(dow from v_prev_date)::smallint;
  v_has_exc boolean;
  v_open boolean := false;
begin
  -- 1) Excepcion para HOY (marca, o general del local si la marca no tiene)
  select exists (
    select 1 from business_hours_exception e
    where e.location_id = p_location_id
      and e.exception_date = v_local_date
      and (e.brand_id = p_brand_id or e.brand_id is null)
  ) into v_has_exc;

  if v_has_exc then
    return exists (
      select 1 from business_hours_exception e
      where e.location_id = p_location_id
        and e.exception_date = v_local_date
        and (e.brand_id = p_brand_id or e.brand_id is null)
        and e.is_closed = false
        and e.open_time is not null and e.close_time is not null
        and (
          (e.close_time > e.open_time and v_local_time >= e.open_time and v_local_time < e.close_time)
          or
          (e.close_time <= e.open_time and (v_local_time >= e.open_time or v_local_time < e.close_time))
        )
      order by (e.brand_id is not null) desc
      limit 1
    );
  end if;

  -- 2) Horario habitual del dia de HOY
  select exists (
    select 1 from business_hours h
    where h.location_id = p_location_id
      and h.weekday = v_dow
      and (h.brand_id = p_brand_id or h.brand_id is null)
      and (
        (h.close_time > h.open_time and v_local_time >= h.open_time and v_local_time < h.close_time)
        or
        (h.close_time <= h.open_time and v_local_time >= h.open_time)
      )
      and (
        h.brand_id = p_brand_id
        or not exists (
          select 1 from business_hours h2
          where h2.location_id = p_location_id and h2.brand_id = p_brand_id and h2.weekday = v_dow
        )
      )
  ) into v_open;
  if v_open then return true; end if;

  -- 3) Tramo del dia ANTERIOR que cruza medianoche y sigue abierto ahora
  return exists (
    select 1 from business_hours h
    where h.location_id = p_location_id
      and h.weekday = v_dow_prev
      and (h.brand_id = p_brand_id or h.brand_id is null)
      and h.close_time <= h.open_time
      and v_local_time < h.close_time
      and (
        h.brand_id = p_brand_id
        or not exists (
          select 1 from business_hours h2
          where h2.location_id = p_location_id and h2.brand_id = p_brand_id and h2.weekday = v_dow_prev
        )
      )
  );
end;
$$;

grant execute on function is_brand_open(uuid, uuid, timestamptz) to anon, authenticated;
