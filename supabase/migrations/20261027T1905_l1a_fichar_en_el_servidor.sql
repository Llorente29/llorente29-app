-- supabase/migrations/20261027T1905_l1a_fichar_en_el_servidor.sql
--
-- L1a · PR 1 · Fichar en el servidor, permisos por papel y conservación
-- (27/10/2026). Encargo L1a de Julio; base: docs/laboral/l0/auditoria.md (§2.1,
-- §6) y las decisiones de Julio del 27/10.
--
-- Lo que hace, por partes:
--   1. current_user_ve_persona(empleado, cuenta): quién ve a quién. El
--      administrador de la cuenta, a todos; la propia persona, a sí misma; el
--      encargado (role manager), a las personas de sus locales
--      (current_user_location_ids, es decir, manager_locations).
--   2. clock_entries gana lo que se guarda de la ubicación sin guardar dónde
--      estaba nadie: la distancia al local (distance_m) y si cae dentro del
--      radio (within_radius). Y la hora declarada (declared_at): la del móvil
--      cuando fichó sin cobertura; created_at es la hora en que llegó.
--   3. fichar(), security definer: la hora la pone el servidor; cada persona
--      ficha por sí misma desde el móvil; la tablet, con el PIN comprobado aquí;
--      el origen lo decide la función (movil o tablet; una marca a mano es una
--      corrección, add_manual_clock_entry). Deja su propio rastro «create» con
--      quién, cuándo, por qué vía, para quién, la distancia y la hora declarada.
--   4. add_manual_clock_entry: el encargado también, para las personas de sus
--      locales (el fichaje a mano cuando falla el GPS es una corrección con
--      motivo, nunca una marca suelta).
--   5. Las lecturas por papel (decisión 1 de Julio): el encargado, las personas
--      de sus locales; las nóminas, la bandeja de nóminas y los documentos
--      (contratos y nóminas llevan salario y DNI), solo el administrador y la
--      propia persona; las bajas médicas, para el encargado, como «ausente»
--      (ausencias_visibles), nunca como baja.
--   6. empleados_datos_privados(cuenta): el salario, el DNI, la fecha de
--      nacimiento y el coste de Seguridad Social, solo para el administrador. El front los pide aquí y deja de
--      leerlos de employees (paso 1 de 2: ver abajo).
--   7. Conservación (decisión 2): conservar_registro_de_jornada(), cada noche:
--      las coordenadas de más de 3 meses se borran y quedan la distancia y
--      «dentro o fuera»; el registro de más de 4 años se anonimiza (textos
--      libres, foto y ubicación de las marcas y de su rastro). Cada pasada deja
--      una fila en registro_conservacion. Y su vigía, que avisa si deja de
--      correr.
--   8. locations.clock_geofence_mode nace en 'warn' (fuera del radio no bloquea:
--      se marca y se avisa). Solo cambia el valor por defecto: los locales que
--      ya existen se quedan como están (Foodint ya está en 'warn').
--
-- LO QUE NO HACE AQUÍ, A PROPÓSITO (CLAUDE.md, «borrar o renombrar va en dos
-- pasos»): quitar el INSERT directo de authenticated en clock_entries y quitar
-- a la sesión el salario, el DNI y la fecha de nacimiento de employees. El
-- front de antes inserta directo y lee employees con «*»: si se quitara ahora,
-- entre la tanda y que Vercel diga READY el portal no podría fichar ni cargar
-- las fichas. Este PR publica el front que ya no lo hace; el paso 2 va como
-- primer fichero de la tanda del PR 2. Mientras tanto, el INSERT directo sigue
-- cerrado como lo dejó la 1215: solo por ti y con la hora del servidor.
--
-- cambia: public.employees · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.clock_entries · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.vacations · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.payroll_cost · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.payroll_inbox · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.documents · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.clock_entry_audit · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.clock_correction_request · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.employee_notifications · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.monthly_balance_closures · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.locations · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public._clock_entry_quien_y_hora · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.add_manual_clock_entry · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public.employee_clock_status · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- cambia: public._documento_trabajador_puede · prueba: supabase/staging/sql/20261027_l1a_fichar_en_el_servidor_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261027T1905_l1a_fichar_en_el_servidor.down.sql

