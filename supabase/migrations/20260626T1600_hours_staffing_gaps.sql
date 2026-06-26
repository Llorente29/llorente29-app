create or replace function hours_staffing_gaps(p_location_id uuid)
returns table (weekday smallint, gap_start time, gap_end time)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cells jsonb;
  v_day smallint;        -- convención business_hours (Postgres dow): 0=domingo..6=sábado
  v_sched_key text;      -- convención cuadrante: 0=lunes..6=domingo
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  select cells into v_cells
  from schedules
  where location_id = p_location_id
    and week_start <= v_today
    and v_today < week_start + 7
  order by week_start desc
  limit 1;

  if v_cells is null then
    return;
  end if;

  for v_day in 0..6 loop
    -- Mapeo dow (dom=0) -> clave cuadrante (lun=0): (dow + 6) % 7
    v_sched_key := ((v_day + 6) % 7)::text;

    return query
    with comercial as (
      select h.open_time as o,
             case when h.close_time <= h.open_time then time '23:59:59' else h.close_time end as c
      from business_hours h
      where h.location_id = p_location_id and h.brand_id is null and h.weekday = v_day
    ),
    cobertura as (
      select st.start_time as o,
             case when st.end_time <= st.start_time then time '23:59:59' else st.end_time end as c
      from shift_templates st
      where st.location_id = p_location_id and st.active = true
        and v_cells ? st.id::text
        and jsonb_array_length(coalesce(v_cells -> st.id::text -> v_sched_key, '[]'::jsonb)) > 0
    ),
    puntos as (
      select o as t from comercial union select c from comercial
      union select o from cobertura union select c from cobertura
    ),
    ordenados as (
      select t, lead(t) over (order by t) as t2 from puntos
    ),
    huecos as (
      select o2.t as s, o2.t2 as e
      from ordenados o2
      where o2.t2 is not null and o2.t2 > o2.t
        and exists (select 1 from comercial c where o2.t >= c.o and o2.t2 <= c.c)
        and not exists (select 1 from cobertura k where o2.t >= k.o and o2.t2 <= k.c)
    ),
    marcados as (
      select s, e, case when s = lag(e) over (order by s) then 0 else 1 end as nuevo
      from huecos
    ),
    grupos as (
      select s, e, sum(nuevo) over (order by s) as g from marcados
    )
    select v_day::smallint, min(s)::time, max(e)::time
    from grupos group by g order by min(s);
  end loop;
end;
$$;

grant execute on function hours_staffing_gaps(uuid) to authenticated;
