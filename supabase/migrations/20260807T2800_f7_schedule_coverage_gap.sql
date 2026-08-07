-- Aplicada 2026-08-07 por MCP. Verificado sobre la semana 03/08 en Foodint Alcalá:
--   coste semana ~1.620 €, faltan 54 horas-persona, sobran 22 (~268 € de exceso).
--   Dato clave que revela: falta y sobra a la vez el MISMO día -> la gente está mal colocada en el día,
--   no falta plantilla. Eso es dinero recuperable sin contratar.
--
-- F7/F10 · COMPARADOR DE COBERTURA. Cruza lo que HACE FALTA (team_labor_requirement, demanda en platos
-- reales de cocina) contra lo ASIGNADO en el cuadrante, hora a hora, con COSTE REAL de nómina.
-- Es el núcleo que 7shifts vende (coste laboral proyectado antes de publicar), pero aquí la demanda va en
-- platos (carga real de trabajo, no euros) y el coste sale de la nómina definitiva, no del contrato estimado.
--
-- NO toca el generador actual: solo LEE y COMPARA. Es diagnóstico, no asignación.
--
-- DECISIONES DE DISEÑO (no cambiar sin motivo):
--  · Turnos que cruzan medianoche: se expanden con +24h (Corrido1 14:45-00:15, Tarde/Noche F/S 19:45-00:15).
--    Sin esto se pierde la última hora de cada noche, que es justo la de más carga.
--  · required agrega solo roles con is_estimate=false (cocina, reparto). Los 'fixed' a 0 (servicio, otro)
--    no tienen driver real y meterlos falsearía el requerido.
--  · shift_templates NO tiene staff_role_id todavía (F7.3 pendiente) -> assigned es TOTAL de personas/hora.
--    Cuando exista el vínculo, desglosar por rol.
--  · COSTE: usa la ÚLTIMA nómina disponible de cada empleado, NO la del mes planificado. Al planificar el
--    futuro la nómina de ese mes aún no existe -> con la del mes salía 0 €. Respaldo: media del local.
--    cost_is_partial marca las horas donde algún asignado no tiene ninguna nómina (hoy Martin y Fabiola).
create or replace function public.schedule_coverage_gap(
  p_account uuid, p_location uuid, p_week_start date
) returns table(
  fecha date, hora int,
  required_total int, assigned_total int, gap int,
  assigned_cost_hour numeric, cost_is_partial boolean
)
language sql stable
as $function$
  with req as (
    select r.fecha, r.hora, sum(r.required)::int as required_total
    from public.team_labor_requirement(p_account, p_location, p_week_start) r
    where r.is_estimate = false
    group by r.fecha, r.hora
  ),
  asign as (
    select (p_week_start + ((dia.key)::int))::date as fecha,
           (emp.value #>> '{}')::uuid as employee_id, st.start_time, st.end_time
    from public.schedules s
    cross join lateral jsonb_each(s.cells) shift
    cross join lateral jsonb_each(shift.value) dia
    cross join lateral jsonb_array_elements(dia.value) emp
    join public.shift_templates st on st.id = (shift.key)::uuid
    where s.location_id = p_location and s.week_start = p_week_start
  ),
  horas as (
    select a.employee_id,
           (a.fecha + (h || ' hours')::interval)::date as fecha,
           (extract(hour from (a.fecha + (h || ' hours')::interval)))::int as hora
    from asign a
    cross join lateral generate_series(
      extract(hour from a.start_time)::int,
      case when a.end_time <= a.start_time
           then extract(hour from a.end_time)::int + 24
           else extract(hour from a.end_time)::int end - 1
    ) h
  ),
  ult_nomina as (
    select distinct on (pc.employee_id)
           pc.employee_id, pc.total_cost, pc.period_year, pc.period_month
    from public.payroll_cost pc
    where pc.account_id = p_account
    order by pc.employee_id, pc.period_year desc, pc.period_month desc
  ),
  coste as (
    select u.employee_id,
           u.total_cost / nullif((
             select sum(w.minutes)/60.0 from public.team_worked_shifts(p_account,
                    make_date(u.period_year, u.period_month, 1)::timestamptz,
                    (make_date(u.period_year, u.period_month, 1) + interval '1 month')::timestamptz) w
             where w.employee_id = u.employee_id), 0) as coste_hora
    from ult_nomina u
  ),
  media as (select avg(coste_hora) as m from coste where coste_hora is not null),
  agg as (
    select h.fecha, h.hora, count(*)::int as assigned_total,
           sum(coalesce(c.coste_hora, (select m from media))) as coste,
           bool_or(c.coste_hora is null) as falta_nomina
    from horas h left join coste c on c.employee_id = h.employee_id
    group by h.fecha, h.hora
  )
  select coalesce(r.fecha, a.fecha), coalesce(r.hora, a.hora),
         coalesce(r.required_total, 0), coalesce(a.assigned_total, 0),
         coalesce(a.assigned_total,0) - coalesce(r.required_total,0),
         round(coalesce(a.coste,0), 2), coalesce(a.falta_nomina, false)
  from req r
  full outer join agg a on a.fecha = r.fecha and a.hora = r.hora
  order by 1, 2;
$function$;
grant execute on function public.schedule_coverage_gap(uuid,uuid,date) to authenticated, service_role;
