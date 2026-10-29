-- supabase/migrations/20261028T1934_l1a3_fichar_con_precision.sql
--
-- L1a · PR 3 · tercera de tres (28/10/2026): fichar guarda la PRECISIÓN de la
-- ubicación que da el móvil (coords.accuracy, en metros), en
-- clock_entries.precision_m (la columna es de la 1800).
--
-- Por qué (Julio, 28/10): lo de Alcalá no era otro sitio, era el móvil de
-- Natacha con la «ubicación aproximada» del navegador: tres fichajes hoy a
-- exactamente 670 m (mínimo = máximo), y sus compañeras a 4–6 m. Medido en
-- producción, solo lectura, Foodint, 60 días: de 665 fichajes con ubicación,
-- 157 fuera del radio; 143 caen en 5 puntos exactos que se repiten (670 m 84
-- veces, 1.397 m 42), la huella de la ubicación aproximada.
--
-- Con una precisión de más de 100 m: within_radius queda en null (no se sabe
-- si estaba dentro o fuera), no bloquea aunque el local esté en «bloquear», y
-- el aviso al encargado (el disparador de la 1801) no salta. La distancia se
-- guarda igual. El trabajador lo ve en el momento, con los pasos para activar
-- la ubicación precisa.
--
-- CÓMO, sin borrar nada:
--   · fichar_con_precision(…, p_precision_m): NUEVA, con toda la lógica de
--     fichar() y la precisión. La llama el front nuevo.
--   · fichar(…): misma firma, cambia en caliente (con respaldo): llama a la
--     nueva sin precisión. El front de antes sigue igual.
-- Añadir el parámetro a fichar() pedía DROP + CREATE (regla 2: un replace
-- crea una sobrecarga y las llamadas de antes serían ambiguas), y borrar una
-- función que lee el front publicado va en dos pasos (W01). Así no hace falta
-- ninguno de los dos, y no hay un momento sin fichar().
--
-- cambia: public.fichar · prueba: supabase/staging/sql/20261028_l1a3_avisos_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261028T1934_l1a3_fichar_con_precision.down.sql

-- ── La guarda: fichar() como se midió el 28/10 ───────────────────────────────
do $guarda$
declare v_viva text := md5(pg_get_functiondef(to_regprocedure('public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)')));
begin
  if v_viva is null then
    raise exception 'L1a3 1934: no existe public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text). No se toca nada.';
  end if;
  if v_viva <> '6e69363e1aa85b404924d9274b87d084' then
    raise exception 'L1a3 1934: fichar() ha cambiado desde el 28/10 (md5 %, se midió 6e69363e1aa85b404924d9274b87d084). No se toca nada.', v_viva;
  end if;
end
$guarda$;

-- ── La nueva, con la precisión ──────────────────────────────────────────────
create or replace function public.fichar_con_precision(
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
  p_break_attest_reason text default null,
  p_precision_m integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_loc public.locations;
  v_up public.user_profiles;
  v_pin text;
  v_dist integer;
  v_radio integer;
  v_dentro boolean;
  v_aproximada boolean;
  v_precision integer;
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
  -- L1a PR 3 (28/10): con una ubicación aproximada (precisión de más de 100 m)
  -- no se sabe si estaba dentro o fuera: within_radius queda en null y se
  -- guarda la precisión. Nunca bloquea por eso.
  v_precision := case when p_precision_m is null or p_precision_m < 0 then null else least(p_precision_m, 1000000) end;
  v_aproximada := v_dist is not null and v_precision is not null and v_precision > 100;
  v_dentro := case when v_dist is null or v_aproximada then null else v_dist <= v_radio end;
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
    employee_id, account_id, type, datetime, real_datetime, declared_at, lat, lng, distance_m, within_radius, precision_m,
    address, scheduled, rounding_applied, diff_minutes, source, location_id_at_clock,
    break_attested, break_attest_reason)
  values (
    p_employee_id, v_emp.account_id, p_type, v_efectiva, v_real, p_hora_declarada, p_lat, p_lng, v_dist, v_dentro, v_precision,
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
    'dentro_del_radio', v_dentro,
    'precision_m', v_precision,
    'ubicacion_aproximada', v_aproximada);
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
    'precision_m', v_precision, 'ubicacion_aproximada', v_aproximada,
    'local', v_loc.name, 'local_con_coordenadas', v_loc.lat is not null and v_loc.lng is not null);
end $$;
comment on function public.fichar_con_precision(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text,integer) is
  'L1a PR 3 (28/10): fichar en el servidor, con la precisión de la ubicación (p_precision_m, coords.accuracy en metros). Con más de 100 m es una ubicación aproximada: within_radius en null, no bloquea y no avisa al encargado. fichar() la llama sin precisión.';
revoke all on function public.fichar_con_precision(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text,integer) from public, anon;
grant execute on function public.fichar_con_precision(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text,integer) to authenticated, service_role;

-- ── fichar(), la de siempre, llama a la nueva ───────────────────────────────
select public._respaldar_funcion('public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)', '20261028T1934_l1a3_fichar_con_precision');

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
returns jsonb language sql security definer set search_path = public as $$
  -- L1a PR 3 (28/10): la lógica vive en fichar_con_precision; aquí, sin precisión.
  select public.fichar_con_precision(p_employee_id, p_type, p_origen, p_location_id, p_lat, p_lng,
    p_hora_efectiva, p_hora_declarada, p_scheduled, p_rounding_applied, p_diff_minutes, p_address, p_pin,
    p_break_attested, p_break_attest_reason, null::integer);
$$;
