-- Aplicada 2026-08-07 por MCP. Verificado sobre 564 asignaciones reales de 32 cuadrantes:
--   Natacha nunca martes (9 semanas), Pamela nunca miércoles (8 semanas), nadie los lunes salvo dos.
--   Resultado al aplicar: employee_availability pasa de 0 a 75 filas (51 disponibles, 24 restricciones).
--
-- F10/F7.4 · INFERENCIA DE DISPONIBILIDAD desde los cuadrantes que el encargado YA hizo a mano.
--
-- POR QUÉ ESTO GOLEA AL MERCADO (benchmark 07/08: 7shifts, Shiftbase, ZoomShift, Shifton, Xenia):
-- todos resuelven el ALMACENAMIENTO de la disponibilidad (una app donde el empleado la mete) pero NO el
-- problema real, que está documentado en sus propias guías:
--   "La disponibilidad nunca se recogió de forma consistente, nunca se guardó donde el manager pudiera
--    consultarla, y nunca se actualizó. Es un problema de PROCESO, no de plantilla." (Xenia)
--   "Un formulario rellenado en marzo suele estar equivocado en junio." (Shifton)
--   La respuesta de Shiftbase al problema es literalmente "descarga nuestra plantilla de formulario".
-- Folvy no necesita que nadie rellene nada: infiere del historial y se puede RECALCULAR cada mes, así que
-- el dato no envejece. Ese es el foso.
--
-- NO escribe: PROPONE. Devuelve confianza y motivo para que la UI distinga certeza de corazonada.
create or replace function public.infer_employee_availability(p_account uuid, p_location uuid default null)
returns table(
  employee_id uuid, employee_name text,
  day_of_week int, shift_period text,
  veces_asignado int, semanas_observadas int,
  ratio numeric, sugerencia boolean, confianza text, motivo text
)
language sql stable
as $function$
  with asign as (
    select s.location_id, s.week_start,
           (dia.key)::int as dow,
           (emp.value #>> '{}')::uuid as employee_id,
           case when st.start_time < time '17:00' then 'morning' else 'evening' end as periodo
    from public.schedules s
    cross join lateral jsonb_each(s.cells) shift
    cross join lateral jsonb_each(shift.value) dia
    cross join lateral jsonb_array_elements(dia.value) emp
    join public.shift_templates st on st.id = (shift.key)::uuid
    where s.location_id in (
      select id from public.locations
      where account_id = p_account and (p_location is null or id = p_location))
  ),
  -- denominador honesto: semanas en las que ESE empleado aparece en algún cuadrante
  -- (no penaliza a quien entró tarde ni cuenta semanas en las que no estaba)
  semanas as (select employee_id, count(distinct week_start) as n_semanas from asign group by employee_id),
  rejilla as (
    select sm.employee_id, d.dow, p.periodo, sm.n_semanas
    from semanas sm
    cross join generate_series(0,6) d(dow)
    cross join (values ('morning'),('evening')) p(periodo)
  ),
  conteo as (
    select r.employee_id, r.dow, r.periodo, r.n_semanas,
           (select count(*) from asign a
             where a.employee_id = r.employee_id and a.dow = r.dow and a.periodo = r.periodo) as veces
    from rejilla r
  )
  select c.employee_id, e.name, c.dow, c.periodo,
         c.veces::int, c.n_semanas::int,
         round(c.veces::numeric / nullif(c.n_semanas,0), 2),
         (c.veces > 0),
         case
           when c.n_semanas < 4 then 'baja'
           when c.veces = 0 then 'alta'
           when c.veces::numeric / c.n_semanas >= 0.6 then 'alta'
           else 'media'
         end,
         case
           when c.n_semanas < 4 then 'Solo '||c.n_semanas||' semanas observadas: hace falta más historial'
           when c.veces = 0 then 'Nunca asignado en '||c.n_semanas||' semanas'
           when c.veces::numeric / c.n_semanas >= 0.6 then 'Asignado '||c.veces||' de '||c.n_semanas||' semanas'
           else 'Asignado solo '||c.veces||' de '||c.n_semanas||' semanas'
         end
  from conteo c join public.employees e on e.id = c.employee_id
  order by e.name, c.dow, c.periodo;
$function$;
grant execute on function public.infer_employee_availability(uuid,uuid) to authenticated, service_role;

-- Aplicar lo inferido, previa CONFIRMACIÓN del encargado. Regla de Julio: recomendado, NO obligatorio.
--  · solo confianza ALTA · deja rastro en note (auditable/reversible) · NO pisa lo puesto a mano.
create or replace function public.apply_inferred_availability(
  p_account uuid, p_location uuid default null, p_overwrite boolean default false
) returns integer
language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_count int := 0; r record;
begin
  for r in select * from public.infer_employee_availability(p_account, p_location) where confianza = 'alta'
  loop
    if not p_overwrite and exists (
      select 1 from public.employee_availability a
      where a.employee_id = r.employee_id and a.day_of_week = r.day_of_week
        and a.shift_period = r.shift_period
        and (a.note is null or a.note not like 'Inferido%')
    ) then continue; end if;

    insert into public.employee_availability (
      employee_id, account_id, day_of_week, shift_period, available, note)
    values (r.employee_id, p_account, r.day_of_week, r.shift_period, r.sugerencia,
            'Inferido del historial · '||r.motivo)
    on conflict (employee_id, day_of_week, shift_period) do update
      set available = excluded.available, note = excluded.note;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $function$;
revoke execute on function public.apply_inferred_availability(uuid,uuid,boolean) from public, anon;
grant execute on function public.apply_inferred_availability(uuid,uuid,boolean) to authenticated, service_role;
