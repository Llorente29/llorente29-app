-- 20260829T2030_ficha_empleado_estado_real_y_guard.sql
-- ============================================================================
-- La ficha dice "Sin entrada" a gente que esta trabajando. 29/08/2026.
--
-- REGRESION del 07/08/2026, no un comportamiento de siempre:
--   16:01  20260807160125_f1_5_team_worked_shifts_fix_orphan_entry
--          endurecio team_worked_shifts con `where s.ended_at is not null`.
--          CORRECTO: una entrada huerfana del 08/07 se emparejaba con una
--          salida posterior e inventaba +11,4 h ficticias.
--   17:47  20260807174747_f4_employee_daily_detail
--          creo employee_daily_detail, y la ficha paso de listar FICHAJES a
--          listar JORNADAS.
-- Efecto no declarado: una jornada sin salida no existe. Quien esta dentro
-- ahora mismo desaparece de su propia ficha.
--
-- QUE NO SE TOCA, Y POR QUE
-- `team_worked_shifts` NO se toca. Es el motor de la bolsa de horas
-- (hoursBalanceService) y del export de gestoria (exportGestoriaService), y su
-- contrato -- "jornadas CERRADAS y fiables" -- es legitimo. Tocarlo pondria en
-- riesgo las 375 jornadas validas que la verificacion exige que sigan siendo
-- 375 con los mismos minutos. Las jornadas con incidencia salen por
-- employee_daily_detail, cuyo unico consumidor es la ficha
-- (teamHoursService.fetchEmployeeDailyDetail -> StaffPage). Verificado por
-- grep: ningun otro sitio la llama.
--
-- LA REGLA QUE SE APLICA (§6 del encargo)
-- Un dato que el motor no sabe interpretar SE MARCA, nunca se descarta.
-- Descartar en silencio convierte un problema visible en deuda invisible.
-- Es la hermana de la regla 7: aqui no es un umbral el que esconde filas, es
-- un filtro de validez -- pero el operario paga lo mismo.
--
-- PERMISOS: EL DROP NO LOS PIERDE, LOS ENSANCHA
-- Julio avisa de que el DROP se lleva los grants por delante y la funcion
-- moriria con permission denied. Comprobado en produccion, y el efecto es el
-- CONTRARIO: `pg_default_acl` del esquema public concede EXECUTE a anon,
-- authenticated y service_role a TODA funcion nueva, y ademas PostgreSQL
-- concede EXECUTE a PUBLIC por defecto. Evidencia: set_brand_status y
-- brand_status se recrearon con DROP + CREATE esta misma tarde y hoy tienen
-- =X/postgres | postgres | anon | authenticated | service_role -- el juego
-- completo, sin perder nada, y funcionando.
--
-- Pero el aviso apunta a algo real, solo que al reves: el DROP BORRA CUALQUIER
-- REVOKE ANTERIOR y devuelve la funcion a PUBLIC + anon. Un endurecimiento
-- hecho hace meses se deshace solo, en silencio, la proxima vez que alguien
-- toque la firma. Por eso aqui los permisos se declaran EXPLICITAMENTE despues
-- de cada CREATE, en vez de confiar en el default.
--
-- Y de paso lo que pide Julio: add_manual_clock_entry es SECURITY DEFINER que
-- ESCRIBE en el registro legal de jornada. Hoy anon puede llamarla (falla
-- dentro, por current_user_is_admin_of, pero llega). Se le quita a anon y a
-- PUBLIC. Es la deuda F0 de multi-inquilino que bloquea el cliente 2, y sale
-- gratis mientras la funcion se recrea de todas formas.
-- Verificado que ninguna superficie anonima la llama: el unico llamador es
-- clockEditService.addManualClockEntry -> StaffPage (oficina, authenticated).
-- El kiosko NO usa esta RPC: ficha insertando en la tabla.
--
-- NO SE INVENTAN HORAS. Las filas con incidencia devuelven worked_minutes,
-- presence_minutes, break_minutes y night_minutes en NULL. Se muestran sin
-- total y se pide correccion. El arreglo del 07/08 dejo de inventar horas; esto
-- no las vuelve a inventar, solo deja de borrarlas de la vista.
-- ============================================================================

