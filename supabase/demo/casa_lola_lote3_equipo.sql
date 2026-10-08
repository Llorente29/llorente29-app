-- Cuenta de demostración «Casa Lola» · LOTE 3: equipo, turnos, cuadrantes, fichajes, vacaciones y formación.
-- Personas inventadas, sin teléfono ni correo (ningún aviso puede salir). Solo escribe en la cuenta 623d946a.
do $lote$
declare
  v_acc constant uuid := '623d946a-a0ce-4f34-8c00-9761dfed8331';
  v_loc uuid;
  v_hoy constant date := (now() at time zone 'Europe/Madrid')::date;
  v_lunes constant date := date_trunc('week', (now() at time zone 'Europe/Madrid'))::date;
  -- [nombre, puesto, departamento, horas, alta, pin, turno, libra1, libra2]
  gente jsonb := '[
   ["Carmen Ortega","Jefa de cocina","Cocina",40,"2023-03-01","1101","Mañana",6,0],
   ["Luis Paredes","Cocinero","Cocina",40,"2024-01-15","1102","Tarde",0,1],
   ["Nadia Benali","Ayudante de cocina","Cocina",40,"2025-05-05","1103","Mañana",2,3],
   ["Óscar Prieto","Office","Office",20,"2026-02-02","1104","Cenas",0,1],
   ["Marta Giménez","Encargada de sala","Sala",40,"2023-03-01","1105","Tarde",6,0],
   ["Pablo Herrero","Camarero","Sala",40,"2024-06-10","1106","Mañana",1,2],
   ["Lucía Navarro","Camarera","Sala",40,"2025-09-01","1107","Tarde",2,3],
   ["Andrés Molina","Camarero","Sala",20,"2026-06-15","1108","Comidas",0,1],
   ["Sergio Campos","Barra","Barra",40,"2024-03-04","1109","Mañana",0,1],
   ["Elena Vidal","Barra","Barra",20,"2026-04-20","1110","Cenas",6,0],
   ["Iván Rubio","Repartidor","Reparto",20,"2026-09-07","1111","Cenas",0,1]
  ]';
  -- [turno, entra, sale, cobertura entre semana, cobertura fin de semana]
  turnos jsonb := '[["Mañana","10:00","18:00",4,4],["Tarde","16:00","00:00",3,3],["Comidas","12:00","16:00",1,1],["Cenas","20:00","00:00",2,3]]';
  g jsonb; t jsonb; v_emp uuid; v_tpl uuid; v_w date; v_d int; v_dia date; v_cells jsonb; v_ids jsonb;
  v_in timestamptz; v_out timestamptz; v_j1 int; v_j2 int; v_n int; v_resumen text; r record;
