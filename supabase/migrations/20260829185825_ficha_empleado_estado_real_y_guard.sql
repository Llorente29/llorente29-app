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

  -- Minutos de HOY: pares cerrados + el tramo abierto hasta ahora.
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
    select coalesce(ce.real_datetime, ce.datetime) into v_since
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
    v_since  := coalesce(v_last.real_datetime, v_last.datetime);
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
    'ultimo_at',      coalesce(v_last.real_datetime, v_last.datetime)
  );
end;
$function$;

revoke all on function public.employee_clock_status(uuid) from public;
revoke all on function public.employee_clock_status(uuid) from anon;
grant execute on function public.employee_clock_status(uuid) to authenticated, service_role;

comment on function public.employee_clock_status(uuid) is
  'Estado REAL de fichaje de un empleado, del ultimo fichaje no anulado (misma '
  'logica que training_is_clocked_in). Tres estados: trabajando | fuera | '
  'sin_fichajes. minutos_hoy incluye el tramo abierto hasta ahora. Creada el '
  '29/08/2026 porque la ficha deducia "Sin entrada" de no tener jornadas CERRADAS.';

drop function if exists public.add_manual_clock_entry(uuid, text, timestamptz, text, text);

create or replace function public.add_manual_clock_entry(
  p_employee_id uuid,
  p_type        text,
  p_datetime    timestamptz,
  p_reason      text,
  p_actor_label text    default null,
  p_force       boolean default false)
 returns clock_entries
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_acct   uuid;
  v_row    public.clock_entries;
  v_loc    uuid;
  v_prev   text;
  v_prevat timestamptz;
  v_reason text := p_reason;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'MOTIVO_OBLIGATORIO'; end if;
  if p_type not in ('entrada','salida') then raise exception 'TIPO_INVALIDO'; end if;
  v_acct := public._account_of_employee(p_employee_id);
  if v_acct is null or not public.current_user_is_admin_of(v_acct) then raise exception 'NO_AUTORIZADO'; end if;
  select location_id into v_loc from public.employees where id = p_employee_id;

  -- Estado EN EL MOMENTO de p_datetime, no ahora: un arreglo historico se
  -- valida contra el momento que corrige.
  select ce.type, coalesce(ce.real_datetime, ce.datetime)
    into v_prev, v_prevat
  from public.clock_entries ce
  where ce.employee_id = p_employee_id
    and coalesce(ce.voided,false) = false
    and coalesce(ce.real_datetime, ce.datetime) < p_datetime
  order by coalesce(ce.real_datetime, ce.datetime) desc
  limit 1;

  if not p_force then
    if p_type = 'entrada' and v_prev in ('entrada','pausa_inicio','pausa_fin') then
      raise exception 'YA_ESTA_FICHADO: la persona ya tenia una % sin cerrar a las %. '
                      'Para dos entradas seguidas hay que forzar con motivo explicito.',
                      v_prev, to_char(v_prevat at time zone 'Europe/Madrid','DD/MM HH24:MI');
    end if;
    if p_type = 'salida' and (v_prev is null or v_prev = 'salida') then
      raise exception 'NO_ESTA_FICHADO: no hay ninguna entrada abierta antes de las %. '
                      'Para cerrar sin apertura hay que forzar con motivo explicito.',
                      to_char(p_datetime at time zone 'Europe/Madrid','DD/MM HH24:MI');
    end if;
  else
    v_reason := 'FORZADO · ' || p_reason;
  end if;

  insert into public.clock_entries(employee_id, type, datetime, real_datetime, source, address, location_id_at_clock)
  values (p_employee_id, p_type, p_datetime, p_datetime, 'manual',
          'Manual · '||v_reason||coalesce(' · por '||p_actor_label,''), v_loc)
  returning * into v_row;

  insert into public.clock_entry_audit(
    clock_entry_id, employee_id, account_id, action, actor_user_id, actor_label, reason, before, after)
  values (v_row.id, p_employee_id, v_acct, 'create_manual', auth.uid(), p_actor_label, v_reason,
          null, public._clock_snapshot(v_row));
  return v_row;
end $function$;

revoke all on function public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean) from public;
revoke all on function public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean) from anon;
grant execute on function public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean) to authenticated, service_role;

comment on function public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean) is
  'Fichaje manual CON guard de coherencia (29/08/2026). Rechaza una entrada sobre alguien '
  'que ya estaba dentro (YA_ESTA_FICHADO) y una salida sin apertura previa (NO_ESTA_FICHADO), '
  'evaluado en el momento de p_datetime, no ahora. p_force=true lo salta y marca el motivo '
  'como FORZADO en el rastro: el gestor necesita poder arreglar un historico roto, pero como '
  'decision consciente, no como camino por defecto.';

drop function if exists public.employee_daily_detail(uuid, date, date);

create or replace function public.employee_daily_detail(p_employee_id uuid, p_from date, p_to date)
 returns table(
   work_date                     date,
   started_at                    timestamptz,
   ended_at                      timestamptz,
   worked_minutes                numeric,
   presence_minutes              numeric,
   break_minutes                 numeric,
   night_minutes                 numeric,
   looks_like_forgotten_clockout boolean,
   shift_state                   text)
 language sql
 stable
