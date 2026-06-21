-- ============================================================================
-- Cabecera de la Estación de Tablet: nombre del local del dispositivo por token.
-- Pequeña RPC dedicada para no tocar kds_board (crítica). La cabecera la llama
-- una vez al cargar para mostrar "¿dónde estoy?".
-- ============================================================================
create or replace function public.device_location_by_token(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_name   text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'device_location_by_token: token no válido';
  end if;

  select name into v_name from locations where id = v_device.location_id;

  return jsonb_build_object(
    'location_id',   v_device.location_id,
    'location_name', coalesce(v_name, 'Local'),
    'device_label',  v_device.label
  );
end;
$function$;
