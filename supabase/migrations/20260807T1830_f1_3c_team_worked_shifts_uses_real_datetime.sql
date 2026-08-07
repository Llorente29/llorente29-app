-- Aplicada: 2026-08-07 por MCP. Verificado: 258 jornadas / 1450.9h (equivalente al datetime tras saneado).
-- F1.3c · team_worked_shifts pasa a leer real_datetime (verdad legal inmutable) en vez de datetime
-- (redondeado). El redondeo, cuando aplique, se calcula al vuelo; el cómputo legal usa la hora real.

CREATE OR REPLACE FUNCTION public.team_worked_shifts(p_account uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(employee_id uuid, location_id uuid, started_at timestamp with time zone, ended_at timestamp with time zone, minutes numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with ordered as (
    select ce.employee_id,
           ce.location_id_at_clock as location_id,
           ce.type, ce.real_datetime as rt,
           lead(ce.real_datetime) over (partition by ce.employee_id order by ce.real_datetime) as next_rt,
           lead(ce.type)          over (partition by ce.employee_id order by ce.real_datetime) as next_type
    from public.clock_entries ce
    join public.employees e on e.id = ce.employee_id
    where coalesce(ce.voided, false) = false
      and e.location_id in (select id from public.locations where account_id = p_account)
      and ce.real_datetime >= p_from and ce.real_datetime < p_to
  )
  select employee_id, location_id, rt, next_rt,
         round(extract(epoch from (next_rt - rt)) / 60.0, 1)
  from ordered
  where type = 'entrada' and next_type = 'salida' and next_rt is not null
    and next_rt - rt < interval '16 hours';
$function$
;
