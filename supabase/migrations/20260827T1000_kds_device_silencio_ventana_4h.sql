-- 20260827T1000_kds_device_silencio_ventana_4h.sql
-- APLICADA en produccion el 27-08-2026.
--
-- Un KDS callado es urgente: si cocina no ve pedidos, se pierden ventas en el
-- momento. La ventana por defecto del encolador (20 h, 20260827T0700) es
-- demasiado laxa para esto. Se baja a 4 h: insiste sin volver a ser ruido.
--
-- La clave sigue siendo por dispositivo (kds_silencio_<device_id>), asi que una
-- tablet que se calle ahora nunca queda tapada por el silencio de otra.
--
-- MISMA FIRMA. Solo cambia el 5o argumento de la llamada al encolador. Anadir
-- un parametro aqui crearia una SOBRECARGA y dejaria ambigua la llamada del
-- cron (kds_device_silence_check(10)) — que es exactamente el error que se
-- cometio ayer con _queue_system_alert y quedo escrito en la 20260827T0720.
CREATE OR REPLACE FUNCTION public.kds_device_silence_check(p_minutos integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hora  int;
  v_d     record;
  v_n     int := 0;
  v_min   int;
begin
  -- Solo en horario de servicio (11:00–01:00 hora de Madrid).
  v_hora := extract(hour from (now() at time zone 'Europe/Madrid'));
  if not (v_hora >= 11 or v_hora < 1) then
    return 0;
  end if;

  for v_d in
    select d.id, d.label, coalesce(l.name, 'sin local') as local,
           round(extract(epoch from (now() - d.last_seen_at))/60)::int as min_silencio,
           d.app_version
    from kds_device d
    left join locations l on l.id = d.location_id
    where d.is_active
      and d.last_seen_at is not null
      and d.last_seen_at < now() - make_interval(mins => greatest(p_minutos, 3))
  loop
    v_n := v_n + 1;
    v_min := v_d.min_silencio;

    raise warning 'kds_device_silence_check: % (%) lleva % min sin latir', v_d.label, v_d.local, v_min;

    perform public._queue_system_alert(
      'kds_device_silencio',
      'Tablet sin senal: ' || v_d.label || ' (' || v_d.local || ')',
      'La tablet "' || v_d.label || '" del local ' || v_d.local ||
      ' lleva ' || v_min || ' minutos sin dar senal de vida, en horario de servicio. ' ||
      'Version: ' || coalesce(v_d.app_version, 'desconocida') || '. ' ||
      'Si la pantalla pide vincular, apagar y encender la tablet suele bastar. ' ||
      'Mientras tanto los pedidos SIGUEN entrando en Folvy y se pueden ver desde cualquier movil u ordenador en Pedidos.',
      'kds_silencio_' || v_d.id::text,
      interval '4 hours'
    );
  end loop;

  return v_n;
end;
$function$;

NOTIFY pgrst, 'reload schema';
