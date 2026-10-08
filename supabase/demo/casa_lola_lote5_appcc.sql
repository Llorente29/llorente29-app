-- Cuenta de demostración «Casa Lola» · LOTE 5: seguridad alimentaria (APPCC).
-- Ocho controles diarios programados, seis semanas de registros hechos y dos incidencias (una cerrada, una abierta).
do $lote$
declare
  v_acc constant uuid := '623d946a-a0ce-4f34-8c00-9761dfed8331';
  v_loc uuid; v_uid uuid; v_cocina uuid; v_sala uuid;
  v_hoy constant date := (now() at time zone 'Europe/Madrid')::date;
  -- [plantilla, hora, quién: C cocina / S sala]
  plan jsonb := '[["temp_cameras_am","10:15","C"],["hygiene_daily","10:30","C"],["expiry_cameras_daily","11:00","C"],["oil_check_daily","17:00","C"],
                  ["temp_cameras_pm","23:30","C"],["clean_kitchen_daily","23:45","C"],["clean_diningroom_daily","23:45","S"],["clean_toilets_daily","23:50","S"]]';
  p jsonb; r record; i record; v_tpl uuid; v_sch uuid; v_ex uuid; v_ts timestamptz; v_h int; v_num numeric; v_fallo boolean; v_resumen text; v_inc uuid;
