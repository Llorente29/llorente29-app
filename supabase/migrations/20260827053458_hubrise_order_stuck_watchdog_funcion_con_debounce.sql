-- El vigia hubrise-order-stuck vivia como SQL en linea dentro del cron (jobid
-- 36, */2), y llamaba DIRECTO a la edge function system-alert. Por eso:
--
--   a) no pasaba por system_alert_queue y la ventana de silencio del
--      encolador (20260827T0700) no le aplicaba;
--   b) no tenia debounce de ninguna clase: */2 sobre una ventana de 3 horas
--      son hasta 90 correos por pedido;
--   c) no estaba versionado ni se podia probar.
--
-- Ahora es una funcion, encola en system_alert_queue y avisa POR PEDIDO.
--
-- ── SOBRE EL CRITERIO: NO se cambia, y NO debe mirar accepted_at ─────────
-- accepted_at NO sirve para saber si un pedido esta aceptado. El trigger
-- tg_sale_seal_kpi_hitos (20260725T0000) lo rellena en el INSERT de TODAS las
-- ventas:
--
--   if tg_op = 'INSERT' then
--     if new.accepted_at is null then new.accepted_at := now(); end if;
--
-- Es un sello de KPI de cocina — "arranca el reloj" —, no una prueba de
-- aceptacion. Por eso accepted_at - sold_at sale ~0,02 min en TODOS los
-- pedidos: mide el retardo del webhook, no la velocidad de la autoaceptacion.
-- Un vigia que mirase accepted_at estaria ciego para siempre.
--
-- El criterio bueno es el que ya habia: status='open' y order_status en
-- ('new','received'). Se le anade cancelled_at is null por higiene.
--
-- ── DEBOUNCE: por pedido, no por tanda ───────────────────────────────────
-- La clave lleva el external_ref, asi que cada pedido atascado avisa por su
-- cuenta y uno nuevo nunca queda tapado por el silencio de otro. Ventana 30
-- min: Uber da el pedido por perdido a los ~10, asi que el primer aviso (a
-- los 3 min) es el que cuenta y el resto son recordatorios espaciados. De
-- hasta 90 correos por pedido a 6 como mucho.
CREATE OR REPLACE FUNCTION public.hubrise_order_stuck_watchdog(
  p_min_minutos integer DEFAULT 3,
  p_max_horas integer DEFAULT 3,
  p_debounce_window interval DEFAULT interval '30 minutes')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_n integer := 0; v_min integer;
BEGIN
  FOR r IN
    SELECT s.external_ref, s.platform_order_code, s.external_brand_text,
           s.total, s.created_at
      FROM public.sale s
     WHERE s.source = 'hubrise'
       AND s.status = 'open'
       AND coalesce(s.order_status, 'new') IN ('new','received')
       AND s.cancelled_at IS NULL
       AND s.created_at < now() - make_interval(mins => greatest(coalesce(p_min_minutos,3),1))
       AND s.created_at > now() - make_interval(hours => greatest(coalesce(p_max_horas,3),1))
     ORDER BY s.created_at
     LIMIT 20
  LOOP
    v_min := round(extract(epoch from (now() - r.created_at))/60);

    PERFORM public._queue_system_alert(
      'hubrise-order-stuck',
      'URGENTE: pedido HubRise SIN ACEPTAR hace ' || v_min::text || ' min ('
        || coalesce(r.external_brand_text,'sin marca') || ')',
      'Uber marca el pedido PERDIDO a los ~10 min y el pago queda en 0 EUR.' || chr(10)
        || 'Aceptar YA en Folvy o en el panel de la plataforma.' || chr(10) || chr(10)
        || '  codigo : ' || coalesce(r.platform_order_code,'(sin codigo)') || chr(10)
        || '  ref    : ' || coalesce(r.external_ref,'(sin ref)') || chr(10)
        || '  marca  : ' || coalesce(r.external_brand_text,'(sin marca)') || chr(10)
        || '  importe: ' || coalesce(r.total::text,'?') || ' EUR' || chr(10)
        || '  entro hace ' || v_min::text || ' min',
      -- Una clave POR PEDIDO: un pedido nuevo nunca queda tapado por el
      -- silencio de otro.
      'hubrise_stuck_' || coalesce(r.external_ref, r.created_at::text),
      p_debounce_window
    );
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.hubrise_order_stuck_watchdog(integer, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hubrise_order_stuck_watchdog(integer, integer, interval) TO service_role;

NOTIFY pgrst, 'reload schema';