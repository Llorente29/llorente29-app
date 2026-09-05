-- ── Formato de numero en espanol para el mensaje del vigia ───────────────
-- to_char da formato ingles (3,183.80); translate intercambia coma y punto.
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
  fmt        text;
BEGIN
  FOR a IN SELECT DISTINCT s.account_id FROM public.sale s
            WHERE s.sold_at >= now() - make_interval(days => greatest(coalesce(p_days,30),1))
  LOOP
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

REVOKE ALL ON FUNCTION public.sales_unmapped_watchdog(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_unmapped_watchdog(integer) FROM anon, authenticated;

-- ── AUTOMAP POR NOMBRE NORMALIZADO CONTRA LA CARTA ───────────────────────
-- auto_map_exact_sales casa contra recipe_item; medido el 25/08, por esa via
-- el 98% del dinero sale como "no existe el plato". Contra menu_item (la
-- carta) hay 15 productos que casan solos.
--
-- Regla de seguridad (encargo §2.3): SOLO si el match normalizado es UNICO
-- dentro de la MISMA marca. Cualquier ambiguedad va a la bandeja.
--
-- Ademas exige dos cosas que impone el motor de mapeo existente y que NO se
-- saltan aqui:
--   · el menu_item sugerido tiene que tener receta (si no, no hay nada que
--     descontar y casarlo no arregla el stock);
--   · la venta tiene que traer matricula del TPV (external_product_id), que es
--     la llave con la que la ingesta reconocera el producto la proxima vez.
-- Medido hoy: de 15 que casan solos, 5 cumplen ambas (2.663,16 EUR).
CREATE OR REPLACE FUNCTION public.auto_map_sales_by_name(
  p_account_id uuid DEFAULT NULL::uuid,
  p_days integer DEFAULT 30,
  p_dry_run boolean DEFAULT false)
 RETURNS TABLE(product_name text, menu_item_name text, recipe_item_id uuid, aplicado boolean, motivo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a      record;
  r      record;
  v_ri   uuid;
  v_mn   text;
BEGIN
  FOR a IN
    SELECT DISTINCT s.account_id FROM public.sale s
     WHERE (p_account_id IS NULL OR s.account_id = p_account_id)
       AND s.sold_at >= now() - make_interval(days => greatest(coalesce(p_days,30),1))
  LOOP
    FOR r IN
      WITH sc AS (
        SELECT sl.product_name AS pname, s.brand_id AS bid, b.name AS bname,
               public.sales_product_norm_nobrand(sl.product_name, b.name) AS norm,
               bool_or(sl.external_product_id IS NOT NULL) AS matricula
          FROM public.sale_line sl
          JOIN public.sale s ON s.id = sl.sale_id
          LEFT JOIN public.brand b ON b.id = s.brand_id
         WHERE s.account_id = a.account_id
           AND s.sold_at >= now() - make_interval(days => greatest(coalesce(p_days,30),1))
           AND sl.menu_item_id IS NULL AND sl.ignored_at IS NULL
           AND coalesce(sl.line_type,'product') = 'product'
           AND coalesce(s.is_active,true) AND coalesce(s.status,'') <> 'cancelled'
           AND coalesce(s.order_status,'') NOT IN ('cancelled','rejected')
         GROUP BY 1,2,3,4
      )
      SELECT sc.pname, sc.bid, sc.bname, sc.matricula,
             (SELECT count(*) FROM public.menu_item mi
               WHERE mi.account_id = a.account_id AND mi.archived_at IS NULL
                 AND mi.brand_id = sc.bid AND sc.norm <> ''
                 AND public.sales_product_norm_nobrand(mi.name, sc.bname) = sc.norm) AS cand
        FROM sc
       WHERE NOT EXISTS (SELECT 1 FROM public.sales_mapping_fix smf
                          WHERE smf.account_id = a.account_id
                            AND smf.product_norm = public.sales_product_norm(sc.pname)
                            AND smf.reverted_at IS NULL)
    LOOP
      product_name := r.pname; menu_item_name := null; recipe_item_id := null; aplicado := false;

      IF r.cand = 0 THEN motivo := 'no esta en la carta'; RETURN NEXT; CONTINUE; END IF;
      IF r.cand > 1 THEN motivo := 'ambiguo: varios en su marca'; RETURN NEXT; CONTINUE; END IF;

      SELECT mi.recipe_item_id, mi.name INTO v_ri, v_mn
        FROM public.menu_item mi
       WHERE mi.account_id = a.account_id AND mi.archived_at IS NULL
         AND mi.brand_id = r.bid
         AND public.sales_product_norm_nobrand(mi.name, r.bname)
             = public.sales_product_norm_nobrand(r.pname, r.bname)
       LIMIT 1;

      menu_item_name := v_mn; recipe_item_id := v_ri;

      IF v_ri IS NULL THEN motivo := 'el producto de la carta no tiene receta'; RETURN NEXT; CONTINUE; END IF;
      IF NOT r.matricula THEN motivo := 'las ventas no traen matricula del TPV'; RETURN NEXT; CONTINUE; END IF;
      IF p_dry_run THEN motivo := 'dry-run'; RETURN NEXT; CONTINUE; END IF;

      BEGIN
        PERFORM public._map_sales_product_to_dish_internal(
          a.account_id, r.pname, v_ri, r.bid, 'auto (nombre normalizado)', 'auto_exact');
        aplicado := true; motivo := null;
      EXCEPTION WHEN others THEN
        aplicado := false; motivo := sqlerrm;
      END;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_map_sales_by_name(uuid,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_map_sales_by_name(uuid,integer,boolean) FROM anon, authenticated;

notify pgrst, 'reload schema';