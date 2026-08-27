-- 20260827T1200_ingesta_silencio_watchdog.sql
-- APLICADA en produccion el 27-08-2026.
--
-- VIGIA DE SILENCIO DE INGESTA. Todos los vigias miraban lo que entra; ninguno
-- miraba que NO entre. Si la ingesta se para en pleno servicio, hoy nadie se
-- entera hasta el dia siguiente.
--
-- ── UMBRALES, MEDIDOS ────────────────────────────────────────────────────
-- 504 franjas de 30 min en horario de servicio (12-23 h Madrid), 21 dias:
--
--   franjas vacias en TODO el horario ....  83 de 504  (16,5 %)
--   franjas vacias en PUNTA (20-22:59) ...   1 de ~126
--
-- Por eso hay dos regimenes:
--   punta   20:00-23:59  ->  30 min sin NADA  ->  CRITICO
--   resto   12:00-19:59  ->  60 min sin NADA  ->  ALTO
--
-- Distribucion por hora de Madrid (21 dias): 13-15 h comida (189/209/164),
-- 16-19 h valle (70/74/67/110), 20-23 h cena (255/336/288/146), 00 h CERO.
-- La ventana 12-23 sale de ahi; no se extiende a las 00 h porque entonces
-- avisaria cada noche al cerrar.
--
-- ── POR QUE NO SE VIGILA CADA FUENTE ─────────────────────────────────────
-- Se pidio distinguir "un canal callado" de "todo callado". Medido sobre 336
-- franjas de 14 dias:
--
--   solo HubRise muda 60 min ... 121 franjas (36 %)   <- ruido puro
--   solo Last muda 60 min ......   9 franjas (2,7 %)
--   las dos mudas ..............  28 franjas (8 %)
--
-- HubRise mueve 88 pedidos en 7 dias: una hora sin pedidos suyos es lo normal,
-- no una averia. Avisar por fuente daria una alarma falsa cada tres horas.
--
-- Asi que la fuente solo se vigila cuando es DOMINANTE (>=60 % de los pedidos
-- de 7 dias). Hoy es lastapp; si manana la mayoria entra por HubRise, el vigia
-- cambia de sujeto solo, sin tocar codigo.
--
-- ── LIMITACION, ESCRITA A PROPOSITO ──────────────────────────────────────
-- Un corte en los ultimos 30 minutos del servicio (23:30-23:59) no se detecta
-- esa noche: el umbral se cumpliria ya fuera de ventana. Cubre 20:00-23:29,
-- que es donde esta el 90 % del dinero, y todo el servicio de comida.
--
-- ── DEBOUNCE ────────────────────────────────────────────────────────────
-- Via _queue_system_alert con ventana de 2 h: mas insistente que un producto
-- sin catalogar (20 h) y que un KDS mudo (4 h), pero no cada 10 minutos. La
-- severidad va en la clave, asi que pasar de ALTO a CRITICO rompe el silencio.
--
-- ── NOTA DE ZONA HORARIA ────────────────────────────────────────────────
-- sale.sold_at esta en UTC. Todo el razonamiento de horas de servicio va en
-- 'Europe/Madrid'. Confundirlo cuesta dos horas de diagnostico equivocado:
-- el "corte de las 21:39" del 26/08 eran las 23:39 de Madrid, es decir los
-- ultimos 20 minutos del servicio, no dos horas de cena perdidas.
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
      CONTINUE;
    END IF;

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

-- Cada 10 min (jobid 53). Fuera de 12-23 h Madrid la funcion sale con return 0.
SELECT cron.schedule('ingesta-silencio-watchdog', '*/10 * * * *',
                     'select public.ingesta_silencio_watchdog();');

NOTIFY pgrst, 'reload schema';
