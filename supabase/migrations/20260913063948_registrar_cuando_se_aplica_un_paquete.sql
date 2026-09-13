-- PIEZA 1 · Registrar CUÁNDO SE APLICA un paquete, no cuándo arranca la app.
--
-- POR QUÉ VA PRIMERO. Hoy `kds_device.app_version_at` se pone a `now()` en cada
-- arranque, incondicionalmente (`report_device_app_version`), y `reportAppVersion`
-- se llama una sola vez al arrancar. O sea: la columna marca EL ARRANQUE. Una
-- recarga por OTA y un reinicio a mano dejan la misma fila, así que hoy no se
-- puede demostrar que una tablet no se recargó — ni saber cuál se quedó atrás el
-- día que falle. Sin esto, nada de lo demás se puede verificar.
--
-- LO QUE SE AÑADE, y la semántica importa:
--   · `bundle_applied`    — el número de paquete que corre AHORA en esa tablet.
--   · `bundle_applied_at` — cuándo EMPEZÓ a correr ese paquete en esa tablet.
--
-- `bundle_applied_at` se toca SOLO cuando el número cambia. Un reinicio con el
-- mismo paquete no lo mueve: si lo moviera volveríamos a tener `app_version_at`
-- con otro nombre, que es el agujero que esto viene a tapar.
--
-- POR QUÉ SE REPORTA AL ARRANCAR Y NO AL APLICAR. Aplicar un paquete es
-- `set()` + recarga: destruye el contexto JS. Escribir ANTES de `set()` sería
-- registrar la INTENCIÓN, y si el paquete nuevo no arranca, Capgo hace rollback
-- al anterior y la base se quedaría diciendo que corre uno que no corre. Se
-- reporta cuando el paquete nuevo YA está vivo y ha sido capaz de hablar: eso
-- es lo único que demuestra que se aplicó.
--
-- POR QUÉ UNA FUNCIÓN NUEVA Y NO UN PARÁMETRO MÁS (regla 2). Añadir
-- `p_bundle_id` a `report_device_app_version` obliga a DROP + CREATE, y las
-- TRES tablets vivas de hoy (Pase, Cocina y camichi4, las tres en el paquete
-- 285) llaman a la firma de 3 argumentos. Dropearla las dejaría sin reportar
-- nada hasta que recibieran el paquete nuevo — una regresión silenciosa en la
-- telemetría, justo en el cambio que existe para tener telemetría. La vieja se
-- queda intacta y esta se añade al lado.

alter table public.kds_device
  add column if not exists bundle_applied    integer,
  add column if not exists bundle_applied_at timestamptz;

comment on column public.kds_device.bundle_applied is
  'Número del paquete OTA que corre AHORA en este dispositivo. Lo escribe report_device_bundle_applied al arrancar el paquete, no al pedirlo.';
comment on column public.kds_device.bundle_applied_at is
  'Cuándo EMPEZÓ a correr ese paquete aquí. Solo se mueve cuando bundle_applied cambia: un reinicio con el mismo paquete no lo toca.';

create or replace function public.report_device_bundle_applied(
  p_device_token text,
  p_bundle_id    integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device  kds_device;
  v_antes   integer;
  v_cambio  boolean;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'token_no_valido');
  end if;
  if p_bundle_id is null or p_bundle_id < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'paquete_no_valido');
  end if;

  select bundle_applied into v_antes from kds_device where id = v_device.id;
  v_cambio := (v_antes is distinct from p_bundle_id);

  if v_cambio then
    update kds_device
       set bundle_applied    = p_bundle_id,
           bundle_applied_at = now(),
           updated_at        = now()
     where id = v_device.id;
  end if;

  -- Devuelve QUÉ ha pasado, no un booleano (regla 8): quien llama —y quien lea
  -- el ensayo— distingue «ha cambiado de paquete» de «sigue en el mismo», que
  -- son cosas distintas y hasta hoy se veían igual desde fuera.
  return jsonb_build_object(
    'ok',               true,
    'cambio',           v_cambio,
    'bundle_anterior',  v_antes,
    'bundle_aplicado',  p_bundle_id,
    'aplicado_en',      (select bundle_applied_at from kds_device where id = v_device.id)
  );
end;
$$;

comment on function public.report_device_bundle_applied(text, integer) is
  'La tablet declara qué paquete OTA está corriendo. Sella bundle_applied_at solo cuando el número cambia.';

revoke all on function public.report_device_bundle_applied(text, integer) from public;
grant execute on function public.report_device_bundle_applied(text, integer) to anon, authenticated;