begin;

-- ── A · El estado real, del ultimo fichaje no anulado ───────────────────────
-- Misma logica que training_is_clocked_in, que ya funciona y ya dice la verdad.
-- La ficha dejara de depender de emp.clockEntries (estado local congelado en el
-- montaje: StaffPage.tsx:426 inicializa con useState y no hay ningun useEffect
-- que lo resincronice cuando cambia el prop).
--
-- Tres estados, nunca dos:
--   trabajando   -- hay una entrada abierta. `since` = cuando entro.
--   fuera        -- el ultimo evento es una salida.
--   sin_fichajes -- no hay ningun evento hoy. ESTE y solo este es el
--                   "Sin entrada" de ahora.
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
    -- que cita el parte. Ensenar la real descuadraria la ficha con el reloj de
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

-- Permisos EXPLICITOS, no heredados del default (ver cabecera).
revoke all on function public.employee_clock_status(uuid) from public;
revoke all on function public.employee_clock_status(uuid) from anon;
grant execute on function public.employee_clock_status(uuid) to authenticated, service_role;

comment on function public.employee_clock_status(uuid) is
  'Estado REAL de fichaje de un empleado, del ultimo fichaje no anulado (misma '
  'logica que training_is_clocked_in). Tres estados: trabajando | fuera | '
  'sin_fichajes. minutos_hoy incluye el tramo abierto hasta ahora. Creada el '
  '29/08/2026 porque la ficha deducia "Sin entrada" de no tener jornadas CERRADAS.';

commit;

begin;

-- ── D · El guard, en la escritura ───────────────────────────────────────────
-- "Un guard que solo vive en el front no es un guard."
-- Hoy add_manual_clock_entry valida motivo, tipo y permiso, y NUNCA comprueba
-- si la persona ya esta dentro. Y no hay red debajo:
--   tg_clock_entry_debounce    -> solo source='kiosko', ventana de 60 s.
--   tg_clock_entry_pause_order -> solo pausa_*, y ademas se salta los manuales.
-- Con la ficha diciendo "Sin entrada" y ofreciendo "Fichar entrada" como accion
-- principal, un clic crea la SEGUNDA entrada sin salida en medio: exactamente la
-- entrada huerfana que la migracion del 07/08 a las 16:01 vino a arreglar.
--
-- Se anade p_force -> DROP + CREATE, nunca CREATE OR REPLACE (regla 2: replace
-- crea una SOBRECARGA y las llamadas viejas quedan ambiguas). Aqui el DEFAULT
-- si es correcto y es el valor SEGURO: p_force = false = guard activo. Las
-- llamadas de 5 argumentos que ya hace el front siguen valiendo y pasan por el
-- guard sin tocar una linea de front.
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

-- Permisos EXPLICITOS. anon y PUBLIC FUERA: es SECURITY DEFINER y escribe en
-- el registro legal de jornada. Que falle dentro no es una razon para dejar
-- que llegue.
revoke all on function public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean) from public;
revoke all on function public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean) from anon;
grant execute on function public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean) to authenticated, service_role;

comment on function public.add_manual_clock_entry(uuid, text, timestamptz, text, text, boolean) is
  'Fichaje manual CON guard de coherencia (29/08/2026). Rechaza una entrada sobre alguien '
  'que ya estaba dentro (YA_ESTA_FICHADO) y una salida sin apertura previa (NO_ESTA_FICHADO), '
  'evaluado en el momento de p_datetime, no ahora. p_force=true lo salta y marca el motivo '
  'como FORZADO en el rastro: el gestor necesita poder arreglar un historico roto, pero como '
  'decision consciente, no como camino por defecto.';

