-- F1.5 · team_worked_shifts entiende pausas. DROP necesario: cambia el tipo de retorno (columnas nuevas).
-- Verificado antes: ninguna funcion/vista SQL depende de ella (la llama el front).
-- CLAVE: la jornada se delimita entrada -> siguiente SALIDA (las pausas NO la cortan). Si se exigiera que
-- el siguiente fichaje fuese 'salida', una jornada con pausa DESAPARECERIA del computo.
-- Desglose: presence_minutes (presencia) - break_minutes (descanso) = minutes (trabajado).
-- Compatibilidad: sin pausas registradas, break_minutes=0 y minutes = valor historico exacto.
drop function if exists public.team_worked_shifts(uuid, timestamptz, timestamptz);

create function public.team_worked_shifts(p_account uuid, p_from timestamptz, p_to timestamptz)
returns table(employee_id uuid, location_id uuid, started_at timestamptz, ended_at timestamptz,
              minutes numeric, presence_minutes numeric, break_minutes numeric)
language sql
stable
as $function$
  with base as (
    select ce.employee_id,
           ce.location_id_at_clock as location_id,
           ce.type, ce.real_datetime as rt
    from public.clock_entries ce
    join public.employees e on e.id = ce.employee_id
    where coalesce(ce.voided, false) = false
      and e.location_id in (select id from public.locations where account_id = p_account)
      and ce.real_datetime >= p_from
      and ce.real_datetime <  p_to + interval '16 hours'
  ),
  spans as (
    select b.employee_id, b.location_id, b.rt as started_at,
           (select min(s.rt) from base s
             where s.employee_id = b.employee_id and s.type='salida' and s.rt > b.rt) as ended_at
    from base b
    where b.type = 'entrada'
      and b.rt >= p_from and b.rt < p_to
  ),
  valid as (
    select * from spans
    where ended_at is not null and ended_at - started_at < interval '16 hours'
  ),
  pauses as (
    select v.employee_id, v.started_at,
           coalesce(sum(extract(epoch from (
             (select min(f.rt) from base f
               where f.employee_id = v.employee_id and f.type='pausa_fin' and f.rt > p.rt
                 and f.rt <= v.ended_at)
             - p.rt)) / 60.0), 0) as break_min
    from valid v
    left join base p
      on p.employee_id = v.employee_id and p.type = 'pausa_inicio'
     and p.rt > v.started_at and p.rt < v.ended_at
    group by v.employee_id, v.started_at
  )
  select v.employee_id, v.location_id, v.started_at, v.ended_at,
         round(extract(epoch from (v.ended_at - v.started_at))/60.0 - coalesce(pz.break_min,0), 1) as minutes,
         round(extract(epoch from (v.ended_at - v.started_at))/60.0, 1) as presence_minutes,
         round(coalesce(pz.break_min,0), 1) as break_minutes
  from valid v
  left join pauses pz
    on pz.employee_id = v.employee_id and pz.started_at = v.started_at;
$function$;

grant execute on function public.team_worked_shifts(uuid, timestamptz, timestamptz) to authenticated, service_role;