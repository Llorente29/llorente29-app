-- La hora que se ENSEÑA es `datetime` (la oficial, la redondeada, la que ve el
-- trabajador en su movil y la que cita el parte). `real_datetime` se queda para
-- ORDENAR y para CALCULAR minutos, que es lo que hace team_worked_shifts.
-- 68 fichajes tienen las dos horas distintas: Marlon ficho hoy con datetime
-- 16:00 y real 15:57, y la ficha habria dicho "Trabajando desde las 15:57"
-- contradiciendo al reloj de todos los demas.
create or replace function public.employee_clock_status(p_employee_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_acct      uuid;
  v_last      clock_entries;
  v_estado    text;
  v_since     timestamptz;
  v_hoy_ini   timestamptz;
  v_min_hoy   numeric := 0;
  v_abierta   timestamptz;
  r           record;
  v_ini       timestamptz := null;
begin
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null then
    raise exception 'employee_clock_status: empleado % no encontrado', p_employee_id;
  end if;
  if not (v_acct = any(public.current_user_account_ids())) then
    raise exception 'employee_clock_status: sin acceso a la cuenta %', v_acct;
  end if;

  select * into v_last
  from clock_entries ce
  where ce.employee_id = p_employee_id and coalesce(ce.voided,false) = false
  order by ce.real_datetime desc, ce.datetime desc
  limit 1;

  -- Dia natural de Madrid, no UTC. El fichaje de las 00:15 de Madrid es de
  -- ayer en UTC, y contarlo como de hoy falsea el dia.
  v_hoy_ini := (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';

  -- Minutos de HOY: pares cerrados + el tramo abierto hasta ahora. Se calcula
  -- con real_datetime, igual que team_worked_shifts, para no dar dos cifras
  -- distintas de las mismas horas.
  for r in
    select ce.type, coalesce(ce.real_datetime, ce.datetime) as rt
    from clock_entries ce
    where ce.employee_id = p_employee_id
      and coalesce(ce.voided,false) = false
      and coalesce(ce.real_datetime, ce.datetime) >= v_hoy_ini
    order by 2 asc
  loop
    if r.type = 'entrada' then
      v_ini := r.rt;
    elsif r.type = 'salida' and v_ini is not null then
      v_min_hoy := v_min_hoy + extract(epoch from (r.rt - v_ini)) / 60.0;
      v_ini := null;
    end if;
  end loop;

  if v_last.id is null then
    v_estado := 'sin_fichajes';
  elsif v_last.type in ('entrada','pausa_inicio','pausa_fin') then
    v_estado := 'trabajando';
    -- Desde cuando: la ULTIMA entrada no anulada (una pausa no reabre jornada).
    -- Se devuelve `datetime`, la hora OFICIAL: es la que ve el trabajador y la
    -- que cita el parte. Enseñar la real descuadraria la ficha con el reloj de
    -- todos los demas en los 68 fichajes que llevan redondeo.
    select ce.datetime into v_since
    from clock_entries ce
    where ce.employee_id = p_employee_id and coalesce(ce.voided,false) = false
      and ce.type = 'entrada'
    order by coalesce(ce.real_datetime, ce.datetime) desc
    limit 1;
    v_abierta := v_since;
    if v_ini is not null then
      v_min_hoy := v_min_hoy + extract(epoch from (now() - v_ini)) / 60.0;
    end if;
  else
    v_estado := 'fuera';
    v_since  := v_last.datetime;
  end if;

  -- "Sin fichajes hoy" tambien cuando el ultimo evento es de otro dia y fue
  -- una salida: la ficha no debe decir "Fuera" sin mas si hoy no ha pasado nada.
  if v_estado = 'fuera'
     and coalesce(v_last.real_datetime, v_last.datetime) < v_hoy_ini then
    v_estado := 'sin_fichajes';
  end if;

  return jsonb_build_object(
    'employee_id',    p_employee_id,
    'estado',         v_estado,
    'since',          v_since,
    'abierta_desde',  v_abierta,
    'minutos_hoy',    round(v_min_hoy, 1),
    'ultimo_tipo',    v_last.type,
    'ultimo_at',      v_last.datetime
  );
end;
$function$;

do $ver$
begin
  if has_function_privilege('anon', 'public.employee_clock_status(uuid)', 'EXECUTE') then
    raise exception 'employee_clock_status ha vuelto a quedar abierta a anon';
  end if;
  if not has_function_privilege('authenticated', 'public.employee_clock_status(uuid)', 'EXECUTE') then
    raise exception 'authenticated NO puede ejecutar employee_clock_status';
  end if;
  raise notice 'VERIFICACION OK: hora oficial en la ficha, permisos intactos';
end
$ver$;