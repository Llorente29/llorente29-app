-- Aplicada: SÍ (Julio, 11/08 ~11:45, por MCP). Verificado en vivo: ventana de
-- 2h activa, 3 tablets respondiendo. Aplicada en versión GENERATIVA
-- (sustitución quirúrgica sobre lo vivo, mismo criterio que 20260816T0901) —
-- drift cerrado el mismo día: extraído pg_get_functiondef() de
-- station_update_window en producción y verificado con nombre temporal
-- _tmp_check_suw2 que el CREATE OR REPLACE de más abajo es BYTE A BYTE
-- IDÉNTICO a lo vivo (a diferencia de la 0901, aquí sí coincide exacto — sin
-- caveat de CRLF). La única diferencia real es que la versión aplicada por
-- Julio no incluye el comentario "-- CORRECCIÓN (11/08)..." dentro del cuerpo
-- de la función (se reescribió más compacto) — cero diferencia de lógica,
-- confirmado con la comparación de prosrc.
--
-- CONFIRMACIÓN ADICIONAL (Julio, 11/08, con datos propios): mismo umbral,
-- mediana 1,04s / p95 2,75s / n=1.812 — coincide exacto con el RECON de
-- abajo. Dato que faltaba: de 2.730 trabajos, solo 15 (0,549%) tardaron más
-- de 2h en enviarse, y en ese caso el peor efecto es un reload que retrasa
-- segundos la impresión (el trabajo sigue en la cola, no se pierde). Umbral
-- de 2h confirmado seguro con datos reales, no solo con el percentil.
--
-- ENCARGO fix/limpieza-kds-viejo-y-prevencion (11/08 mediodía) · Tarea D —
-- la ventana de actualización no puede bloquearse para siempre.
--
-- RECON confirmado (definición viva de station_update_window): los `sent` SÍ
-- caducan (`sent_at > now() - interval '60 minutes'`) pero los `pending` NO
-- tienen ningún filtro de antigüedad — un solo print_job atascado (por lo que
-- sea: impresora apagada, red caída, el propio bug de la Tarea B) cierra la
-- ventana de actualización de esa tablet DE FORMA PERMANENTE. Es, casi con
-- certeza, la explicación del episodio del 31/07 (folvy_actualizacion_
-- tablets_diseno.md) en que las tablets no cogían los cambios C2/C3 sin que
-- se supiera por qué.
--
-- Ventana elegida — 2 horas, justificada con RECON (no a ojo):
--   select percentile_cont(0.5/0.95) within group (order by extract(epoch
--     from (sent_at - created_at))) from print_job where sent_at is not null
--     and created_at > now() - interval '14 days';
--   → mediana 1,04s · p95 2,75s · n=1.812 trabajos.
-- Un ciclo normal de impresión (tablets pidiendo claim_print_jobs cada ~3s)
-- tarda 1-3 SEGUNDOS, no horas. 2 horas da un margen de ~2.500x sobre el p95
-- real — de sobra para cubrir un corte de red o un atasco de papel que se
-- arregla en minutos (eso sigue contando como "servicio en curso" y no debe
-- bloquear la actualización) — y a la vez dejar fuera sin ambigüedad un
-- ticket de hace 3 días, que no es servicio en curso: es basura que no debe
-- secuestrar el mantenimiento de la flota. Mismo umbral que el Aviso 4 del
-- vigía (20260816T0902_db_health_watchdog.sql, print_job pending >2h) —
-- una sola definición de "esto ya está atascado" en todo el sistema.
--
-- Validado por MCP con nombre temporal _tmp_check_station_update_window
-- antes de escribir este fichero: compiló y corrió contra pg_stat_activity/
-- print_job/sale reales sin error, devolviendo el mismo resultado que la
-- versión vigente en el estado actual (sin print_job pending hoy — el
-- bloqueo de Carabanchel ya se resolvió esta mañana), y por separado se
-- probó la rama nueva con un print_job sintético de 3 días de antigüedad:
-- con la versión vieja bloqueaba la ventana, con esta ya no.

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='station_update_window') then
    raise exception 'station_update_window_pending_expira: falta station_update_window — RECON desactualizado, parar';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.station_update_window(p_device_token text, p_quiet_minutes integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device        kds_device;
  v_pending_jobs  integer := 0;
  v_active_orders integer := 0;
  v_last_sale_min integer;
  v_quiet         integer := greatest(0, coalesce(p_quiet_minutes, 20));
  v_reasons       text[] := '{}';
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    return jsonb_build_object('ok', false, 'safe', false, 'reasons', to_jsonb(array['token_no_valido']));
  end if;

  select count(*) into v_pending_jobs
    from print_job j
   where j.location_id = v_device.location_id
     and ((j.status = 'pending' and j.created_at > now() - interval '2 hours')
       or (j.status = 'sent' and j.sent_at > now() - interval '60 minutes'));

  select count(*) into v_active_orders
    from sale s
   where s.location_id = v_device.location_id
     and s.order_status is not null
     and s.order_status not in ('completed', 'cancelled')
     and s.created_at > now() - interval '12 hours';

  select floor(extract(epoch from (now() - max(s.created_at))) / 60)::int
    into v_last_sale_min
    from sale s
   where s.location_id = v_device.location_id
     and s.created_at > now() - interval '24 hours';

  if v_pending_jobs > 0 then
    v_reasons := array_append(v_reasons, 'trabajos_de_impresion_vivos');
  end if;
  if v_active_orders > 0 then
    v_reasons := array_append(v_reasons, 'pedidos_en_curso');
  end if;
  if v_last_sale_min is not null and v_last_sale_min < v_quiet then
    v_reasons := array_append(v_reasons, 'venta_reciente');
  end if;

  return jsonb_build_object(
    'ok',                 true,
    'safe',               (array_length(v_reasons, 1) is null),
    'reasons',            to_jsonb(v_reasons),
    'pending_jobs',       v_pending_jobs,
    'active_orders',      v_active_orders,
    'minutes_since_sale', v_last_sale_min,
    'quiet_minutes',      v_quiet
  );
end;
$function$;

notify pgrst, 'reload schema';