-- ── 1 · Quién ve a quién ───────────────────────────────────────────────────
create or replace function public.current_user_ve_persona(p_employee_id uuid, p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_admin_of(p_account_id)
      or public.current_user_is_employee(p_employee_id, p_account_id)
      or (exists (select 1 from public.user_profiles up
                   where up.user_id = auth.uid() and up.account_id = p_account_id
                     and up.role = 'manager' and up.active)
          and exists (select 1 from public.employees e
                       where e.id = p_employee_id and e.account_id = p_account_id
                         and (e.location_id = any (public.current_user_location_ids())
                              or coalesce(e.assigned_locations, '{}'::uuid[]) && public.current_user_location_ids())))
$$;
comment on function public.current_user_ve_persona(uuid, uuid) is
  'L1a (27/10): quién ve a una persona. El administrador de la cuenta, a todos; la propia persona; el encargado (manager), a las de sus locales (manager_locations). Un encargado sin locales asignados no ve a nadie: se le asignan en Usuarios.';
revoke all on function public.current_user_ve_persona(uuid, uuid) from public, anon;
grant execute on function public.current_user_ve_persona(uuid, uuid) to authenticated;

-- ── 2 · Lo que se guarda de la ubicación, y la hora declarada ──────────────
alter table public.clock_entries add column if not exists distance_m integer;
alter table public.clock_entries add column if not exists within_radius boolean;
alter table public.clock_entries add column if not exists declared_at timestamptz;
alter table public.clock_entries add column if not exists ubicacion_borrada_at timestamptz;
alter table public.clock_entries add column if not exists anonimizado_at timestamptz;
comment on column public.clock_entries.distance_m is 'L1a: metros entre el móvil y el local al fichar. Se queda cuando se borran las coordenadas (a los 3 meses).';
comment on column public.clock_entries.within_radius is 'L1a: si el fichaje cayó dentro del radio del local. Null: sin ubicación, o el local sin coordenadas.';
comment on column public.clock_entries.declared_at is 'L1a: la hora del móvil cuando se fichó sin cobertura (hora declarada). created_at es la hora en que llegó al servidor; el informe enseña las dos.';
comment on column public.clock_entries.ubicacion_borrada_at is 'L1a: cuándo se borraron las coordenadas (conservación: 3 meses).';
comment on column public.clock_entries.anonimizado_at is 'L1a: cuándo se anonimizó la marca (conservación: 4 años).';

create or replace function public._distancia_metros(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
returns integer language sql immutable set search_path = public as $$
  select case when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else round(2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2))))::integer end
$$;

-- ── 3 · fichar() ───────────────────────────────────────────────────────────
-- El disparador de la 1215 pone la hora del servidor a quien inserta directo.
-- fichar() ya la pone ella (y respeta la hora declarada sin cobertura): se lo
-- dice con app.fichar.
select public._respaldar_funcion('public._clock_entry_quien_y_hora()', '20261027T1905_l1a_fichar_en_el_servidor');
create or replace function public._clock_entry_quien_y_hora()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  -- fichar() ya ha comprobado quién y ha puesto la hora (L1a).
  if coalesce(current_setting('app.fichar', true), '') = 'on' then return new; end if;
  -- El servidor (funciones con la clave de servicio, SQL) no pasa por aquí.
  if auth.uid() is null then return new; end if;
  v_cuenta := coalesce(new.account_id, (select e.account_id from public.employees e where e.id = new.employee_id));
  -- El administrador y el encargado pueden poner una marca a otra persona
  -- (kiosko, ficha, correcciones): deja rastro en la auditoría (abajo).
  if public.current_user_is_admin_or_manager_of(v_cuenta) then return new; end if;
  -- El trabajador, solo para sí mismo.
  if not public.current_user_is_employee(new.employee_id, v_cuenta) then
    raise exception 'NO_AUTORIZADO: solo puedes fichar por ti'
      using hint = 'Solo puedes fichar por ti. Si hay que corregir el fichaje de otra persona, lo hace el encargado.', errcode = '42501';
  end if;
  if coalesce(new.source, '') = 'manual' then
    raise exception 'NO_AUTORIZADO: una marca puesta a mano la pone el encargado'
      using hint = 'Para corregir un fichaje, pide la corrección desde «Mis fichajes».', errcode = '42501';
  end if;
  -- La hora es la del servidor. La «efectiva» (redondeada al turno) se respeta
  -- solo si cae a menos de 30 min de ahora; si no, también es la del servidor.
  new.real_datetime := now();
  if new.datetime is null or abs(extract(epoch from (new.datetime - now()))) > 1800 then
    new.datetime := now();
  end if;
  return new;