commit;

begin;

-- ── B + E · El "Dia a dia" deja de borrar en silencio ───────────────────────
-- Cambia el TIPO DE RETORNO (nueva columna shift_state) -> DROP + CREATE.
-- Mismos argumentos, asi que no queda sobrecarga.
--
-- Las jornadas CERRADAS salen exactamente de donde salian: team_worked_shifts,
-- sin tocar. Por eso las 375 validas siguen siendo 375 con los mismos minutos.
-- Lo que se anade son las que ese motor descarta, clasificadas con SU MISMO
-- criterio y SIN total:
--   en_curso         entrada abierta que es el ultimo evento -> esta dentro AHORA
--   sin_salida       entrada sin salida, pero ya hay eventos posteriores
--   huerfana         hay otra entrada antes de la salida (el caso del 08/07)
--   demasiado_larga  la salida existe pero a >= 16 h; se muestra para corregir
--
-- worked/presence/break/night van en NULL a proposito. No se inventan horas:
-- se marca la fila y se pide correccion.
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

-- Permisos EXPLICITOS. Solo la ficha de oficina la consume.
revoke all on function public.employee_daily_detail(uuid, date, date) from public;
revoke all on function public.employee_daily_detail(uuid, date, date) from anon;
grant execute on function public.employee_daily_detail(uuid, date, date) to authenticated, service_role;

comment on function public.employee_daily_detail(uuid, date, date) is
  'Dia a dia de la ficha del empleado. Las jornadas CERRADAS salen de '
  'team_worked_shifts sin tocar (mismos minutos de siempre). Desde el 29/08/2026 '
  'devuelve TAMBIEN las que ese motor descarta, marcadas en shift_state '
  '(en_curso | sin_salida | huerfana | demasiado_larga) y SIN total: un dato que '
  'el motor no sabe interpretar se marca, nunca se descarta en silencio.';

-- ── GUARDA FINAL ────────────────────────────────────────────────────────────
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

  -- team_worked_shifts NO se ha tocado.
  select count(*) into v_n from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname='team_worked_shifts'
     and md5(pg_get_functiondef(p.oid)) = 'a3b912eee48cc4ea38e6591ec67e959b';
  if v_n <> 1 then
    raise exception 'team_worked_shifts ha cambiado y NO debia: las 375 jornadas validas estan en riesgo';
  end if;

  -- Permisos: que el DROP no haya devuelto nada a anon ni a PUBLIC.
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

commit;

-- ── Comprobaciones DESPUES de aplicar (pegar el resultado, no el resumen) ────
--
-- 1) Pamela, que esta dentro:
-- select public.employee_clock_status('147289a6-fb45-408d-a0ec-04c3ccdc29c1');
--    -- esperado: estado=trabajando, abierta_desde 29/08 12:12, minutos_hoy > 450.
--
-- 2) Su dia a dia del 29/08 ya no esta vacio:
-- select work_date, started_at, ended_at, worked_minutes, shift_state
--   from employee_daily_detail('147289a6-fb45-408d-a0ec-04c3ccdc29c1','2026-08-29','2026-08-29');
--    -- esperado: 1 fila, shift_state='en_curso', worked_minutes NULL.
--
-- 3) Las 375 siguen siendo 375 (verificacion 7 del encargo):
-- select count(*) from team_worked_shifts(
--   (select account_id from employees where id='147289a6-fb45-408d-a0ec-04c3ccdc29c1'),
--   '2000-01-01'::timestamptz, '2100-01-01'::timestamptz);
--
-- 4) El guard rechaza (NO ejecutar sobre alguien de verdad sin querer insertar):
-- select public.add_manual_clock_entry('147289a6-...','entrada', now(), 'prueba');
--    -- esperado: ERROR YA_ESTA_FICHADO.
