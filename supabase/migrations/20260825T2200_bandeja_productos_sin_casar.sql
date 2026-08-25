-- 20260825T2200_bandeja_productos_sin_casar.sql
-- APLICADA en producción el 25-08-2026.
-- Encargo "Bandeja de productos sin casar + vigía", primera entrega: capa de
-- datos (RPC de la bandeja + vigía + automap por nombre). La pantalla va aparte.
--
-- ── LO QUE EL RECON CAMBIÓ DEL ENCARGO ───────────────────────────────────
-- 1. El automap YA normalizaba. `sales_product_norm` hace minúsculas, quita
--    acentos y colapsa espacios; `sales_product_norm_nobrand` quita la sigla de
--    marca del final CON y SIN paréntesis. "QUESATACOS ... DC" y
--    "QUESATACOS ... (DC)" ya normalizaban igual. Añadir normalización no
--    arreglaba nada.
-- 2. El problema era CONTRA QUÉ se casa. auto_map_exact_sales casa contra
--    recipe_item (plato de cocina); por esa vía el 98 % del dinero sale como
--    "no existe el plato". Contra menu_item (la carta) hay 15 productos que
--    casan solos.
-- 3. La matrícula del TPV (sale_line.external_product_id) no es una validación
--    caprichosa: es la LLAVE con la que la ingesta reconocerá el producto la
--    próxima vez (menu_item.external_id). Sin ella, casar por nombre arregla el
--    histórico pero no evita que el siguiente pedido vuelva a entrar sin casar.
--
-- MEDIDO EL 25/08 (cuenta Llorente29, 30 días, ventas vivas):
--   680 líneas · 12.746,14 € · 61 productos × marca
--     15 casan solos (4.975,46 €) — de ellos 5 automatizables hoy (2.663,16 €)
--     14 ya mapeados, con ventas viejas sin actualizar (2.076,28 €)
--     32 no están en la carta — hay que crearlos
--   (La cifra del encargo, 564 líneas / 7.892 €, salía de una query con LIMIT 40.)

-- ── 1 · FUENTE DE DATOS DE LA BANDEJA ────────────────────────────────────
-- Una fila por (nombre del TPV × marca) sin casar, con impacto, sugerencia y
-- diagnóstico. Es lo que consumirá la pantalla y permite ver el problema hoy.
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

-- Versión interna sin guard de sesión, para el cron (que no tiene auth.uid()).
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

-- ── 2 · VIGÍA ───────────────────────────────────────────────────────────
-- UNA alerta agregada por cuenta, no 680. Severidad por dinero. Debounce
-- diario para que no repita el mismo aviso cada hora.
CREATE OR REPLACE FUNCTION public.sales_unmapped_watchdog(p_days integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a record; v_n integer := 0; v_prod integer; v_eur numeric; v_lin integer;
  v_casan integer; v_top text; v_top_eur numeric; v_sev text; fmt text;
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
    -- to_char da formato inglés; translate intercambia coma y punto.
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

-- ── 3 · AUTOMAP POR NOMBRE NORMALIZADO CONTRA LA CARTA ───────────────────
-- Regla de seguridad (§2.3): SOLO si el match normalizado es ÚNICO dentro de la
-- MISMA marca. Cualquier ambigüedad va a la bandeja.
-- Además exige lo que impone el motor de mapeo y que NO se salta aquí:
--   · el menu_item sugerido tiene que tener receta (si no, no hay nada que
--     descontar y casarlo no arregla el stock);
--   · la venta tiene que traer matrícula del TPV, que es la llave de la ingesta.
CREATE OR REPLACE FUNCTION public.auto_map_sales_by_name(
  p_account_id uuid DEFAULT NULL::uuid,
  p_days integer DEFAULT 30,
  p_dry_run boolean DEFAULT false)
 RETURNS TABLE(product_name text, menu_item_name text, recipe_item_id uuid, aplicado boolean, motivo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a record; r record; v_ri uuid; v_mn text;
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

REVOKE ALL ON FUNCTION public._sales_unmapped_products_raw(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sales_unmapped_products_raw(uuid,integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_unmapped_watchdog(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_unmapped_watchdog(integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_map_sales_by_name(uuid,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_map_sales_by_name(uuid,integer,boolean) FROM anon, authenticated;

-- ── 4 · CRONS ───────────────────────────────────────────────────────────
--   select cron.schedule('sales-unmapped-watchdog', '20 * * * *',
--                        'select public.sales_unmapped_watchdog(30)');
--   select cron.schedule('sales-automap-byname', '7,22,37,52 * * * *',
--                        'select count(*) from public.auto_map_sales_by_name(null, 30, false)');
-- El vigía cada hora basta: el debounce es diario. El automap va desfasado del
-- 'sales-automap-exact' existente (*/15) para no solaparse.

notify pgrst, 'reload schema';

-- ── VERIFICADO tras aplicar ──────────────────────────────────────────────
-- Contraste del RPC contra la medición directa:
--   RPC:      12.746,14 € · 680 líneas · 61 productos
--   directa:  12.758,04 € · 681 líneas · 62 pares producto×marca
--   (1 línea / 11,90 € de diferencia por el agrupado de marca nula)
--
-- Vigía, ejecutado en vivo → 2 alertas encoladas, una por cuenta:
--   "CRITICO: 61 productos vendidos sin catalogo (12.746,14 EUR)" — Llorente29
--     mayor: "QUESATACOS DE BIRRIA DE CERDO DC" 1.645,76 EUR
--   "ALTO: 99 productos vendidos sin catalogo (3.183,80 EUR)" — otra cuenta
--   Segunda pasada el mismo día: sigue habiendo 2 (el debounce funciona).
--
-- Automap, dry-run: 5 casarían · 32 no están en la carta · 8 sin receta ·
--   2 sin matrícula. Ejecutado en real, los 5 aplicados:
--     Deep Mamma's Pizza DP           → Deep Mamma's Pizza (DP)
--     QUESABIRRIA DE POLLO (DC)       → QUESABIRRIA DE POLLO DC
--     QUESATACOS DE BIRRIA DE CERDO DC→ QUESATACOS DE BIRRIA DE CERDO (DC)
--     Tequeños (BB)                   → Tequeños BB
--     Tequeños Milanesa Haus (MH)     → Tequeños Milanesa Haus MH
--   Los 5 registrados en sales_mapping_fix. NO se tocaron ventas viejas:
--   _map_sales_product_to_dish_internal arregla de hoy en adelante.
