-- VIGIA DE SILENCIO DE INGESTA
--
-- El 26/08 la entrada de pedidos se corto a las 21:30 (Last) / 21:39 (HubRise),
-- en los dos locales y en las tres plataformas, y nos enteramos a la manana
-- siguiente. Dos horas de cena a ciegas: 9 pedidos visibles en el panel de Uber
-- (290,48 EUR) que nunca llegaron a Folvy. No habia NADA que vigilara el
-- silencio: todos los vigias miran lo que entra, ninguno miraba que no entre.
--
-- ── UMBRALES, MEDIDOS, NO A OJO ──────────────────────────────────────────
-- 504 franjas de 30 min en horario de servicio (12-23 h) de los ultimos 21
-- dias en Foodint:
--
--   franjas vacias en TODO el horario ....  83 de 504  (16,5 %)
--   franjas vacias en PUNTA (20-22:59) ...   1 de ~126
--
-- Por eso hay dos regimenes. En punta, 30 minutos mudos es practicamente
-- imposible; fuera de punta hay huecos normales y hace falta el doble.
--
--   punta   20:00-23:59  ->  30 min sin NADA  ->  CRITICO
--   resto   12:00-19:59  ->  60 min sin NADA  ->  ALTO
--
-- ── POR QUE NO SE VIGILA CADA FUENTE POR SEPARADO ────────────────────────
-- Se pidio distinguir "un canal callado" de "todo callado". Medido sobre 336
-- franjas de 14 dias:
--
--   solo HubRise muda 60 min ... 121 franjas (36 %)   <- ruido puro
--   solo Last muda 60 min ......   9 franjas (2,7 %)
--   las dos mudas ..............  28 franjas (8 %)
--
-- HubRise mueve 88 pedidos en 7 dias: una hora sin pedidos suyos es lo normal,
-- no una averia. Avisar por fuente daria una alarma falsa cada tres horas y
-- volveriamos al problema que acabamos de cerrar.
--
-- Asi que la fuente solo se vigila cuando es DOMINANTE (>=60 % de los pedidos
-- de los ultimos 7 dias). Hoy eso es lastapp; si manana la mayoria entra por
-- HubRise, el vigia cambia de sujeto solo, sin tocar codigo.
--
-- ── DEBOUNCE ────────────────────────────────────────────────────────────
-- Via _queue_system_alert (20260827T0700) con ventana de 2 h: una caida de
-- ingesta merece insistir mas que un producto sin catalogar (20 h) y algo mas
-- que un KDS mudo (4 h), pero no cada 10 minutos. La severidad va en la clave,
-- asi que pasar de ALTO a CRITICO rompe el silencio.
CREATE OR REPLACE FUNCTION public.ingesta_silencio_watchdog(
  p_min_punta integer DEFAULT 30,
  p_min_valle integer DEFAULT 60,
  p_debounce_window interval DEFAULT interval '2 hours')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a record; v_n integer := 0;
  v_hora integer; v_umbral integer; v_sev text;
  v_ultima timestamptz; v_mudo integer;
  v_dominante text; v_pct numeric; v_ultima_dom timestamptz; v_mudo_dom integer;
