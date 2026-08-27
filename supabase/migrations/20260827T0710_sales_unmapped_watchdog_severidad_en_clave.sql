-- 20260827T0710_sales_unmapped_watchdog_severidad_en_clave.sql
-- APLICADA en produccion el 27-08-2026.
--
-- Con la ventana de silencio de _queue_system_alert (T0700) este vigia calla
-- 20 h. Pero si la cosa EMPEORA el mismo dia (de AVISO a ALTO, o de ALTO a
-- CRITICO) eso si hay que decirlo. La forma de romper el silencio sin tocar el
-- encolador es meter en la clave el dato que cambia: la severidad.
--
--   Antes:  venta_sin_casar_<cuenta>_20260827
--   Ahora:  venta_sin_casar_<cuenta>_CRITICO_20260827
--
-- Efecto: como mucho un aviso por cuenta, severidad y dia. Si pasa de AVISO a
-- CRITICO a las 11:00, suena; si sigue en CRITICO todo el dia, no vuelve a
-- sonar.
--
-- Verificado con tres pasadas seguidas del vigia: encolo 1, no 3.

CREATE OR REPLACE FUNCTION public.sales_unmapped_watchdog(
  p_days integer DEFAULT 30,
  p_min_catalogo integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a record; v_n integer := 0; v_prod integer; v_eur numeric; v_lin integer;
  v_casan integer; v_top text; v_top_eur numeric; v_sev text; fmt text; v_cat integer;
BEGIN
  FOR a IN SELECT DISTINCT s.account_id FROM public.sale s
            WHERE s.sold_at >= now() - make_interval(days => greatest(coalesce(p_days,30),1))
  LOOP
    SELECT count(*)::integer INTO v_cat
      FROM public.menu_item mi
     WHERE mi.account_id = a.account_id AND mi.archived_at IS NULL;
    CONTINUE WHEN coalesce(v_cat,0) < greatest(coalesce(p_min_catalogo,10), 1);

    SELECT count(*)::integer, coalesce(sum(u.euros),0), coalesce(sum(u.lineas),0)::integer,
           count(*) FILTER (WHERE u.diagnostico = 'casa_solo')::integer
      INTO v_prod, v_eur, v_lin, v_casan
      FROM public._sales_unmapped_products_raw(a.account_id, p_days) u;

    CONTINUE WHEN coalesce(v_prod,0) = 0;

    SELECT u.product_name, u.euros INTO v_top, v_top_eur
      FROM public._sales_unmapped_products_raw(a.account_id, p_days) u
     ORDER BY u.euros DESC LIMIT 1;

    v_sev := CASE WHEN v_eur >= 5000 THEN 'CRITICO'
                  WHEN v_eur >= 1000 THEN 'ALTO' ELSE 'AVISO' END;
    fmt := translate(to_char(v_eur, 'FM999G999G990D00'), ',.', '.,');

    PERFORM public._queue_system_alert(
      'venta_producto_sin_casar',
      v_sev || ': ' || v_prod::text || ' productos vendidos sin catalogo (' || fmt || ' EUR)',
      v_prod::text || ' productos distintos se han vendido en los ultimos ' || p_days::text
        || ' dias sin estar casados con la carta: ' || v_lin::text || ' lineas y ' || fmt || ' EUR. '
        || 'Su stock NO se ha descontado. El mayor es "' || coalesce(v_top,'?') || '" con '
        || translate(to_char(coalesce(v_top_eur,0), 'FM999G999G990D00'), ',.', '.,') || ' EUR. '
        || v_casan::text || ' de ellos tienen un unico candidato en su marca y se pueden casar de un clic. '
        || 'Bandeja: Productos sin catalogar.',
      -- La severidad va en la clave: un empeoramiento rompe el silencio, un
      -- estado estable no vuelve a sonar en 20 h.
      'venta_sin_casar_' || a.account_id::text || '_' || v_sev || '_'
        || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD')
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.sales_unmapped_watchdog(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_unmapped_watchdog(integer,integer) FROM anon, authenticated;

-- La firma vieja de 1 argumento se retira para que nadie pueda quedarse
-- llamando a la versión sin filtro.
DROP FUNCTION IF EXISTS public.sales_unmapped_watchdog(integer);

-- El cron se reapunta a la firma nueva:
--   select cron.alter_job(51, command => 'select public.sales_unmapped_watchdog(30, 10)');

notify pgrst, 'reload schema';

-- VERIFICADO: con el filtro, el vigía encola 1 alerta en vez de 2.
--   Foodint        524 productos en carta → CRITICO 61 productos (12.740,64 €)
--   Kitchen Grill    0 productos en carta → silenciada