as $function$
  with param as (
    select (select account_id from public.employees where id = p_employee_id) as acct,
           p_from::timestamptz                                                as t_from,
           (p_to + 1)::timestamptz                                            as t_to
  ),
  -- Mismo `base` que team_worked_shifts, para clasificar con su mismo criterio.
  base as (
    select ce.type, ce.real_datetime as rt
    from public.clock_entries ce
    join public.employees e on e.id = ce.employee_id
    cross join param p
    where ce.employee_id = p_employee_id
      and coalesce(ce.voided, false) = false
      and e.location_id in (select id from public.locations where account_id = p.acct)
      and ce.real_datetime >= p.t_from
      and ce.real_datetime <  p.t_to + interval '16 hours'
  ),
  spans as (
    select b.rt as started_at,
           (select min(s.rt) from base s where s.type = 'salida' and s.rt > b.rt) as ended_at
    from base b cross join param p
    where b.type = 'entrada' and b.rt >= p.t_from and b.rt < p.t_to
  ),
  ultimo as (
    select max(ce.real_datetime) as rt
    from public.clock_entries ce
    where ce.employee_id = p_employee_id and coalesce(ce.voided, false) = false
  ),
  incidencias as (
    select s.started_at, s.ended_at,
      case
        when s.ended_at is null and s.started_at = (select rt from ultimo) then 'en_curso'
        when s.ended_at is null                                            then 'sin_salida'
        when exists (select 1 from base x
                      where x.type = 'entrada'
                        and x.rt > s.started_at and x.rt < s.ended_at)     then 'huerfana'
        when s.ended_at - s.started_at >= interval '16 hours'              then 'demasiado_larga'
        else null
      end as estado
    from spans s
  )
  select
    (w.started_at at time zone 'Europe/Madrid')::date,
    w.started_at, w.ended_at,
    w.minutes, w.presence_minutes, w.break_minutes,
    public.night_minutes_in_span(w.started_at, w.ended_at),
    (w.presence_minutes > 660
      or extract(hour from w.ended_at at time zone 'Europe/Madrid') between 4 and 10),
    'cerrada'::text
  from public.team_worked_shifts(
        (select acct from param), (select t_from from param), (select t_to from param)) w
  where w.employee_id = p_employee_id

  union all

  select
    (i.started_at at time zone 'Europe/Madrid')::date,
    i.started_at,
    case when i.estado = 'demasiado_larga' then i.ended_at else null end,
    null::numeric, null::numeric, null::numeric, null::numeric,
    false,
    i.estado
  from incidencias i
  where i.estado is not null

  order by 2;
$function$;

revoke all on function public.employee_daily_detail(uuid, date, date) from public;
revoke all on function public.employee_daily_detail(uuid, date, date) from anon;
grant execute on function public.employee_daily_detail(uuid, date, date) to authenticated, service_role;

comment on function public.employee_daily_detail(uuid, date, date) is
  'Dia a dia de la ficha del empleado. Las jornadas CERRADAS salen de '
  'team_worked_shifts sin tocar (mismos minutos de siempre). Desde el 29/08/2026 '
  'devuelve TAMBIEN las que ese motor descarta, marcadas en shift_state '
  '(en_curso | sin_salida | huerfana | demasiado_larga) y SIN total: un dato que '
  'el motor no sabe interpretar se marca, nunca se descarta en silencio.';

do $ver$
declare v_n int;
begin
  if to_regprocedure('public.employee_clock_status(uuid)') is null then
    raise exception 'employee_clock_status no quedo creada';
  end if;
  if to_regprocedure('public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean)') is null then
    raise exception 'add_manual_clock_entry con guard no quedo creada';
  end if;
  if to_regprocedure('public.add_manual_clock_entry(uuid, text, timestamptz, text, text)') is not null then
    raise exception 'la add_manual_clock_entry de 5 argumentos sigue viva: sobrecarga ambigua (regla 2)';
  end if;
  if to_regprocedure('public.employee_daily_detail(uuid, date, date)') is null then
    raise exception 'employee_daily_detail no quedo creada';
  end if;

  select count(*) into v_n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname='team_worked_shifts'
     and md5(pg_get_functiondef(p.oid)) = 'a3b912eee48cc4ea38e6591ec67e959b';
  if v_n <> 1 then
    raise exception 'team_worked_shifts ha cambiado y NO debia: las 375 jornadas validas estan en riesgo';
  end if;

  if has_function_privilege('anon', 'public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean)', 'EXECUTE') then
    raise exception 'add_manual_clock_entry sigue siendo ejecutable por anon';
  end if;
  if has_function_privilege('anon', 'public.employee_clock_status(uuid)', 'EXECUTE') then
    raise exception 'employee_clock_status sigue siendo ejecutable por anon';
  end if;
  if has_function_privilege('anon', 'public.employee_daily_detail(uuid, date, date)', 'EXECUTE') then
    raise exception 'employee_daily_detail sigue siendo ejecutable por anon';
  end if;
  if not has_function_privilege('authenticated', 'public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean)', 'EXECUTE') then
    raise exception 'authenticated NO puede ejecutar add_manual_clock_entry: el boton moriria con permission denied';
  end if;
  if not has_function_privilege('authenticated', 'public.employee_daily_detail(uuid, date, date)', 'EXECUTE') then
    raise exception 'authenticated NO puede ejecutar employee_daily_detail';
  end if;
  if not has_function_privilege('authenticated', 'public.employee_clock_status(uuid)', 'EXECUTE') then
    raise exception 'authenticated NO puede ejecutar employee_clock_status';
  end if;

  raise notice 'VERIFICACION OK: estado real, guard de escritura, jornadas marcadas y permisos cerrados';
end
$ver$;