end $$;

create or replace function public.fichar(
  p_employee_id uuid,
  p_type text,
  p_origen text,
  p_location_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_hora_efectiva timestamptz default null,
  p_hora_declarada timestamptz default null,
  p_scheduled text default null,
  p_rounding_applied boolean default false,
  p_diff_minutes integer default null,
  p_address text default null,
  p_pin text default null,
  p_break_attested boolean default null,
  p_break_attest_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_loc public.locations;
  v_up public.user_profiles;
  v_pin text;
  v_dist integer;
  v_radio integer;
  v_dentro boolean;
  v_real timestamptz;
  v_efectiva timestamptz;
  v_row public.clock_entries;
  v_motivo text;
  v_rastro jsonb;
begin
  if p_type not in ('entrada', 'salida', 'pausa_inicio', 'pausa_fin') then
    raise exception 'TIPO_INVALIDO: %', p_type using errcode = '22023';
  end if;
  select * into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null then
    raise exception 'PERSONA_NO_EXISTE' using errcode = '22023', hint = 'Esa persona no existe.';
  end if;
  if not coalesce(v_emp.active, true) then
    raise exception 'PERSONA_DE_BAJA' using errcode = '42501', hint = 'Esa persona está de baja en la empresa: no puede fichar.';
  end if;

  -- Quién, según desde dónde.
  if p_origen = 'movil' then
    if not public.current_user_is_employee(p_employee_id, v_emp.account_id) then
      raise exception 'NO_AUTORIZADO: solo puedes fichar por ti'
        using errcode = '42501', hint = 'Solo puedes fichar por ti. Si hay que corregir el fichaje de otra persona, lo hace el encargado.';
    end if;
  elsif p_origen = 'tablet' then
    -- La sesión de la tablet es la del administrador o la del encargado del local.
    if not (public.current_user_is_admin_of(v_emp.account_id)
            or (public.current_user_is_admin_or_manager_of(v_emp.account_id)
                and p_location_id = any (public.current_user_location_ids()))) then
      raise exception 'NO_AUTORIZADO: esta tablet no puede fichar en este local'
        using errcode = '42501', hint = 'La tablet tiene que estar abierta con el administrador o con el encargado de este local.';
    end if;
    select k.pin into v_pin from public.employee_kiosk_pin k where k.employee_id = p_employee_id;
    if v_pin is null or v_pin = '' then
      raise exception 'SIN_PIN' using errcode = '42501', hint = 'Esta persona no tiene PIN de kiosko. Se lo pone el administrador en su ficha.';
    end if;
    if p_pin is distinct from v_pin then
      raise exception 'PIN_INCORRECTO' using errcode = '42501', hint = 'El PIN no es correcto.';
    end if;
  elsif p_origen = 'manual' then
    raise exception 'USA_UNA_CORRECCION'
      using errcode = '22023', hint = 'Una marca puesta a mano es una corrección con motivo: «Añadir marca» en Control horario o en la ficha de la persona.';
  else
    raise exception 'ORIGEN_INVALIDO: %', p_origen using errcode = '22023';
  end if;

  -- El local, de la misma cuenta.
  select * into v_loc from public.locations where id = p_location_id and account_id = v_emp.account_id;
  if v_loc.id is null then
    raise exception 'LOCAL_INVALIDO' using errcode = '22023', hint = 'Ese local no es de tu empresa.';
  end if;

  -- Lo que se guarda de la ubicación: la distancia y si cae dentro del radio.
  v_radio := coalesce(v_loc.clock_radius_m, 200);
  v_dist := public._distancia_metros(p_lat, p_lng, v_loc.lat, v_loc.lng);
  v_dentro := case when v_dist is null then null else v_dist <= v_radio end;
  if v_dentro = false and coalesce(v_loc.clock_geofence_mode, 'warn') = 'block' then
    raise exception 'FUERA_DE_ZONA'
      using errcode = '42501', hint = format('Estás a %s m de %s. Acércate para fichar.', v_dist, v_loc.name);
  end if;

  -- La hora. Con cobertura, la del servidor (la efectiva redondeada al turno,
  -- solo si cae a menos de 30 min). Sin cobertura, la que declara el móvil,
  -- que no puede ser futura ni de hace más de 72 h; la de llegada es created_at.
  if p_hora_declarada is not null then
    if p_hora_declarada > now() + interval '2 minutes' then
      raise exception 'HORA_DECLARADA_FUTURA' using errcode = '22023', hint = 'La hora del móvil va por delante de la del servidor. Revisa la hora del teléfono.';
    end if;
    if p_hora_declarada < now() - interval '72 hours' then
      raise exception 'HORA_DECLARADA_ANTIGUA'
        using errcode = '22023', hint = 'Ese fichaje se hizo hace más de 72 h sin conexión. Pide la corrección desde «Mis fichajes».';
    end if;
    v_real := p_hora_declarada;
    v_efectiva := case when p_hora_efectiva is not null and abs(extract(epoch from (p_hora_efectiva - p_hora_declarada))) <= 1800
                       then p_hora_efectiva else p_hora_declarada end;
  else
    v_real := now();
    v_efectiva := case when p_hora_efectiva is not null and abs(extract(epoch from (p_hora_efectiva - now()))) <= 1800
                       then p_hora_efectiva else now() end;
  end if;

  perform set_config('app.fichar', 'on', true);
  insert into public.clock_entries (
    employee_id, account_id, type, datetime, real_datetime, declared_at, lat, lng, distance_m, within_radius,
    address, scheduled, rounding_applied, diff_minutes, source, location_id_at_clock,
    break_attested, break_attest_reason)
  values (
    p_employee_id, v_emp.account_id, p_type, v_efectiva, v_real, p_hora_declarada, p_lat, p_lng, v_dist, v_dentro,
    nullif(p_address, ''), p_scheduled, coalesce(p_rounding_applied, false), p_diff_minutes, p_origen, v_loc.id,
    p_break_attested, p_break_attest_reason)
  returning * into v_row;
  perform set_config('app.fichar', '', true);

  -- Su rastro, completo. Lo normal es que el disparador del alta sea diferido y
  -- corra al cerrar la transacción: entonces ve este «create» y no escribe. Si
  -- alguien lo ha puesto inmediato (set constraints … immediate), ya ha escrito
  -- el suyo: se completa ese, nunca dos rastros para la misma alta.
  select * into v_up from public.user_profiles up
   where up.user_id = auth.uid() and up.account_id = v_emp.account_id and up.active
   order by (up.employee_id = p_employee_id) desc nulls last limit 1;
  v_motivo := case p_origen
    when 'movil' then 'Fichaje propio desde el móvil'
    else 'Fichaje en la tablet del local, con PIN' end
    || case when p_hora_declarada is not null
         then format(' · sin cobertura: hora del móvil %s, llegó %s',
                     to_char(p_hora_declarada at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'),
                     to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'))
         else '' end;
  v_rastro := public._clock_snapshot(v_row) || jsonb_build_object(
    'via', p_origen,
    'para_otra_persona', not coalesce(v_up.employee_id = p_employee_id, false),
    'hora_servidor', now(),
    'hora_declarada', p_hora_declarada,
    'distancia_m', v_dist,
    'dentro_del_radio', v_dentro);
  update public.clock_entry_audit a
     set actor_user_id = auth.uid(), actor_employee_id = v_up.employee_id,
         actor_label = coalesce(v_up.role, case when auth.uid() is null then 'servidor' else 'sin perfil' end),
         reason = v_motivo, after = v_rastro
   where a.clock_entry_id = v_row.id and a.action = 'create';
  if not found then
    insert into public.clock_entry_audit (clock_entry_id, employee_id, account_id, action, actor_user_id, actor_employee_id, actor_label, reason, before, after)
    values (v_row.id, p_employee_id, v_emp.account_id, 'create', auth.uid(), v_up.employee_id,
            coalesce(v_up.role, case when auth.uid() is null then 'servidor' else 'sin perfil' end),
            v_motivo, null, v_rastro);
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'type', v_row.type, 'datetime', v_row.datetime, 'real_datetime', v_row.real_datetime,
    'declarada', v_row.declared_at, 'llegada', v_row.created_at, 'origen', v_row.source,
    'distancia_m', v_dist, 'dentro_del_radio', v_dentro, 'radio_m', v_radio,
    'local', v_loc.name, 'local_con_coordenadas', v_loc.lat is not null and v_loc.lng is not null);
end $$;
comment on function public.fichar(uuid, text, text, uuid, double precision, double precision, timestamptz, timestamptz, text, boolean, integer, text, text, boolean, text) is
  'L1a (27/10): fichar en el servidor. La hora la pone el servidor (o la declara el móvil sin cobertura, hasta 72 h); el móvil, solo por ti; la tablet, con PIN; guarda la distancia y si cae dentro del radio; deja su rastro «create».';
revoke all on function public.fichar(uuid, text, text, uuid, double precision, double precision, timestamptz, timestamptz, text, boolean, integer, text, text, boolean, text) from public, anon;
grant execute on function public.fichar(uuid, text, text, uuid, double precision, double precision, timestamptz, timestamptz, text, boolean, integer, text, text, boolean, text) to authenticated;

-- ── 4 · La marca a mano: una corrección con motivo, también del encargado ──
select public._respaldar_funcion('public.add_manual_clock_entry(uuid,text,timestamp with time zone,text,text,boolean)', '20261027T1905_l1a_fichar_en_el_servidor');
create or replace function public.add_manual_clock_entry(p_employee_id uuid, p_type text, p_datetime timestamp with time zone, p_reason text, p_actor_label text default null::text, p_force boolean default false)
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
  -- L1a (27/10): el administrador, o el encargado para las personas de sus
  -- locales. El fichaje a mano cuando falla el GPS es una corrección con
  -- motivo, nunca una marca suelta. El trabajador, nunca: él pide la corrección.
  if v_acct is null or not (public.current_user_is_admin_of(v_acct)
      or (public.current_user_is_admin_or_manager_of(v_acct) and public.current_user_ve_persona(p_employee_id, v_acct))) then
    raise exception 'NO_AUTORIZADO';
  end if;
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

-- ── 5 · Las lecturas, por papel ────────────────────────────────────────────
drop policy employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (public.current_user_ve_persona(id, account_id));

drop policy clock_entries_read on public.clock_entries;
create policy clock_entries_read on public.clock_entries for select to authenticated
  using (public.current_user_ve_persona(employee_id, account_id));

-- Las bajas médicas, solo el administrador y la propia persona. El encargado
-- las ve como «ausente» con ausencias_visibles (abajo): la fila existe y se
-- enseña, lo que no se enseña es el motivo de salud.
drop policy vacations_read on public.vacations;
create policy vacations_read on public.vacations for select to authenticated
  using (public.current_user_is_admin_of(account_id)
         or public.current_user_is_employee(employee_id, account_id)
         or (type <> 'baja_medica' and public.current_user_ve_persona(employee_id, account_id)));

-- Las nóminas llevan el salario: el administrador y la propia persona.
drop policy payroll_cost_read on public.payroll_cost;
create policy payroll_cost_read on public.payroll_cost for select
  using (public.current_user_is_admin_of(account_id) or public.current_user_is_employee(employee_id, account_id));

-- La bandeja lleva el DNI leído de la nómina: solo el administrador.
drop policy payroll_inbox_read on public.payroll_inbox;
create policy payroll_inbox_read on public.payroll_inbox for select
  using (public.current_user_is_admin_of(account_id));

-- Contratos y nóminas en PDF (salario, DNI): el administrador y la propia persona.
drop policy documents_read on public.documents;
create policy documents_read on public.documents for select to authenticated
  using (exists (select 1 from public.employees e
                  where e.id = documents.employee_id
                    and (public.current_user_is_admin_of(e.account_id) or public.current_user_is_employee(e.id, e.account_id))));

drop policy clock_audit_read on public.clock_entry_audit;
create policy clock_audit_read on public.clock_entry_audit for select
  using (public.current_user_is_admin_of(account_id)
         or (employee_id is not null and public.current_user_ve_persona(employee_id, account_id)));

drop policy clock_req_read on public.clock_correction_request;
create policy clock_req_read on public.clock_correction_request for select
  using (public.current_user_ve_persona(employee_id, account_id)
         or public.current_user_is_employee(requested_by_employee_id, account_id));

drop policy employee_notifications_read on public.employee_notifications;
create policy employee_notifications_read on public.employee_notifications for select to authenticated
  using (public.current_user_ve_persona(employee_id, account_id)
         or (sender_employee_id is not null and public.current_user_is_employee(sender_employee_id, account_id)));

drop policy monthly_balance_closures_read on public.monthly_balance_closures;
create policy monthly_balance_closures_read on public.monthly_balance_closures for select
  using (public.current_user_ve_persona(employee_id, account_id));

-- Los PDF del almacén: leen el administrador y la propia persona (el encargado
-- ya no: contratos y nóminas llevan salario y DNI). Escribir, como antes.
select public._respaldar_funcion('public._documento_trabajador_puede(text,boolean)', '20261027T1905_l1a_fichar_en_el_servidor');
create or replace function public._documento_trabajador_puede(p_name text, p_escribir boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_partes text[] := storage.foldername(p_name); v_uno text; v_dos text; v_emp uuid; v_cuenta uuid;
begin
  v_uno := v_partes[1]; v_dos := v_partes[2];
  if v_uno = '_inbox' then
    if v_dos is null or v_dos !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return public.current_user_is_admin(); end if;
    v_cuenta := v_dos::uuid;
    -- L1a: la bandeja de nóminas, solo el administrador (lee y escribe).
    return public.current_user_is_admin_of(v_cuenta);
  end if;
  if v_uno is null or v_uno !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return public.current_user_is_admin(); end if;
  v_emp := v_uno::uuid;
  select e.account_id into v_cuenta from public.employees e where e.id = v_emp;
  if v_cuenta is null then return public.current_user_is_admin(); end if;
  if p_escribir then return public.current_user_is_admin_of(v_cuenta); end if;
  return public.current_user_is_admin_of(v_cuenta) or public.current_user_is_employee(v_emp, v_cuenta);
end $$;

-- El estado de fichaje: el que ve a la persona.
select public._respaldar_funcion('public.employee_clock_status(uuid)', '20261027T1905_l1a_fichar_en_el_servidor');
create or replace function public.employee_clock_status(p_employee_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
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
  -- L1a (27/10/2026): tú mismo, el administrador, o el encargado de tus locales.
  if not public.current_user_ve_persona(p_employee_id, v_acct) then
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

-- Las ausencias que ve cada uno, con las bajas médicas como «ausente» para
-- quien no es el administrador ni la propia persona. Una fila que existe se
-- enseña siempre (regla 7): lo que se esconde es el motivo de salud.
create or replace function public.ausencias_visibles(p_desde date default null, p_hasta date default null, p_employee_ids uuid[] default null)
returns table (id uuid, employee_id uuid, type text, start_date date, end_date date, days numeric, status text, notes text,
               requested_at timestamptz, reviewed_at timestamptz, reviewed_by uuid, review_notes text,
               alert_min_staff boolean, alert_lead_time boolean, created_at timestamptz, paid boolean, account_id uuid,
               motivo_oculto boolean)
language sql stable security definer set search_path = public as $$
  select v.id, v.employee_id,
         case when v.type = 'baja_medica' and not (public.current_user_is_admin_of(v.account_id) or public.current_user_is_employee(v.employee_id, v.account_id))
              then 'ausente' else v.type end,
         v.start_date, v.end_date, v.days, v.status,
         case when v.type = 'baja_medica' and not (public.current_user_is_admin_of(v.account_id) or public.current_user_is_employee(v.employee_id, v.account_id))
              then null else v.notes end,
         v.requested_at, v.reviewed_at, v.reviewed_by,
         case when v.type = 'baja_medica' and not (public.current_user_is_admin_of(v.account_id) or public.current_user_is_employee(v.employee_id, v.account_id))
              then null else v.review_notes end,
         v.alert_min_staff, v.alert_lead_time, v.created_at, v.paid, v.account_id,
         (v.type = 'baja_medica' and not (public.current_user_is_admin_of(v.account_id) or public.current_user_is_employee(v.employee_id, v.account_id)))
    from public.vacations v
   where v.account_id = any (public.current_user_account_ids())
     and public.current_user_ve_persona(v.employee_id, v.account_id)
     and (p_desde is null or v.end_date >= p_desde)
     and (p_hasta is null or v.start_date <= p_hasta)
     and (p_employee_ids is null or v.employee_id = any (p_employee_ids))
   order by v.start_date desc
$$;
comment on function public.ausencias_visibles(date, date, uuid[]) is
  'L1a (27/10): las ausencias de las personas que ves. Las bajas médicas salen como «ausente», sin notas, para quien no es el administrador ni la propia persona (motivo_oculto = true).';
revoke all on function public.ausencias_visibles(date, date, uuid[]) from public, anon;
grant execute on function public.ausencias_visibles(date, date, uuid[]) to authenticated;

-- ── 6 · El salario, el DNI y la fecha de nacimiento, solo el administrador ──
create or replace function public.empleados_datos_privados(p_account_id uuid)
returns table (id uuid, salary numeric, dni text, birth_date date, employer_ss_annual numeric)
language sql stable security definer set search_path = public as $$
  select e.id, e.salary, e.dni, e.birth_date, e.employer_ss_annual
    from public.employees e
   where e.account_id = p_account_id
     and public.current_user_is_admin_of(p_account_id)
$$;
comment on function public.empleados_datos_privados(uuid) is
  'L1a (27/10): el salario, el DNI, la fecha de nacimiento y el coste de Seguridad Social de las personas de la cuenta, solo para su administrador. A cualquier otro le devuelve cero filas.';
revoke all on function public.empleados_datos_privados(uuid) from public, anon;
grant execute on function public.empleados_datos_privados(uuid) to authenticated;

-- ── 7 · Conservación ───────────────────────────────────────────────────────
create table if not exists public.registro_conservacion (
  id bigint generated always as identity primary key,
  ejecutado_at timestamptz not null default now(),
  coordenadas_borradas integer not null default 0,
  marcas_anonimizadas integer not null default 0,
  rastros_anonimizados integer not null default 0,
  peticiones_anonimizadas integer not null default 0,
  detalle jsonb not null default '{}'::jsonb
);
comment on table public.registro_conservacion is
  'L1a (27/10): una fila por pasada de conservar_registro_de_jornada(), también si no había nada que hacer. Es lo que mira su vigía.';
alter table public.registro_conservacion enable row level security;
revoke all on public.registro_conservacion from public, anon, authenticated;

create or replace function public.conservar_registro_de_jornada(p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_corte_ubicacion timestamptz := now() - interval '3 months';
  v_corte_registro timestamptz := now() - interval '4 years';
  v_coords integer := 0;
  v_marcas integer := 0;
  v_rastros integer := 0;
  v_peticiones integer := 0;
  v_ids uuid[];
begin
  if p_dry then
    return jsonb_build_object(
      'coordenadas_a_borrar', (select count(*) from public.clock_entries where created_at < v_corte_ubicacion and (lat is not null or lng is not null)),
      'marcas_a_anonimizar', (select count(*) from public.clock_entries where datetime < v_corte_registro and anonimizado_at is null),
      'corte_ubicacion', v_corte_ubicacion, 'corte_registro', v_corte_registro);
  end if;

  -- 1. Las coordenadas de más de 3 meses: antes de borrarlas, la distancia y
  --    «dentro o fuera», si el fichaje no las tenía (los de antes de la L1a).
  perform set_config('app.clock_edit_reason', 'Conservación: coordenadas de más de 3 meses borradas; quedan la distancia y si estaba dentro del radio', true);
  perform set_config('app.clock_edit_actor', 'conservación', true);
  with antes as (
    select c.id, public._distancia_metros(c.lat, c.lng, l.lat, l.lng) dist, coalesce(l.clock_radius_m, 200) radio
      from public.clock_entries c
      left join public.locations l on l.id = c.location_id_at_clock
     where c.created_at < v_corte_ubicacion and (c.lat is not null or c.lng is not null)
  ), hechas as (
    update public.clock_entries c
       set distance_m = coalesce(c.distance_m, a.dist),
           within_radius = coalesce(c.within_radius, case when a.dist is null then null else a.dist <= a.radio end),
           lat = null, lng = null, ubicacion_borrada_at = now()
      from antes a
     where a.id = c.id
    returning c.id
  )
  select count(*) into v_coords from hechas;

  -- 2. El registro de más de 4 años: fuera los textos libres, la foto y la
  --    ubicación de las marcas, de su rastro y de sus peticiones. La ficha de la
  --    persona (nombre, DNI) es de la L1b.
  perform set_config('app.clock_edit_reason', 'Conservación: registro de más de 4 años anonimizado', true);
  with hechas as (
    update public.clock_entries c
       set address = null, photo_data_url = null, break_attest_reason = null, lat = null, lng = null,
           anonimizado_at = now()
     where c.datetime < v_corte_registro and c.anonimizado_at is null
    returning c.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from hechas;
  v_marcas := coalesce(array_length(v_ids, 1), 0);
  if v_marcas > 0 then
    -- Su rastro, también el que acaba de escribir el disparador al anonimizar.
    with r as (
      update public.clock_entry_audit a
         set reason = 'Anonimizado (registro de más de 4 años)', actor_user_id = null, actor_employee_id = null,
             before = case when a.before is null then null else a.before - 'address' end,
             after = case when a.after is null then null else a.after - 'address' end
       where a.clock_entry_id = any (v_ids)
      returning 1
    )
    select count(*) into v_rastros from r;
  end if;
  with p as (
    update public.clock_correction_request q
       set reason = null, resolution_note = null
     where (q.clock_entry_id = any (v_ids) or q.created_at < v_corte_registro)
       and (q.reason is not null or q.resolution_note is not null)
    returning 1
  )
  select count(*) into v_peticiones from p;

  perform set_config('app.clock_edit_reason', '', true);
  perform set_config('app.clock_edit_actor', '', true);
  insert into public.registro_conservacion (coordenadas_borradas, marcas_anonimizadas, rastros_anonimizados, peticiones_anonimizadas, detalle)
  values (v_coords, v_marcas, v_rastros, v_peticiones,
          jsonb_build_object('corte_ubicacion', v_corte_ubicacion, 'corte_registro', v_corte_registro));
  return jsonb_build_object('coordenadas_borradas', v_coords, 'marcas_anonimizadas', v_marcas,
                            'rastros_anonimizados', v_rastros, 'peticiones_anonimizadas', v_peticiones);
end $$;
comment on function public.conservar_registro_de_jornada(boolean) is
  'L1a (27/10): cada noche (cron registro-jornada-conservacion). Borra las coordenadas de los fichajes de más de 3 meses (quedan la distancia y si estaba dentro del radio) y anonimiza el registro de más de 4 años. p_dry: solo cuenta. Deja una fila en registro_conservacion por pasada.';
revoke all on function public.conservar_registro_de_jornada(boolean) from public, anon, authenticated;

-- Su vigía: un trabajo de limpieza que deja de correr en silencio es el fallo
-- de siempre (regla 8). Avisa si el cron no existe o lleva más de 48 h sin
-- dejar su fila.
create or replace function public.conservacion_vigia(p_horas integer default 48, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cron boolean := false; v_ultima timestamptz; v_motivo text := null;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select exists (select 1 from cron.job where jobname = 'registro-jornada-conservacion' and active) into v_cron;
  end if;
  select max(ejecutado_at) into v_ultima from public.registro_conservacion;
  if not v_cron then
    v_motivo := 'El trabajo nocturno que borra las coordenadas de más de 3 meses no está programado (cron registro-jornada-conservacion). Hasta que se programe, las ubicaciones se guardan más tiempo del que dice la empresa.';
  elsif v_ultima is null or v_ultima < now() - make_interval(hours => p_horas) then
    v_motivo := format('El trabajo nocturno que borra las coordenadas de más de 3 meses no ha corrido desde %s. Las ubicaciones se están guardando más tiempo del que dice la empresa.',
                       coalesce(to_char(v_ultima at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), 'nunca'));
  end if;
  if v_motivo is not null and not p_dry then
    perform public._queue_system_alert('registro_jornada', 'Registro de jornada: la limpieza de ubicaciones no corre', v_motivo,
                                       'conservacion_registro_jornada', interval '20 hours');
  end if;
  return jsonb_build_object('cron', v_cron, 'ultima', v_ultima, 'aviso', v_motivo);
end $$;
comment on function public.conservacion_vigia(integer, boolean) is
  'L1a (27/10): cada mañana (cron registro-jornada-conservacion-vigia). Avisa (system_alert) si la limpieza del registro de jornada no está programada o lleva más de 48 h sin correr.';
revoke all on function public.conservacion_vigia(integer, boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'registro-jornada-conservacion') then
      perform cron.unschedule('registro-jornada-conservacion');
    end if;
    perform cron.schedule('registro-jornada-conservacion', '37 2 * * *', $cron$select public.conservar_registro_de_jornada()$cron$);
    if exists (select 1 from cron.job where jobname = 'registro-jornada-conservacion-vigia') then
      perform cron.unschedule('registro-jornada-conservacion-vigia');
    end if;
    perform cron.schedule('registro-jornada-conservacion-vigia', '13 7 * * *', $cron$select public.conservacion_vigia()$cron$);
  end if;
end $$;

-- ── 8 · Fuera del radio, por defecto no bloquea ────────────────────────────
alter table public.locations alter column clock_geofence_mode set default 'warn';