begin
  select id into strict v_loc from locations where account_id = v_acc;
  if exists (select 1 from employees where account_id = v_acc) then
    raise exception 'Casa Lola ya tiene equipo: este lote no se repite';
  end if;

  for t in select * from jsonb_array_elements(turnos) loop
    insert into shift_templates (account_id, location_id, label, start_time, end_time, coverage_mon, coverage_tue, coverage_wed, coverage_thu, coverage_fri, coverage_sat, coverage_sun, active, kind)
    values (v_acc, v_loc, t->>0, (t->>1)::time, (t->>2)::time, (t->>3)::int, (t->>3)::int, (t->>3)::int, (t->>3)::int, (t->>4)::int, (t->>4)::int, (t->>4)::int, true, 'demanda');
  end loop;

  for g in select * from jsonb_array_elements(gente) loop
    insert into employees (account_id, location_id, name, position, department, contract_type, weekly_hours, contracted_hours_week, start_date, pin, active, forgot_clockout_reminder, notes)
    values (v_acc, v_loc, g->>0, g->>1, g->>2, 'Indefinido', (g->>3)::numeric, (g->>3)::numeric, (g->>4)::date, g->>5, true, false, 'Persona inventada para la demostración.');
  end loop;

  -- Vacaciones ANTES de los cuadrantes: el cuadrante rechaza a quien está de vacaciones aprobadas.
  insert into vacations (account_id, employee_id, type, start_date, end_date, days, status, paid, requested_at, reviewed_at, notes)
  select v_acc, e.id, 'vacaciones', v_lunes - 21, v_lunes - 15, 7, 'aprobada', true, now() - interval '50 days', now() - interval '48 days', 'Semana de septiembre.'
    from employees e where e.account_id = v_acc and e.name = 'Pablo Herrero';
  insert into vacations (account_id, employee_id, type, start_date, end_date, days, status, paid, requested_at, reviewed_at, notes)
  select v_acc, e.id, 'vacaciones', v_lunes + 21, v_lunes + 27, 7, 'aprobada', true, now() - interval '12 days', now() - interval '10 days', null
    from employees e where e.account_id = v_acc and e.name = 'Lucía Navarro';
  insert into vacations (account_id, employee_id, type, start_date, end_date, days, status, paid, requested_at, notes)
  select v_acc, e.id, 'asuntos_propios', v_lunes + 18, v_lunes + 20, 3, 'solicitada', true, now() - interval '1 day', 'Boda de un familiar.'
    from employees e where e.account_id = v_acc and e.name = 'Andrés Molina';

  -- Cuadrantes: seis semanas atrás, ésta y la que viene publicadas; la siguiente, en borrador.
  for v_n in -6 .. 2 loop
    v_w := v_lunes + v_n * 7;
    v_cells := '{}'::jsonb;
    for t in select * from jsonb_array_elements(turnos) loop
      select id into strict v_tpl from shift_templates where account_id = v_acc and label = t->>0;
      for v_d in 0 .. 6 loop
        select coalesce(jsonb_agg(e.id order by e.name), '[]'::jsonb) into v_ids
          from employees e join jsonb_array_elements(gente) gg on gg->>0 = e.name
         where e.account_id = v_acc and gg->>6 = t->>0
           and v_d not in ((gg->>7)::int, (gg->>8)::int)
           and e.start_date <= v_w + v_d
           and not exists (select 1 from vacations v where v.employee_id = e.id and v.status = 'aprobada' and v_w + v_d between v.start_date and v.end_date);
        if jsonb_array_length(v_ids) > 0 then
          v_cells := jsonb_set(v_cells, array[v_tpl::text], coalesce(v_cells -> v_tpl::text, '{}'::jsonb) || jsonb_build_object(v_d::text, v_ids));
        end if;
      end loop;
    end loop;
    insert into schedules (account_id, location_id, week_start, cells, coverage_overrides, status, generated_at, published_at)
    values (v_acc, v_loc, v_w, v_cells, '{}'::jsonb, case when v_n = 2 then 'draft' else 'published' end, (v_w - 6)::timestamptz, case when v_n = 2 then null else (v_w - 5)::timestamptz end);
  end loop;

  -- Fichajes: lo que dice el cuadrante, con los minutos de la vida real. Nada en el futuro.
  for r in
    select e.id emp, e.name, d::date dia, (tt->>1)::time h_in, (tt->>2)::time h_out
      from employees e
      join jsonb_array_elements(gente) gg on gg->>0 = e.name
      join jsonb_array_elements(turnos) tt on tt->>0 = gg->>6
      cross join generate_series(v_lunes - 42, v_hoy, interval '1 day') d
     where e.account_id = v_acc
       and (extract(isodow from d)::int - 1) not in ((gg->>7)::int, (gg->>8)::int)
       and e.start_date <= d::date
       and not exists (select 1 from vacations v where v.employee_id = e.id and v.status = 'aprobada' and d::date between v.start_date and v.end_date)
     order by d, h_in, e.name
  loop
    v_j1 := (abs(hashtext(r.name || r.dia::text)) % 16) - 6;                 -- de −6 a +9 minutos
    if abs(hashtext('tarde' || r.name || r.dia::text)) % 23 = 0 then v_j1 := 18 + abs(hashtext(r.name)) % 12; end if;  -- algún retraso de verdad
    v_j2 := (abs(hashtext(r.dia::text || r.name)) % 16) - 3;                 -- de −3 a +12 minutos
    v_in  := ((r.dia + r.h_in) at time zone 'Europe/Madrid') + make_interval(mins => v_j1);
    v_out := ((case when r.h_out <= r.h_in then r.dia + 1 else r.dia end + r.h_out) at time zone 'Europe/Madrid') + make_interval(mins => v_j2);
    if v_in <= now() then
      insert into clock_entries (account_id, employee_id, type, datetime, real_datetime, scheduled, rounding_applied, diff_minutes, source, location_id_at_clock, voided)
      values (v_acc, r.emp, 'entrada', v_in, v_in, to_char(r.h_in, 'HH24:MI'), false, v_j1, 'kiosko', v_loc, false);
    end if;
    if v_out <= now() then
      insert into clock_entries (account_id, employee_id, type, datetime, real_datetime, scheduled, rounding_applied, diff_minutes, source, location_id_at_clock, voided)
      values (v_acc, r.emp, 'salida', v_out, v_out, to_char(r.h_out, 'HH24:MI'), false, v_j2, 'kiosko', v_loc, false);
    end if;
  end loop;

  -- Formación: los cursos de bienvenida se asignan solos al dar de alta; aquí, quién los ha hecho.
  insert into course_attempt (account_id, assignment_id, employee_id, started_at, finished_at, score_pct, passed, answers, time_spent_seconds)
  select v_acc, ca.id, e.id,
         now() - make_interval(days => 5 + abs(hashtext(e.name || c.code)) % 40),
         now() - make_interval(days => 5 + abs(hashtext(e.name || c.code)) % 40) + make_interval(mins => 18 + abs(hashtext(c.code || e.name)) % 20),
         case when e.name = 'Óscar Prieto' and c.code = 'alergenos_intolerancias' then 60 else 75 + (abs(hashtext(e.name || c.code)) % 6) * 5 end,
         not (e.name = 'Óscar Prieto' and c.code = 'alergenos_intolerancias'),
         '{}'::jsonb, (18 + abs(hashtext(c.code || e.name)) % 20) * 60
    from course_assignment ca join employees e on e.id = ca.employee_id join course c on c.id = ca.course_id
   where ca.account_id = v_acc
     and e.name not in ('Iván Rubio', 'Andrés Molina');

  select format('empleados=%s turnos=%s cuadrantes=%s (publicados=%s) fichajes=%s (entradas=%s salidas=%s) dentro_ahora=%s vacaciones=%s asignaciones=%s intentos=%s (aprobados=%s) avisos=%s (encolados=%s)',
    (select count(*) from employees where account_id=v_acc),
    (select count(*) from shift_templates where account_id=v_acc),
    (select count(*) from schedules where account_id=v_acc),
    (select count(*) from schedules where account_id=v_acc and status='published'),
    (select count(*) from clock_entries where account_id=v_acc),
    (select count(*) from clock_entries where account_id=v_acc and type='entrada'),
    (select count(*) from clock_entries where account_id=v_acc and type='salida'),
    (select count(*) from clock_entries where account_id=v_acc and type='entrada') - (select count(*) from clock_entries where account_id=v_acc and type='salida'),
    (select count(*) from vacations where account_id=v_acc),
    (select count(*) from course_assignment where account_id=v_acc),
    (select count(*) from course_attempt where account_id=v_acc),
    (select count(*) from course_attempt where account_id=v_acc and passed),
    (select count(*) from training_notice where account_id=v_acc),
    (select count(*) from training_notice where account_id=v_acc and status='queued'))
  into v_resumen;
  --ENSAYO--
end
$lote$;
