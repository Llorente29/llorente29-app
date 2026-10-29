-- supabase/migrations/20261029T0733_l1a_informe_origen.sql
--
-- L1a · PR 2b («Cerrar»), cuarto fichero (29/10/2026). El informe para la
-- Inspección, con el origen correcto.
--
--   1. _solo_cambia_origen(antes, después): una fila del rastro cuyo antes y
--      después solo difieren en «source». Es lo que deja la corrección de datos
--      de la 0732 (y su vuelta atrás).
--   2. _informe_registro_jornada (misma firma, con respaldo):
--      · cada marca lleva «origen_corregido» (de qué origen venía, cuándo y el
--        motivo), o null;
--      · cada cambio lleva «solo_origen». El informe los sigue entregando todos
--        (el rastro entero), pero la pantalla y el PDF los enseñan en la marca
--        («origen corregido»), no como «corregido después»: no cambian la hora.
--
-- Solo lo llaman informe_registro_jornada e informe_por_enlace (0705), que no
-- cambian. No está en el camino del pedido.
--
-- cambia: public._informe_registro_jornada · prueba: supabase/staging/sql/20261029_l1a_cerrar_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261029T0733_l1a_informe_origen.down.sql

create or replace function public._solo_cambia_origen(p_antes jsonb, p_despues jsonb)
returns boolean language sql immutable set search_path = public as $$
  select p_antes is not null and p_despues is not null
     and (p_antes ->> 'source') is distinct from (p_despues ->> 'source')
     and (p_antes - 'source') = (p_despues - 'source')
$$;
revoke all on function public._solo_cambia_origen(jsonb, jsonb) from public, anon, authenticated;

select public._respaldar_funcion('public._informe_registro_jornada(uuid,date,date,boolean,boolean)', '20261029T0733_l1a_informe_origen');

create or replace function public._informe_registro_jornada(p_employee_id uuid, p_desde date, p_hasta date, p_con_dni boolean, p_motivos_baja boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e public.employees; v_acct public.accounts; v_local text;
  v_ini timestamptz := (p_desde::timestamp at time zone 'Europe/Madrid');
  v_fin timestamptz := ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid') + interval '16 hours';
begin
  select * into e from public.employees where id = p_employee_id;
  if e.id is null then raise exception 'PERSONA_NO_EXISTE' using errcode = '22023'; end if;
  select * into v_acct from public.accounts where id = e.account_id;
  select name into v_local from public.locations where id = e.location_id;
  return jsonb_build_object(
    'generado_at', now(),
    'periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta),
    'empresa', jsonb_build_object('nombre', coalesce(nullif(v_acct.legal_name, ''), v_acct.name), 'cif', v_acct.cif),
    'persona', jsonb_build_object(
      'id', e.id, 'nombre', e.name, 'dni', case when p_con_dni then e.dni end,
      'puesto', e.position, 'local', v_local, 'tipo_contrato', e.contract_type,
      'horas_semana', coalesce(e.contracted_hours_week, e.weekly_hours), 'alta', e.start_date),
    'marcas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ce.id, 'tipo', ce.type, 'hora', coalesce(ce.real_datetime, ce.datetime),
               'declarada', ce.declared_at, 'llegada', ce.created_at, 'origen', ce.source,
               'local', l.name, 'distancia_m', ce.distance_m, 'dentro_del_radio', ce.within_radius,
               'anulada', coalesce(ce.voided, false),
               'origen_corregido', oc.dato)
             order by coalesce(ce.real_datetime, ce.datetime), ce.id)
        from public.clock_entries ce
        left join public.locations l on l.id = ce.location_id_at_clock
        left join lateral (
          -- La última vez que se corrigió SOLO el origen (p. ej. la 0732:
          -- «kiosko» que era el móvil). No es una corrección de la hora.
          select jsonb_build_object('antes', a.before ->> 'source', 'cuando', a.created_at, 'motivo', a.reason) dato
            from public.clock_entry_audit a
           where a.clock_entry_id = ce.id and a.action = 'edit'
             and public._solo_cambia_origen(a.before, a.after)
           order by a.created_at desc, a.id desc limit 1) oc on true
       where ce.employee_id = e.id
         and coalesce(ce.real_datetime, ce.datetime) >= v_ini
         and coalesce(ce.real_datetime, ce.datetime) < v_fin), '[]'::jsonb),
    'cambios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'marca', a.clock_entry_id, 'accion', a.action, 'cuando', a.created_at,
               'quien', coalesce(nullif(up.display_name, ''), nullif(a.actor_label, ''), case when a.actor_user_id is null then 'el sistema' end),
               'papel', up.role,
               'es_la_persona', (up.employee_id is not null and up.employee_id = e.id),
               'motivo', a.reason, 'antes', a.before, 'despues', a.after,
               'solo_origen', (a.action = 'edit' and public._solo_cambia_origen(a.before, a.after)),
               'conformidad', a.conformidad, 'conformidad_at', a.conformidad_at, 'conformidad_nota', a.conformidad_nota,
               'peticion', case when r.id is null then null else jsonb_build_object(
                  'pedida_at', r.created_at, 'motivo', r.reason, 'tipo', r.kind) end)
             order by a.created_at, a.id)
        from public.clock_entry_audit a
        left join lateral (
          select u.display_name, u.role, u.employee_id from public.user_profiles u
           where u.user_id = a.actor_user_id and u.account_id = e.account_id
           order by u.active desc limit 1) up on true
        left join public.clock_correction_request r on r.id = a.peticion_id
       where a.employee_id = e.id
         and a.action in ('create_manual', 'edit', 'void', 'restore')
         and a.clock_entry_id in (
           select ce.id from public.clock_entries ce
            where ce.employee_id = e.id
              and coalesce(ce.real_datetime, ce.datetime) >= v_ini
              and coalesce(ce.real_datetime, ce.datetime) < v_fin)), '[]'::jsonb),
    'firmas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'mes', f.mes, 'firmado_at', f.firmado_at, 'invalidada_at', f.invalidada_at,
               'invalidada_motivo', f.invalidada_motivo,
               'vigente', f.invalidada_at is null
                          and f.huella = public._huella_registro_mes(e.id, f.mes))
             order by f.mes, f.firmado_at)
        from public.registro_jornada_firma f
       where f.employee_id = e.id
         and f.mes between date_trunc('month', p_desde)::date and p_hasta), '[]'::jsonb),
    'ausencias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'desde', v.start_date, 'hasta', v.end_date,
               'tipo', case when v.type = 'baja_medica' and not p_motivos_baja then 'ausente' else v.type end)
             order by v.start_date)
        from public.vacations v
       where v.employee_id = e.id and v.status = 'aprobada'
         and v.start_date <= p_hasta and v.end_date >= p_desde), '[]'::jsonb),
    'festivos', coalesce((
      select jsonb_agg(jsonb_build_object('dia', h.holiday_date, 'nombre', h.name) order by h.holiday_date)
        from public.holiday_calendar h
       where (h.account_id is null or h.account_id = e.account_id)
         and h.holiday_date between p_desde and p_hasta), '[]'::jsonb)
  );
end $$;

revoke all on function public._informe_registro_jornada(uuid, date, date, boolean, boolean) from public, anon, authenticated;
