-- 20260825T2310_vigia_umbral_catalogo_minimo.sql
-- APLICADA en producción el 25-08-2026.
--
-- El vigía se calla en cuentas SIN carta montada.
--
-- Kitchen Grill LstQ (siguiente cliente, marcas cedidas, aún sin entrar en
-- producción) tiene 0 productos en carta, así que TODO lo que vende sale sin
-- casar por definición: 99 productos / 3.183,80 € de ruido diario.
--
-- Filtro por CATÁLOGO MÍNIMO, no por cuenta (decisión de Julio): cuando monten
-- la carta el vigía se reactiva solo, sin que nadie tenga que acordarse de
-- quitar una excepción. Sirve igual para cualquier cuenta interna o de
-- laboratorio.
--
-- El umbral (10 productos vivos) es parámetro, no constante.

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
      'venta_sin_casar_' || a.account_id::text || '_' || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD')
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
