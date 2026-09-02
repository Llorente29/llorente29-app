-- 20260902T0650_queue_system_alert_fuera_de_authenticated.sql
--
-- Segunda pasada de 20260902T0640, y la que faltaba. Aquella cerró `anon` y
-- PUBLIC y dejó dicho que `authenticated` seguía dentro. Decisión de Julio:
-- también fuera. Encolar alertas de sistema no es algo que deba poder hacer un
-- empleado con su usuario, y no hay ningún llamador con sesión que lo necesite:
-- el único es `availability-watchdog`, que construye su cliente con
-- SERVICE_ROLE_KEY. Ningún fichero del front la nombra.
--
-- Mismo método que la anterior, y por el mismo motivo: se comprueba con
-- `has_function_privilege`, no con el texto del ACL. Un `like '%authenticated%'`
-- sobre proacl es como se firma un cierre que no está.

revoke all on function public._queue_system_alert(text, text, text, text, interval) from authenticated;
grant execute on function public._queue_system_alert(text, text, text, text, interval) to service_role;

do $ver$
begin
  if has_function_privilege('authenticated',
       'public._queue_system_alert(text, text, text, text, interval)', 'EXECUTE') then
    raise exception '_queue_system_alert sigue siendo ejecutable por authenticated';
  end if;

  -- Y que no se ha reabierto por detrás lo que cerró la migración anterior.
  if has_function_privilege('anon',
       'public._queue_system_alert(text, text, text, text, interval)', 'EXECUTE') then
    raise exception '_queue_system_alert ha vuelto a quedar abierta a anon';
  end if;

  if not has_function_privilege('service_role',
       'public._queue_system_alert(text, text, text, text, interval)', 'EXECUTE') then
    raise exception 'service_role ha perdido _queue_system_alert: el vigia de disponibilidad se queda sin poder avisar';
  end if;

  if to_regprocedure('public.system_alert_queue_drain()') is null then
    raise exception 'system_alert_queue_drain ha desaparecido';
  end if;

  raise notice 'VERIFICACION OK: _queue_system_alert solo alcanzable por su propietario y service_role';
end
$ver$;
