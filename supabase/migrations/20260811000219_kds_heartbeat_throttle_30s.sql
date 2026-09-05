do $mig$
declare
  r record;
  v_nueva text;
  v_n integer := 0;
begin
  for r in select firma, def_original from public._backup_kds_fn_20260811 loop
    v_nueva := replace(
      r.def_original,
      'update kds_device set last_seen_at = now() where id = v_device.id;',
      'update kds_device set last_seen_at = now() where id = v_device.id and (last_seen_at is null or last_seen_at < now() - interval ''30 seconds'');'
    );
    if v_nueva = r.def_original then
      raise exception 'kds_heartbeat_throttle: no se pudo sustituir la linea en %, se aborta sin tocar nada', r.firma;
    end if;
    execute v_nueva;
    v_n := v_n + 1;
  end loop;
  raise notice 'kds_heartbeat_throttle: % funciones actualizadas', v_n;
end;
$mig$;