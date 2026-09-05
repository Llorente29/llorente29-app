-- El cómputo legal de jornadas pasa a leer real_datetime (verdad inmutable) en vez de datetime (redondeado).
-- Verificado equivalente tras sanear datos (F1.1 + F1.3a): 258 jornadas / 1450.9h.
create or replace function public.team_worked_shifts(p_account uuid, p_from timestamptz, p_to timestamptz)
 returns table(employee_id uuid, location_id uuid, started_at timestamptz, ended_at timestamptz, minutes numeric)
 language sql stable
as $function$
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
$function$;