BEGIN
  v_hora := extract(hour from (now() at time zone 'Europe/Madrid'));

  -- Fuera de horario de servicio no se avisa: a las 04:00 no entrar pedidos es
  -- lo correcto, no una averia.
  IF v_hora < 12 OR v_hora > 23 THEN
    RETURN 0;
  END IF;

  IF v_hora >= 20 THEN
    v_umbral := greatest(coalesce(p_min_punta,30), 5);
    v_sev := 'CRITICO';
  ELSE
    v_umbral := greatest(coalesce(p_min_valle,60), 5);
    v_sev := 'ALTO';
  END IF;

  FOR a IN
    -- Cuentas que han vendido algo en los ultimos 7 dias: una cuenta sin
    -- actividad no puede "callarse".
    SELECT DISTINCT s.account_id
      FROM public.sale s
     WHERE s.sold_at >= now() - interval '7 days'
  LOOP
    -- ── 1) TODO CALLADO ───────────────────────────────────────────────────
    SELECT max(s.sold_at) INTO v_ultima
      FROM public.sale s
     WHERE s.account_id = a.account_id
       AND s.sold_at >= now() - interval '12 hours';

    v_mudo := CASE WHEN v_ultima IS NULL THEN NULL
                   ELSE round(extract(epoch from (now() - v_ultima))/60) END;

    IF v_ultima IS NOT NULL AND v_mudo >= v_umbral THEN
      PERFORM public._queue_system_alert(
        'ingesta_silencio',
        v_sev || ': NO ENTRAN PEDIDOS desde hace ' || v_mudo::text || ' min',
        'Ninguna venta, de ninguna plataforma, desde hace ' || v_mudo::text || ' minutos, '
          || 'en pleno horario de servicio.' || chr(10) || chr(10)
          || 'Ultimo pedido: ' || to_char(v_ultima at time zone 'Europe/Madrid', 'HH24:MI') || '.' || chr(10)
          || 'Esto NO es que se venda poco: es que no llega nada. Mira si las tiendas '
          || 'siguen conectadas al POS en los paneles de Glovo y Uber, y si el POS '
          || 'sigue enviando.' || chr(10)
          || 'El 26/08 un corte asi costo 2 horas de cena y 9 pedidos (290,48 EUR).',
        'ingesta_silencio_' || a.account_id::text || '_' || v_sev || '_'
          || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
        p_debounce_window
      );
      v_n := v_n + 1;
      CONTINUE;  -- si no entra NADA, no tiene sentido avisar ademas por fuente
    END IF;

    -- ── 2) LA FUENTE DOMINANTE, MUDA ──────────────────────────────────────
    -- Solo la dominante: el silencio de una fuente minoritaria es normal.
    SELECT s.source,
           round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1)
      INTO v_dominante, v_pct
      FROM public.sale s
     WHERE s.account_id = a.account_id
       AND s.sold_at >= now() - interval '7 days'
     GROUP BY s.source
     ORDER BY count(*) DESC
     LIMIT 1;

    CONTINUE WHEN v_dominante IS NULL OR coalesce(v_pct,0) < 60;

    SELECT max(s.sold_at) INTO v_ultima_dom
      FROM public.sale s
     WHERE s.account_id = a.account_id
       AND s.source = v_dominante
       AND s.sold_at >= now() - interval '12 hours';

    v_mudo_dom := CASE WHEN v_ultima_dom IS NULL THEN NULL
                       ELSE round(extract(epoch from (now() - v_ultima_dom))/60) END;

    IF v_ultima_dom IS NOT NULL AND v_mudo_dom >= greatest(coalesce(p_min_valle,60), 5) THEN
      PERFORM public._queue_system_alert(
        'ingesta_silencio',
        'AVISO: ' || v_dominante || ' lleva ' || v_mudo_dom::text || ' min sin traer pedidos',
        v_dominante || ' aporta el ' || v_pct::text || ' % de los pedidos y lleva '
          || v_mudo_dom::text || ' minutos sin traer ninguno, mientras otras fuentes SI '
          || 'estan entrando.' || chr(10) || chr(10)
          || 'Ultimo pedido suyo: ' || to_char(v_ultima_dom at time zone 'Europe/Madrid', 'HH24:MI') || '.' || chr(10)
          || 'Suele ser la conexion de esa via, no la cocina.',
        'ingesta_fuente_' || a.account_id::text || '_' || v_dominante || '_'
          || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
        p_debounce_window
      );
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.ingesta_silencio_watchdog(integer, integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingesta_silencio_watchdog(integer, integer, interval) TO service_role;

NOTIFY pgrst, 'reload schema';