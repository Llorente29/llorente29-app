-- F10/F7.4 · INFERENCIA DE DISPONIBILIDAD desde los cuadrantes reales ya hechos por el encargado.
--
-- POR QUÉ ESTO GOLEA: el benchmark (7shifts, Shiftbase, ZoomShift, Shifton) resuelve el ALMACENAMIENTO de
-- la disponibilidad (una app donde el empleado la mete) pero NO el problema real: nadie la rellena y nadie
-- la actualiza. "Un formulario rellenado en marzo suele estar equivocado en junio". Su respuesta al
-- problema es un formulario en blanco.
-- Folvy no necesita que nadie rellene nada: infiere de 564 asignaciones reales de 32 cuadrantes, y se puede
-- recalcular cada mes para que el dato NO envejezca.
--
-- NO escribe nada: PROPONE. El encargado confirma o corrige (la decisión de Julio: recomendado, no obligatorio).
-- Devuelve nivel de confianza para que la UI distinga "esto es seguro" de "esto es una corazonada".
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
  -- semanas en las que ese empleado aparece en algún cuadrante (denominador honesto:
  -- no penaliza a quien entró tarde ni cuenta semanas en las que no estaba)
  semanas as (
    select employee_id, count(distinct week_start) as n_semanas
    from asign group by employee_id
  ),
  -- rejilla completa: cada empleado x 7 días x 2 periodos
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
         round(c.veces::numeric / nullif(c.n_semanas,0), 2) as ratio,
         (c.veces > 0) as sugerencia,
         case
           when c.n_semanas < 4 then 'baja'                      -- poca muestra: no afirmar nada
           when c.veces = 0 then 'alta'                           -- nunca en N semanas = restricción real
           when c.veces::numeric / c.n_semanas >= 0.6 then 'alta' -- patrón fijo
           else 'media'
         end as confianza,
         case
           when c.n_semanas < 4 then 'Solo '||c.n_semanas||' semanas observadas: hace falta más historial'
           when c.veces = 0 then 'Nunca asignado en '||c.n_semanas||' semanas'
           when c.veces::numeric / c.n_semanas >= 0.6 then 'Asignado '||c.veces||' de '||c.n_semanas||' semanas'
           else 'Asignado solo '||c.veces||' de '||c.n_semanas||' semanas'
         end as motivo
  from conteo c
  join public.employees e on e.id = c.employee_id
  order by e.name, c.dow, c.periodo;
$function$;

grant execute on function public.infer_employee_availability(uuid,uuid) to authenticated, service_role;