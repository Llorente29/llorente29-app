-- Correccion de zona horaria y del texto del aviso.
--
-- sold_at esta en UTC. El corte del 26/08 fue a las 23:39 HORA DE MADRID
-- (21:39 UTC), no a las 21:39: en los ULTIMOS 20 MINUTOS del servicio. Eso
-- explica que nadie lo notara hasta la manana.
--
-- Distribucion real por hora de Madrid (21 dias): la cena es 20-23 h (255,
-- 336, 288, 146 pedidos) y a las 00 h hay CERO. La ventana 12-23 es correcta;
-- no se extiende a las 00 h porque entonces avisaria cada noche al cerrar.
--
-- LIMITACION QUE HAY QUE SABER: un corte en los ultimos 30 minutos del
-- servicio (23:30-23:59) no se detecta esa noche, porque el umbral se cumple
-- ya fuera de ventana. Cubre el 90 % del dinero (20:00-23:29) y todo el
-- servicio de comida. No se disimula: se deja escrito.
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
          || 'Ultimo pedido: ' || to_char(v_ultima at time zone 'Europe/Madrid', 'HH24:MI')
          || ' (hora de Madrid).' || chr(10)
          || 'Esto NO es que se venda poco: es que no llega nada. Mira si las tiendas '
          || 'siguen conectadas al POS en los paneles de Glovo y Uber, y si el POS sigue '
          || 'enviando.',
        'ingesta_silencio_' || a.account_id::text || '_' || v_sev || '_'
          || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
        p_debounce_window
      );
      v_n := v_n + 1;
      CONTINUE;  -- si no entra NADA, no tiene sentido avisar ademas por fuente
    END IF;

    -- ── 2) LA FUENTE DOMINANTE, MUDA ──────────────────────────────────────
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
          || 'Ultimo pedido suyo: ' || to_char(v_ultima_dom at time zone 'Europe/Madrid', 'HH24:MI')
          || ' (hora de Madrid).' || chr(10)
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

-- Cada 10 min. La propia funcion se calla fuera de horario de servicio, asi
-- que fuera de 12-23 h (Madrid) es una consulta y un return 0.
SELECT cron.schedule('ingesta-silencio-watchdog', '*/10 * * * *',
                     'select public.ingesta_silencio_watchdog();');

NOTIFY pgrst, 'reload schema';