-- 0912 — Vigía de tablet en silencio (11/08/2026, tras el incidente de
-- Carabanchel: la tablet murió a las ~23:42 y Julio se enteró por una foto
-- de WhatsApp; el sistema estuvo callado).
--
-- QUÉ VIGILA: kds_device activos que dejan de latir durante el horario de
-- servicio. El latido lo escribe kds_heartbeat cada 60 s (arreglo de raíz
-- #48), así que 10 minutos de silencio significan que la app está muerta,
-- no que haya poco trabajo.
--
-- POR QUÉ CON VENTANA HORARIA: de madrugada las tablets se apagan y eso es
-- normal. Un vigía que avise cada noche es ruido, y el ruido se ignora —
-- que es como no tener vigía. Solo mira entre las 11:00 y las 01:00 de
-- Madrid, calculado con timezone explícita (cron corre en GMT, sin DST).
--
-- ANTIRRUIDO: 60 min por dispositivo vía _queue_system_alert (0910), que ya
-- reintenta y no pierde el aviso si falla el envío.

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='_queue_system_alert') then
    raise exception '0912: falta _queue_system_alert (0910) — parar';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='kds_heartbeat') then
    raise exception '0912: falta kds_heartbeat (0900) — el latido es la señal que se vigila, parar';
  end if;
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise exception '0912: falta pg_cron — parar';
  end if;
end $$;

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
      'kds_silencio_' || v_d.id::text
    );
  end loop;

  return v_n;
end;
$function$;

revoke all on function public.kds_device_silence_check(integer) from public, anon, authenticated;
grant execute on function public.kds_device_silence_check(integer) to service_role;

select cron.schedule(
  'kds-device-silence-check',
  '*/5 * * * *',
  $$select public.kds_device_silence_check(10)$$
);