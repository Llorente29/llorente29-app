-- ── 1 · FUENTE DE DATOS DE LA BANDEJA ────────────────────────────────────
-- Una fila por (nombre del TPV × marca) sin casar, con su impacto, su
-- sugerencia y su diagnostico. Es lo que consume la pantalla y lo que permite
-- mirar el problema hoy por SQL.
--
-- La sugerencia se busca contra menu_item (la CARTA), no contra recipe_item:
-- medido el 25/08, contra recipe_item el 98% del dinero sale como "no existe el
-- plato" y contra menu_item hay 23 productos que casan solos.
CREATE OR REPLACE FUNCTION public.sales_unmapped_products(
  p_account_id uuid,
  p_days integer DEFAULT 30
)
 RETURNS TABLE(
   product_name text, brand_id uuid, brand_name text, sources text,
   lineas integer, uds numeric, euros numeric, ventas integer, ultima_venta date,
   tiene_matricula boolean, ya_mapeado boolean,
   candidatos_marca integer, candidatos_otras_marcas integer,
   sugerencia_menu_item_id uuid, sugerencia_nombre text,
   diagnostico text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.belongs_to_account(p_account_id) THEN
    RAISE EXCEPTION 'sales_unmapped_products: sin acceso a la cuenta %', p_account_id;
  END IF;

  RETURN QUERY
  WITH sc AS (
    SELECT sl.product_name AS pname,
           s.brand_id      AS bid,
           b.name          AS bname,
           string_agg(DISTINCT coalesce(s.source,'?'), ', ') AS srcs,
           public.sales_product_norm_nobrand(sl.product_name, b.name) AS norm,
           count(*)::integer                                  AS n_lineas,
           sum(sl.quantity)                                   AS n_uds,
           round(sum(sl.quantity * coalesce(sl.unit_price,0)),2) AS n_eur,
           count(DISTINCT s.id)::integer                      AS n_ventas,
           max(s.sold_at)::date                               AS ult,
           bool_or(sl.external_product_id IS NOT NULL)        AS matricula
      FROM public.sale_line sl
      JOIN public.sale s ON s.id = sl.sale_id
      LEFT JOIN public.brand b ON b.id = s.brand_id
     WHERE s.account_id = p_account_id
       AND s.sold_at >= now() - make_interval(days => greatest(coalesce(p_days,30), 1))
       AND sl.menu_item_id IS NULL
       AND sl.ignored_at IS NULL
       AND coalesce(sl.line_type,'product') = 'product'
       AND coalesce(s.is_active, true)
       AND coalesce(s.status,'') <> 'cancelled'
       AND coalesce(s.order_status,'') NOT IN ('cancelled','rejected')
     GROUP BY 1,2,3,5
  ), cand AS (
    SELECT sc.*,
      (SELECT count(*)::integer FROM public.menu_item mi
        WHERE mi.account_id = p_account_id AND mi.archived_at IS NULL
          AND mi.brand_id = sc.bid AND sc.norm <> ''
          AND public.sales_product_norm_nobrand(mi.name, sc.bname) = sc.norm) AS c_marca,
      (SELECT count(*)::integer FROM public.menu_item mi
        WHERE mi.account_id = p_account_id AND mi.archived_at IS NULL
          AND coalesce(mi.brand_id, '00000000-0000-0000-0000-000000000000'::uuid)
              IS DISTINCT FROM coalesce(sc.bid, '00000000-0000-0000-0000-000000000000'::uuid)
          AND sc.norm <> ''
          AND public.sales_product_norm_nobrand(mi.name, sc.bname) = sc.norm) AS c_otras,
      EXISTS (SELECT 1 FROM public.sales_mapping_fix smf
               WHERE smf.account_id = p_account_id
                 AND smf.product_norm = public.sales_product_norm(sc.pname)
                 AND smf.reverted_at IS NULL) AS mapeado
    FROM sc
  )
  SELECT c.pname, c.bid, c.bname, c.srcs,
         c.n_lineas, c.n_uds, c.n_eur, c.n_ventas, c.ult,
         c.matricula, c.mapeado, c.c_marca, c.c_otras,
         -- sugerencia SOLO si es unica dentro de su marca
         CASE WHEN c.c_marca = 1 THEN
           (SELECT mi.id FROM public.menu_item mi
             WHERE mi.account_id = p_account_id AND mi.archived_at IS NULL
               AND mi.brand_id = c.bid
               AND public.sales_product_norm_nobrand(mi.name, c.bname) = c.norm
             LIMIT 1) END,
         CASE WHEN c.c_marca = 1 THEN
           (SELECT mi.name FROM public.menu_item mi
             WHERE mi.account_id = p_account_id AND mi.archived_at IS NULL
               AND mi.brand_id = c.bid
               AND public.sales_product_norm_nobrand(mi.name, c.bname) = c.norm
             LIMIT 1) END,
         CASE
           WHEN c.mapeado          THEN 'ya_mapeado'
           WHEN c.c_marca = 1      THEN 'casa_solo'
           WHEN c.c_marca > 1      THEN 'ambiguo'
           WHEN c.c_otras > 0      THEN 'otra_marca'
           ELSE                         'sin_candidato'
         END
    FROM cand c
   ORDER BY c.n_eur DESC;
END;
$function$;

-- ── 2 · VIGIA ───────────────────────────────────────────────────────────
-- UNA alerta agregada por cuenta, no 684. Severidad por dinero. Debounce
-- diario para que no repita el mismo aviso cada 15 min.
CREATE OR REPLACE FUNCTION public.sales_unmapped_watchdog(p_days integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a          record;
  v_n        integer := 0;
  v_prod     integer;
  v_eur      numeric;
  v_lin      integer;
  v_casan    integer;
  v_top      text;
  v_top_eur  numeric;
  v_sev      text;
BEGIN
  FOR a IN SELECT DISTINCT s.account_id FROM public.sale s
            WHERE s.sold_at >= now() - make_interval(days => greatest(coalesce(p_days,30),1))
  LOOP
    SELECT count(*)::integer,
           coalesce(sum(u.euros),0),
           coalesce(sum(u.lineas),0)::integer,
           count(*) FILTER (WHERE u.diagnostico = 'casa_solo')::integer
      INTO v_prod, v_eur, v_lin, v_casan
      FROM public._sales_unmapped_products_raw(a.account_id, p_days) u;

    CONTINUE WHEN coalesce(v_prod,0) = 0;

    SELECT u.product_name, u.euros INTO v_top, v_top_eur
      FROM public._sales_unmapped_products_raw(a.account_id, p_days) u
     ORDER BY u.euros DESC LIMIT 1;

    -- Severidad proporcional al dinero: 1.660 EUR no es lo mismo que 5 EUR.
    v_sev := CASE WHEN v_eur >= 5000 THEN 'CRITICO'
                  WHEN v_eur >= 1000 THEN 'ALTO'
                  ELSE 'AVISO' END;

    PERFORM public._queue_system_alert(
      'venta_producto_sin_casar',
      v_sev || ': ' || v_prod::text || ' productos vendidos sin catalogo ('
        || to_char(v_eur, 'FM999G999G990D00') || ' EUR)',
      v_prod::text || ' productos distintos se han vendido en los ultimos ' || p_days::text
        || ' dias sin estar casados con la carta: ' || v_lin::text || ' lineas y '
        || to_char(v_eur, 'FM999G999G990D00') || ' EUR. Su stock NO se ha descontado. '
        || 'El mayor es "' || coalesce(v_top,'?') || '" con '
        || to_char(coalesce(v_top_eur,0), 'FM999G999G990D00') || ' EUR. '
        || v_casan::text || ' de ellos tienen un unico candidato en su marca y se pueden casar de un clic. '
        || 'Bandeja: Productos sin catalogar.',
      -- debounce diario por cuenta
      'venta_sin_casar_' || a.account_id::text || '_' || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD')
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

-- Version interna sin guard de sesion, para que el cron (sin auth.uid()) pueda
-- usar la misma logica que la pantalla.
CREATE OR REPLACE FUNCTION public._sales_unmapped_products_raw(
  p_account_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(product_name text, euros numeric, lineas integer, diagnostico text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT sl.product_name AS pname, s.brand_id AS bid, b.name AS bname,
           public.sales_product_norm_nobrand(sl.product_name, b.name) AS norm,
           count(*)::integer AS n_lineas,
           round(sum(sl.quantity * coalesce(sl.unit_price,0)),2) AS n_eur
      FROM public.sale_line sl
      JOIN public.sale s ON s.id = sl.sale_id
      LEFT JOIN public.brand b ON b.id = s.brand_id
     WHERE s.account_id = p_account_id
       AND s.sold_at >= now() - make_interval(days => greatest(coalesce(p_days,30), 1))
       AND sl.menu_item_id IS NULL
       AND sl.ignored_at IS NULL
       AND coalesce(sl.line_type,'product') = 'product'
       AND coalesce(s.is_active, true)
       AND coalesce(s.status,'') <> 'cancelled'
       AND coalesce(s.order_status,'') NOT IN ('cancelled','rejected')
     GROUP BY 1,2,3,4
  )
  SELECT sc.pname, sc.n_eur, sc.n_lineas,
         CASE WHEN EXISTS (SELECT 1 FROM public.sales_mapping_fix smf
                            WHERE smf.account_id = p_account_id
                              AND smf.product_norm = public.sales_product_norm(sc.pname)
                              AND smf.reverted_at IS NULL) THEN 'ya_mapeado'
              WHEN (SELECT count(*) FROM public.menu_item mi
                     WHERE mi.account_id = p_account_id AND mi.archived_at IS NULL
                       AND mi.brand_id = sc.bid AND sc.norm <> ''
                       AND public.sales_product_norm_nobrand(mi.name, sc.bname) = sc.norm) = 1
                THEN 'casa_solo'
              ELSE 'otro' END
    FROM sc;
$function$;

REVOKE ALL ON FUNCTION public._sales_unmapped_products_raw(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sales_unmapped_products_raw(uuid,integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_unmapped_watchdog(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_unmapped_watchdog(integer) FROM anon, authenticated;

notify pgrst, 'reload schema';