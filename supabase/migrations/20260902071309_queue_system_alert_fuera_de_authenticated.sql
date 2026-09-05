revoke all on function public._queue_system_alert(text, text, text, text, interval) from authenticated;
grant execute on function public._queue_system_alert(text, text, text, text, interval) to service_role;

do $ver$
begin
  if has_function_privilege('authenticated',
       'public._queue_system_alert(text, text, text, text, interval)', 'EXECUTE') then
    raise exception '_queue_system_alert sigue siendo ejecutable por authenticated';
  end if;

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
