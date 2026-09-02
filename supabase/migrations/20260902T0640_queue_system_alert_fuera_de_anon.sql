-- 20260902T0640_queue_system_alert_fuera_de_anon.sql
-- ============================================================================
-- `_queue_system_alert` ERA EJECUTABLE CON LA CLAVE ANONIMA.
--
-- Apareció montando el vigía de despliegue fallido: al buscar por dónde meter
-- un aviso desde GitHub Actions, la respuesta cómoda era «con la clave anon
-- vale». Que valiera es el fallo.
--
-- QUÉ PERMITÍA: encolar cualquier alerta de sistema —asunto y cuerpo libres—
-- con la clave pública que viaja en el bundle del front. El drenador corre cada
-- minuto, así que iba directo al buzón de operaciones. No es una fuga de datos:
-- es la capacidad de llenar de ruido el único canal por el que gritan los siete
-- vigías. Y hoy hemos visto lo que cuesta un canal con ruido — cinco correos de
-- despliegue fallido en un buzón con 96 diarios de cierres de marca, ninguno
-- leído.
--
-- POR QUÉ NO BASTA `revoke ... from anon`, que era la orden literal:
-- el ACL de la función era
--
--   {=X/postgres, postgres=X/postgres, anon=X/postgres,
--    authenticated=X/postgres, service_role=X/postgres}
--
-- y ese `=X/postgres` de delante, sin rol, es PUBLIC. Quitarle el permiso a
-- `anon` por nombre y dejar el de PUBLIC habría dejado a anon entrando igual
-- —hereda de PUBLIC— con una migración aplicada y cara de arreglado. Se
-- revocan los dos. Es la misma lección de método del 29/08: el dato bueno lo
-- da `has_function_privilege`, que sí tiene en cuenta lo concedido a PUBLIC.
--
-- QUÉ NO SE ROMPE
-- El único llamador es `availability-watchdog`, que construye su cliente con
-- SERVICE_ROLE_KEY (index.ts:73). Los demás vigías la llaman desde dentro de la
-- base, en funciones SECURITY DEFINER propiedad de postgres o desde pg_cron:
-- ahí el permiso de anon no interviene. Verificado que ningún fichero del front
-- la nombra.
--
-- LO QUE ESTA MIGRACIÓN NO CIERRA, Y SE DICE:
-- `authenticated` conserva su permiso explícito. Con una sesión de cualquier
-- cuenta se puede seguir encolando alertas. Es mucho menos grave que anon —hace
-- falta una cuenta— pero no es cero, y no hay ningún llamador legítimo que lo
-- necesite. Se deja fuera a propósito porque el encargo decía «abierto a anon»
-- y tocar permisos toca pantallas: es una línea, y la decide Julio.
-- ============================================================================

revoke all on function public._queue_system_alert(text, text, text, text, interval) from public;
revoke all on function public._queue_system_alert(text, text, text, text, interval) from anon;
grant execute on function public._queue_system_alert(text, text, text, text, interval) to service_role;

-- ── GUARDA ─────────────────────────────────────────────────────────────────
do $ver$
begin
  -- Cerrado para anon. Se pregunta por privilegio efectivo, no por el texto del
  -- ACL: un `like '%anon%'` sobre proacl es como se firma un cierre que no está.
  if has_function_privilege('anon',
       'public._queue_system_alert(text, text, text, text, interval)', 'EXECUTE') then
    raise exception '_queue_system_alert sigue siendo ejecutable por anon';
  end if;

  -- Y abierto para quien tiene que poder: comprobar solo el cierre deja el
  -- canal de alarma roto y nadie se entera hasta que calla un vigía.
  if not has_function_privilege('service_role',
       'public._queue_system_alert(text, text, text, text, interval)', 'EXECUTE') then
    raise exception 'service_role ha perdido _queue_system_alert: el vigia de disponibilidad se queda sin poder avisar';
  end if;

  -- El drenador sigue existiendo: sin él la cola se llena y no sale nada.
  if to_regprocedure('public.system_alert_queue_drain()') is null then
    raise exception 'system_alert_queue_drain ha desaparecido';
  end if;

  raise notice 'VERIFICACION OK: _queue_system_alert fuera de anon y de PUBLIC, service_role intacto';
end
$ver$;
