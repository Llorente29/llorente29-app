-- 20260730T1630_push_location_opening_hours.sql
-- ============================================================================
-- CAP. D — Editar horarios: empuje del horario GENERAL del local (business_hours,
-- brand_id IS NULL) a HubRise (opening_hours). NO construye editor nuevo: lo
-- llama el frontend justo DESPUÉS de un replaceHours(accountId, locationId,
-- null, slots) con éxito, desde BusinessHoursEditor (que ya existe).
--
-- SCHEMA HubRise confirmado por Julio (referencia: HubRise Locations API):
--   { "opening_hours": {
--       "monday":    [{ "from":"12:00", "to":"16:00" }, ...],
--       ...
--       "sunday":    []
--   } }
-- Claves = día en inglés minúscula. Cada día = array de tramos {from,to}
-- "HH:mm" 24h. [] = cerrado. Tramo que cruza medianoche: to < from (ej. "01:00").
--
-- CAVEAT 1 (Julio): el PATCH reemplaza el objeto ENTERO -> se construyen
-- SIEMPRE los 7 días completos desde business_hours (nunca un parche parcial),
-- leyendo el estado actual en BBDD (fuente única, sin drift con el cliente).
--
-- CAVEAT 2 (Julio): el opening_hours del API core es SEMANAL, sin fechas
-- especiales -> las excepciones/festivos de Folvy (business_hours_exception,
-- HoursExceptions.tsx) NO se empujan aquí (no hay campo para eso en este
-- endpoint). Para cerrar un día concreto, la vía honesta es Cap. C (Cerrar
-- local con resume_at) — no prometer en la UI lo que este API no cumple.
--
-- Solo el horario GENERAL del local (brand_id NULL) tiene sentido aquí:
-- HubRise no tiene "horario por marca" a nivel de location — eso son las
-- "specific hours" del bridge (manuales, fuera de este encargo).
--
-- DDL sin BEGIN/COMMIT. Crea la función pero no la ejecuta -> segura en el
-- SQL Editor de una vez. Aplicada: —
-- ============================================================================

create or replace function public.push_location_opening_hours(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_ext_loc    text;
  v_secret     text;
  v_log_id     uuid;
  v_hours      jsonb;
  v_patch      jsonb;
begin
  select account_id into v_account_id from locations where id = p_location_id;
  if v_account_id is null then
    raise exception 'push_location_opening_hours: local % no encontrado', p_location_id;
  end if;

  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'push_location_opening_hours: sin acceso a la cuenta %', v_account_id;
  end if;

  -- 7 días completos (nombre HubRise), SIEMPRE presentes aunque estén vacíos.
  -- weekday Folvy: 0=domingo..6=sabado (business_hours.weekday).
  with days(weekday, day_name) as (
    values (1, 'monday'), (2, 'tuesday'), (3, 'wednesday'), (4, 'thursday'),
           (5, 'friday'), (6, 'saturday'), (0, 'sunday')
  ),
  slots as (
    select bh.weekday,
           jsonb_agg(
             jsonb_build_object('from', to_char(bh.open_time, 'HH24:MI'), 'to', to_char(bh.close_time, 'HH24:MI'))
             order by bh.open_time
           ) as tramos
    from business_hours bh
    where bh.location_id = p_location_id and bh.brand_id is null
    group by bh.weekday
  )
  select jsonb_object_agg(d.day_name, coalesce(s.tramos, '[]'::jsonb))
    into v_hours
  from days d
  left join slots s on s.weekday = d.weekday;

  select elm.external_location_id into v_ext_loc
  from external_location_map elm
  where elm.account_id = v_account_id and elm.source = 'hubrise' and elm.is_active
    and elm.location_id = p_location_id
  limit 1;

  v_patch := jsonb_build_object('opening_hours', v_hours);

  insert into location_status_log
    (account_id, location_id, external_location_id, kind, patch_body, surface, set_by)
  values
    (v_account_id, p_location_id, v_ext_loc, 'opening_hours', v_patch, 'web', auth.uid())
  returning id into v_log_id;

  if v_ext_loc is null then
    update location_status_log
    set ok = true, error = 'Local sin conexión HubRise: horario guardado solo en Folvy', resolved_at = now()
    where id = v_log_id;
    return jsonb_build_object('location_id', p_location_id, 'connected', false, 'log_id', v_log_id);
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'location_status_dispatch_secret';

  if v_secret is null then
    update location_status_log
    set ok = false, error = 'secret location_status_dispatch_secret ausente en Vault', resolved_at = now()
    where id = v_log_id;
    raise warning 'push_location_opening_hours: secret location_status_dispatch_secret ausente en Vault, no se empuja a HubRise';
    return jsonb_build_object('location_id', p_location_id, 'connected', true, 'log_id', v_log_id, 'dispatched', false);
  end if;

  perform net.http_post(
    url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/hubrise-location-dispatch',
    headers := jsonb_build_object(
      'Content-Type',                       'application/json',
      'x-location-status-dispatch-secret',  v_secret
    ),
    body    := jsonb_build_object(
      'log_id',               v_log_id,
      'account_id',           v_account_id,
      'external_location_id', v_ext_loc,
      'patch_body',           v_patch
    )
  );

  return jsonb_build_object('location_id', p_location_id, 'connected', true, 'log_id', v_log_id, 'dispatched', true);
end;
$function$;