begin
  select id into strict v_loc from locations where account_id = v_acc;
  select user_id into strict v_uid from user_profiles where account_id = v_acc and role = 'admin';
  select id into strict v_cocina from employees where account_id = v_acc and name = 'Carmen Ortega';
  select id into strict v_sala   from employees where account_id = v_acc and name = 'Marta Giménez';
  if exists (select 1 from appcc_schedules where account_id = v_acc) then
    raise exception 'Casa Lola ya tiene controles programados: este lote no se repite';
  end if;

  for p in select * from jsonb_array_elements(plan) loop
    select id into strict v_tpl from appcc_templates where account_id = v_acc and code = p->>0;
    insert into appcc_schedules (account_id, location_id, template_id, recurrence_type, recurrence_config, scheduled_time, valid_from, is_active, created_by)
    values (v_acc, v_loc, v_tpl, 'daily', '{}'::jsonb, (p->>1)::time, v_hoy - 42, true, v_uid) returning id into v_sch;

    for r in select d::date dia from generate_series(v_hoy - 42, v_hoy, interval '1 day') d loop
      v_ts := ((r.dia + (p->>1)::time) at time zone 'Europe/Madrid') + make_interval(mins => abs(hashtext(p->>0 || r.dia::text)) % 25);
      v_h  := abs(hashtext('h' || (p->>0) || r.dia::text)) % 100;
      if v_ts > now() then
        -- todavía no toca: pendiente
        insert into appcc_executions (account_id, location_id, template_id, schedule_id, scheduled_date, scheduled_time, status, assigned_to)
        values (v_acc, v_loc, v_tpl, v_sch, r.dia, (p->>1)::time, 'pending', case p->>2 when 'S' then v_sala else v_cocina end);
        continue;
      end if;
      if v_h < 4 and r.dia < v_hoy then
        -- se quedó sin hacer: eso también pasa, y la pantalla tiene que enseñarlo
        insert into appcc_executions (account_id, location_id, template_id, schedule_id, scheduled_date, scheduled_time, status, assigned_to)
        values (v_acc, v_loc, v_tpl, v_sch, r.dia, (p->>1)::time, 'overdue', case p->>2 when 'S' then v_sala else v_cocina end);
        continue;
      end if;
      insert into appcc_executions (account_id, location_id, template_id, schedule_id, scheduled_date, scheduled_time, status, assigned_to, started_at, started_by, completed_at, completed_by)
      values (v_acc, v_loc, v_tpl, v_sch, r.dia, (p->>1)::time, 'completed', case p->>2 when 'S' then v_sala else v_cocina end, v_ts, v_uid, v_ts + interval '4 minutes', v_uid)
      returning id into v_ex;

      for i in select * from appcc_template_items where template_id = v_tpl order by display_order loop
        -- Dos lecturas fuera de rango en toda la historia: la cámara de carnes hace 9 días y el congelador ayer.
        v_fallo := (p->>0 = 'temp_cameras_am' and i.code = 'camara_carne' and r.dia = v_hoy - 9)
                or (p->>0 = 'temp_cameras_pm' and i.code = 'congelador'   and r.dia = v_hoy - 1);
        if i.field_type = 'numeric' and (i.numeric_min is not null and i.numeric_max is not null) then
          v_num := round(i.numeric_min + (i.numeric_max - i.numeric_min) * (0.25 + (abs(hashtext(i.code || r.dia::text)) % 50) / 100.0), 1);
          if v_fallo then v_num := i.numeric_max + case when i.code = 'congelador' then 4.5 else 2.5 end; end if;
          insert into appcc_execution_responses (execution_id, item_id, numeric_value, answered_at, answered_by)
          values (v_ex, i.id, v_num, v_ts + interval '1 minute', case when v_fallo then null else v_uid end);
        elsif i.field_type = 'boolean' then
          insert into appcc_execution_responses (execution_id, item_id, boolean_value, answered_at, answered_by)
          values (v_ex, i.id, case when i.code = 'cambio_realizado' then extract(isodow from r.dia) in (1, 4) else coalesce(i.expected_boolean, true) end, v_ts + interval '2 minutes', v_uid);
        end if;
      end loop;
    end loop;
  end loop;

  -- La incidencia de hace 9 días se resolvió; la de ayer sigue abierta.
  -- La incidencia nace con la fecha del registro que la abrió, no con la de esta carga.
  update appcc_incidents inc set created_at = e.completed_at, sla_due_at = e.completed_at + make_interval(hours => 2)
    from appcc_executions e where e.id = inc.execution_id and inc.account_id = v_acc;
  select inc.id into v_inc from appcc_incidents inc join appcc_executions e on e.id = inc.execution_id
   where inc.account_id = v_acc and e.scheduled_date = v_hoy - 9;
  if v_inc is not null then
    update appcc_incidents
       set status = 'closed', assigned_to = v_cocina, assigned_at = created_at,
           root_cause = 'La puerta de la cámara se quedó mal cerrada tras la descarga del proveedor.', root_cause_method = 'direct',
           corrective_action = 'Se revisó el género (a 3 °C en el centro), se cerró la cámara y bajó a 2,5 °C en 40 minutos.',
           corrective_action_at = created_at + interval '45 minutes',
           preventive_action = 'Cartel en la puerta y repaso con el equipo: comprobar el cierre después de cada descarga.',
           preventive_action_at = created_at + interval '1 day',
           verified_at = created_at + interval '1 day', verification_effective = true, verification_notes = 'Tres días seguidos en rango.',
           resolved_at = created_at + interval '45 minutes', resolved_by = v_uid, closed_at = created_at + interval '1 day', closed_by = v_uid
     where id = v_inc;
  end if;
  update appcc_incidents inc set assigned_to = v_cocina, assigned_at = now(), status = 'assigned',
         description = 'El congelador marcó por encima de −18 °C al cierre. Revisar junta de la puerta y carga.'
    from appcc_executions e where e.id = inc.execution_id and inc.account_id = v_acc and e.scheduled_date = v_hoy - 1;

  select format('programados=%s registros=%s (hechos=%s sin_hacer=%s pendientes_hoy=%s) respuestas=%s fuera_de_rango=%s incidencias=%s (cerradas=%s abiertas=%s)',
    (select count(*) from appcc_schedules where account_id=v_acc),
    (select count(*) from appcc_executions where account_id=v_acc),
    (select count(*) from appcc_executions where account_id=v_acc and status='completed'),
    (select count(*) from appcc_executions where account_id=v_acc and status='overdue'),
    (select count(*) from appcc_executions where account_id=v_acc and status='pending'),
    (select count(*) from appcc_execution_responses x join appcc_executions e on e.id=x.execution_id where e.account_id=v_acc),
    (select count(*) from appcc_execution_responses x join appcc_executions e on e.id=x.execution_id where e.account_id=v_acc and x.is_out_of_range),
    (select count(*) from appcc_incidents where account_id=v_acc),
    (select count(*) from appcc_incidents where account_id=v_acc and status='closed'),
    (select count(*) from appcc_incidents where account_id=v_acc and status<>'closed'))
  into v_resumen;
  --ENSAYO--
end
$lote$;
