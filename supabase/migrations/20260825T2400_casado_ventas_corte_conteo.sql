-- 20260825T2400_casado_ventas_corte_conteo.sql
--
-- ── LO QUE ENCONTRÉ EN EL RECON ──────────────────────────────────────────
-- La bandeja de productos sin casar YA EXISTE en producción: Cocina →
-- Cartas → casado de ventas (SalesExceptionsPage, 1.451 líneas). Tiene
-- impacto en euros, sugerencia de casado, selector manual, "ignorar" con
-- motivo y "crear plato" con anti-duplicado. No hacía falta una segunda.
--
-- Lo que le falta es lo que le falta a todo lo demás: EL CORTE.
--
-- Tres botones de esa pantalla reprocesan ventas sin ventana temporal:
--
--   resolve_unmapped_sales   → recast_lastapp_sales(cuenta) → TODAS las
--                              ventas lastapp de la cuenta
--   unignore_unmapped_sales  → recast_lastapp_sales(cuenta) → idem
--   create_dish_from_unmapped→ reprocess_sale de todas las ventas de ese
--                              producto (acotado el 28/07 por timeout,
--                              nunca por conteos)
--
-- Medido hoy en Foodint:
--
--   ventas lastapp con raw_products ......... 7.197
--   por debajo del ultimo conteo aprobado ... 7.042  (195.185,32 EUR)
--   por encima del corte ....................   155
--
-- Es decir: quien pulse "casar" en oficina le pasa por encima a 98 conteos
-- aprobados y regenera consumo que un conteo fisico ya corrigio. Es A3
-- (641 ventas) a escala 11x, y no es hipotetico: el boton esta vivo.
--
-- ── LO QUE HACE ESTA MIGRACION ───────────────────────────────────────────
-- Envuelve, no reescribe. Las tres funciones originales quedan EXACTAMENTE
-- como estaban — cualquier camino que ya las llame sigue viendo lo mismo.
-- Al lado nacen tres hermanas con corte, y la pantalla apunta a las
-- hermanas. Menos superficie, menos riesgo.
--
-- El corte es el mismo que aplica apply_inventory_count: una venta anterior
-- al ultimo conteo aprobado de SU local no se toca, porque ese conteo ya
-- dijo la verdad sobre ese stock. p_include_before_last_count=true abre la
-- puerta explicitamente, para quien sepa lo que hace.
--
-- Dos notas que van aqui y no dentro del cuerpo de sus funciones, para que
-- este fichero sea byte a byte lo aplicado (los comentarios de dentro de una
-- funcion viven en prosrc y divergirian):
--
--   * resolve_unmapped_sales_scoped: 'ignore' y 'delist' no generan consumo
--     nuevo, asi que se delegan tal cual en la original. El corte solo aplica
--     a 'link'. (Y la original ya salia antes del recast en esos dos casos,
--     verificado: ignorar un producto nunca fue peligroso.)
--
--   * _create_dish_from_unmapped_core: el bloque anti-duplicado es de Code
--     (28/07). Dos matriculas del mismo plato fisico creaban un plato
--     duplicado cada vez; solo se salta con p_confirm_create=true. Se
--     conserva intacto al extraer el nucleo.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) El corte, en un solo sitio.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._reprocess_product_sales_scoped(
  p_account_id uuid,
  p_product_name text,
  p_include_before_last_count boolean DEFAULT false)
 RETURNS TABLE(ventas_reprocesadas integer, ventas_protegidas integer, euros_protegidos numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_norm text; r record;
  v_repro integer := 0; v_prot integer := 0; v_eur numeric := 0;
BEGIN
  -- Helper privado, pero SECURITY DEFINER: guarda su propia puerta.
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION '_reprocess_product_sales_scoped: sin acceso a la cuenta %', p_account_id;
  END IF;

  v_norm := public.sales_product_norm(p_product_name);

  FOR r IN
    SELECT DISTINCT s.id, s.sold_at, s.location_id,
           (SELECT max(coalesce(ic.closed_at, ic.created_at))
              FROM inventory_count ic
             WHERE ic.location_id = s.location_id AND ic.status = 'aprobado') AS corte,
           (SELECT coalesce(sum(sl2.quantity * coalesce(sl2.unit_price,0)),0)
              FROM sale_line sl2
             WHERE sl2.sale_id = s.id
               AND public.sales_product_norm(sl2.product_name) = v_norm) AS eur
      FROM sale s
      JOIN sale_line sl ON sl.sale_id = s.id
     WHERE s.account_id = p_account_id
       AND s.source = 'lastapp'
       AND s.raw_products IS NOT NULL
       AND coalesce(sl.line_type,'product') = 'product'
       AND public.sales_product_norm(sl.product_name) = v_norm
  LOOP
    IF r.corte IS NOT NULL AND r.sold_at <= r.corte AND NOT p_include_before_last_count THEN
      v_prot := v_prot + 1;
      v_eur  := v_eur + coalesce(r.eur, 0);
      CONTINUE;
    END IF;
    PERFORM public.reprocess_sale(r.id);
    v_repro := v_repro + 1;
  END LOOP;

  ventas_reprocesadas := v_repro;
  ventas_protegidas   := v_prot;
  euros_protegidos    := round(v_eur, 2);
  RETURN NEXT;
END;
$function$;

-- resolve_unmapped_sales_scoped pasa a usar el helper. Comportamiento
-- identico al que se aplico hace un rato; solo deja de repetir el bucle.
CREATE OR REPLACE FUNCTION public.resolve_unmapped_sales_scoped(
  p_account_id uuid,
  p_product_name text,
  p_action text,
  p_reason text DEFAULT NULL::text,
  p_brand_id uuid DEFAULT NULL::uuid,
  p_include_before_last_count boolean DEFAULT false)
 RETURNS TABLE(resultado text, menu_item_id uuid, recipe_item_id uuid, brand_id uuid,
               ventas_reprocesadas integer, ventas_protegidas integer, euros_protegidos numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_core record; v_rep record;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'resolve_unmapped_sales_scoped: sin acceso a la cuenta %', p_account_id;
  END IF;
  IF p_action NOT IN ('link','ignore','delist') THEN
    RAISE EXCEPTION 'resolve_unmapped_sales_scoped: acción inválida %', p_action;
  END IF;

  IF p_action IN ('ignore','delist') THEN
    RETURN QUERY
      SELECT r2.resultado, r2.menu_item_id, r2.recipe_item_id, r2.brand_id,
             0, 0, 0::numeric
        FROM public.resolve_unmapped_sales(p_account_id, p_product_name, p_action, p_reason, p_brand_id) r2;
    RETURN;
  END IF;

  SELECT * INTO v_core
    FROM public._resolve_unmapped_link_core(p_account_id, p_product_name, p_brand_id);

  SELECT * INTO v_rep
    FROM public._reprocess_product_sales_scoped(p_account_id, p_product_name, p_include_before_last_count);

  resultado := 'linked';
  menu_item_id := v_core.menu_item_id;
  recipe_item_id := v_core.recipe_item_id;
  brand_id := v_core.brand_id;
  ventas_reprocesadas := v_rep.ventas_reprocesadas;
  ventas_protegidas   := v_rep.ventas_protegidas;
  euros_protegidos    := v_rep.euros_protegidos;
  RETURN NEXT;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Crear plato: se extrae el nucleo (anti-duplicado + alta) del bucle.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._create_dish_from_unmapped_core(
  p_account_id uuid,
  p_product_name text,
  p_confirm_create boolean DEFAULT false)
 RETURNS TABLE(out_recipe_item_id uuid, out_marcas_creadas integer, out_creado boolean,
               out_candidato_id uuid, out_candidato_nombre text, out_similitud numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_norm text; v_matricula text; v_brand_id uuid; v_is_combo boolean := false;
  v_cat_name text; v_cat_price numeric; v_unit uuid; v_recipe_id uuid; v_menu_id uuid;
  v_marcas integer := 0;
  v_candidato_id uuid; v_candidato_nombre text; v_similitud numeric;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'create_dish_from_unmapped: sin acceso a la cuenta %', p_account_id;
  END IF;

  v_norm := public.sales_product_norm(p_product_name);

  IF NOT p_confirm_create THEN
    SELECT ri.id, ri.name,
           round(similarity(public.normalize_ingredient_name(ri.name), v_norm)::numeric, 2)
      INTO v_candidato_id, v_candidato_nombre, v_similitud
      FROM recipe_item ri
     WHERE ri.account_id = p_account_id
       AND ri.type = 'dish'
       AND ri.is_active = true
       AND ri.archived_at IS NULL
       AND public.normalize_ingredient_name(ri.name) % v_norm
       AND similarity(public.normalize_ingredient_name(ri.name), v_norm) >= 0.6
     ORDER BY similarity(public.normalize_ingredient_name(ri.name), v_norm) DESC
     LIMIT 1;

    IF v_candidato_id IS NOT NULL THEN
      out_recipe_item_id := NULL; out_marcas_creadas := 0; out_creado := false;
      out_candidato_id := v_candidato_id; out_candidato_nombre := v_candidato_nombre;
      out_similitud := v_similitud;
      RETURN NEXT; RETURN;
    END IF;
  END IF;

  SELECT sl.external_product_id, s.brand_id INTO v_matricula, v_brand_id
  FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND coalesce(sl.line_type,'product') = 'product'
    AND public.sales_product_norm(sl.product_name) = v_norm
  ORDER BY (sl.external_product_id IS NOT NULL) DESC, (s.brand_id IS NOT NULL) DESC
  LIMIT 1;

  IF v_matricula IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el producto "%" (sus ventas no traen id de producto del TPV; no es casable por matrícula).', p_product_name;
  END IF;

  SELECT max(ecp.product_name) FILTER (WHERE ecp.external_channel = 'default'),
         bool_or(ecp.product_type = 'combo'),
         coalesce(max(ecp.price_cents) FILTER (WHERE ecp.external_channel = 'default'),
           (SELECT mode() WITHIN GROUP (ORDER BY ecp2.price_cents)
              FROM external_catalog_product ecp2
             WHERE ecp2.account_id = p_account_id
               AND ecp2.organization_product_id::text = v_matricula
               AND ecp2.price_cents IS NOT NULL))
    INTO v_cat_name, v_is_combo, v_cat_price
  FROM external_catalog_product ecp
  WHERE ecp.account_id = p_account_id AND ecp.organization_product_id::text = v_matricula;

  IF coalesce(v_is_combo, false) THEN
    RAISE EXCEPTION 'El producto "%" es un combo en el catálogo; su coste es la suma de sus componentes, no una receta plana. (Frente propio: combos.)', p_product_name;
  END IF;

  IF v_brand_id IS NULL THEN
    SELECT b.id INTO v_brand_id
    FROM external_catalog_product ecp
    JOIN brand b ON b.account_id = p_account_id AND b.is_active IS NOT FALSE
      AND upper(coalesce(b.name,'')) <> 'FOODINT'
      AND lower(public.unaccent(b.name)) = lower(public.unaccent(
            CASE WHEN ecp.external_brand_name = 'Dirty Burgers' THEN 'Dirty Burger'
                 ELSE ecp.external_brand_name END))
    WHERE ecp.account_id = p_account_id
      AND ecp.organization_product_id::text = v_matricula
      AND ecp.external_brand_name IS NOT NULL
    LIMIT 1;
  END IF;
  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver la marca de "%". Vincula la marca externa (external_brand_map) o revisa el alias de catálogo.', p_product_name;
  END IF;

  SELECT mi.id, mi.recipe_item_id INTO v_menu_id, v_recipe_id
  FROM menu_item mi
  WHERE mi.account_id = p_account_id AND mi.external_source = 'lastapp'
    AND mi.external_id = v_matricula AND mi.brand_id = v_brand_id
    AND mi.archived_at IS NULL
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    SELECT id INTO v_unit FROM kitchen_unit
    WHERE lower(coalesce(abbreviation,'')) = 'ud' OR lower(coalesce(name,'')) = 'unidad'
    ORDER BY (lower(coalesce(abbreviation,'')) = 'ud') DESC LIMIT 1;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'No existe la unidad base "Unidad" en kitchen_unit; no se puede crear el plato.';
    END IF;

    INSERT INTO recipe_item (account_id, type, name, base_unit_id, source, needs_review, is_sellable)
    VALUES (p_account_id, 'dish', coalesce(nullif(btrim(v_cat_name),''), p_product_name),
            v_unit, 'import', true, true)
    RETURNING id INTO v_recipe_id;

    IF v_menu_id IS NULL THEN
      INSERT INTO menu_item (account_id, brand_id, channel_id, recipe_item_id, name, price,
                             product_type, external_source, external_id, source, needs_review)
      VALUES (p_account_id, v_brand_id, NULL, v_recipe_id,
              coalesce(nullif(btrim(v_cat_name),''), p_product_name),
              coalesce(v_cat_price,0)::numeric / 100.0,
              'item', 'lastapp', v_matricula, 'import', true)
      RETURNING id INTO v_menu_id;
      v_marcas := v_marcas + 1;
    ELSE
      UPDATE menu_item SET recipe_item_id = v_recipe_id WHERE id = v_menu_id;
    END IF;
  END IF;

  out_recipe_item_id := v_recipe_id; out_marcas_creadas := v_marcas; out_creado := true;
  out_candidato_id := NULL; out_candidato_nombre := NULL; out_similitud := NULL;
  RETURN NEXT;
END;
$function$;

-- La original delega en el nucleo y conserva SU bucle sin corte. Byte a byte
-- el mismo contrato para quien ya la llame.
CREATE OR REPLACE FUNCTION public.create_dish_from_unmapped(
  p_account_id uuid,
  p_product_name text,
  p_confirm_create boolean DEFAULT false)
 RETURNS TABLE(out_recipe_item_id uuid, out_marcas_creadas integer, out_lineas_casadas integer,
               out_creado boolean, out_candidato_id uuid, out_candidato_nombre text, out_similitud numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_core record; v_norm text; v_sale_id uuid; v_casadas integer := 0;
BEGIN
  SELECT * INTO v_core
    FROM public._create_dish_from_unmapped_core(p_account_id, p_product_name, p_confirm_create);

  IF NOT v_core.out_creado THEN
    out_recipe_item_id := NULL; out_marcas_creadas := 0; out_lineas_casadas := 0;
    out_creado := false; out_candidato_id := v_core.out_candidato_id;
    out_candidato_nombre := v_core.out_candidato_nombre; out_similitud := v_core.out_similitud;
    RETURN NEXT; RETURN;
  END IF;

  v_norm := public.sales_product_norm(p_product_name);

  FOR v_sale_id IN
    SELECT DISTINCT s.id
      FROM sale s JOIN sale_line sl ON sl.sale_id = s.id
     WHERE s.account_id = p_account_id AND s.source = 'lastapp'
       AND s.raw_products IS NOT NULL
       AND coalesce(sl.line_type,'product') = 'product'
       AND public.sales_product_norm(sl.product_name) = v_norm
  LOOP
    PERFORM public.reprocess_sale(v_sale_id);
  END LOOP;

  SELECT count(*) INTO v_casadas
  FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND sl.menu_item_id IS NOT NULL
    AND public.sales_product_norm(sl.product_name) = v_norm;

  out_recipe_item_id := v_core.out_recipe_item_id;
  out_marcas_creadas := v_core.out_marcas_creadas;
  out_lineas_casadas := v_casadas;
  out_creado := true; out_candidato_id := NULL;
  out_candidato_nombre := NULL; out_similitud := NULL;
  RETURN NEXT;
END;
$function$;

-- La hermana con corte.
CREATE OR REPLACE FUNCTION public.create_dish_from_unmapped_scoped(
  p_account_id uuid,
  p_product_name text,
  p_confirm_create boolean DEFAULT false,
  p_include_before_last_count boolean DEFAULT false)
 RETURNS TABLE(out_recipe_item_id uuid, out_marcas_creadas integer, out_lineas_casadas integer,
               out_creado boolean, out_candidato_id uuid, out_candidato_nombre text, out_similitud numeric,
               out_ventas_reprocesadas integer, out_ventas_protegidas integer, out_euros_protegidos numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_core record; v_rep record; v_norm text; v_casadas integer := 0;
BEGIN
  SELECT * INTO v_core
    FROM public._create_dish_from_unmapped_core(p_account_id, p_product_name, p_confirm_create);

  IF NOT v_core.out_creado THEN
    out_recipe_item_id := NULL; out_marcas_creadas := 0; out_lineas_casadas := 0;
    out_creado := false; out_candidato_id := v_core.out_candidato_id;
    out_candidato_nombre := v_core.out_candidato_nombre; out_similitud := v_core.out_similitud;
    out_ventas_reprocesadas := 0; out_ventas_protegidas := 0; out_euros_protegidos := 0::numeric;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_rep
    FROM public._reprocess_product_sales_scoped(p_account_id, p_product_name, p_include_before_last_count);

  v_norm := public.sales_product_norm(p_product_name);
  SELECT count(*) INTO v_casadas
  FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND sl.menu_item_id IS NOT NULL
    AND public.sales_product_norm(sl.product_name) = v_norm;

  out_recipe_item_id := v_core.out_recipe_item_id;
  out_marcas_creadas := v_core.out_marcas_creadas;
  out_lineas_casadas := v_casadas;
  out_creado := true; out_candidato_id := NULL;
  out_candidato_nombre := NULL; out_similitud := NULL;
  out_ventas_reprocesadas := v_rep.ventas_reprocesadas;
  out_ventas_protegidas   := v_rep.ventas_protegidas;
  out_euros_protegidos    := v_rep.euros_protegidos;
  RETURN NEXT;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Deshacer un "ignorado" tambien tiene corte.
--
-- El trabajo real de unignore es el UPDATE que reabre las lineas. El recast
-- estaba solo para recomputar la razon de las reabiertas — pero reprocess_sale
-- regenera el consumo de la venta ENTERA, y por ahi se colaba el doble
-- descuento. Aqui se reprocesa solo ese producto, y solo por encima del corte.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unignore_unmapped_sales_scoped(
  p_account_id uuid,
  p_product_name text,
  p_brand_id uuid DEFAULT NULL::uuid,
  p_include_before_last_count boolean DEFAULT false)
 RETURNS TABLE(resultado text, lineas_afectadas integer,
               ventas_reprocesadas integer, ventas_protegidas integer, euros_protegidos numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_norm text; v_afect integer := 0; v_rep record;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'unignore_unmapped_sales_scoped: sin acceso a la cuenta %', p_account_id;
  END IF;

  v_norm := public.sales_product_norm(p_product_name);

  UPDATE sale_line sl
  SET unmapped_reason = NULL,
      ignore_reason = NULL,
      ignored_at = NULL,
      map_needs_review = true,
      updated_at = now()
  FROM sale s
  WHERE sl.sale_id = s.id
    AND sl.account_id = p_account_id
    AND s.source = 'lastapp'
    AND sl.menu_item_id IS NULL
    AND coalesce(sl.line_type,'product') = 'product'
    AND sl.map_source <> 'manual'
    AND coalesce(sl.unmapped_reason,'') = 'ignored'
    AND (p_brand_id IS NULL OR s.brand_id = p_brand_id)
    AND public.sales_product_norm(sl.product_name) = v_norm;
  GET DIAGNOSTICS v_afect = ROW_COUNT;

  SELECT * INTO v_rep
    FROM public._reprocess_product_sales_scoped(p_account_id, p_product_name, p_include_before_last_count);

  resultado := 'unignored'; lineas_afectadas := v_afect;
  ventas_reprocesadas := v_rep.ventas_reprocesadas;
  ventas_protegidas   := v_rep.ventas_protegidas;
  euros_protegidos    := v_rep.euros_protegidos;
  RETURN NEXT;
END;
$function$;

-- Helpers privados: mismo blindaje que _resolve_unmapped_link_core. Postgres
-- regala EXECUTE a PUBLIC en cada CREATE, asi que hay que quitarlo a mano.
REVOKE ALL ON FUNCTION public._reprocess_product_sales_scoped(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._create_dish_from_unmapped_core(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._reprocess_product_sales_scoped(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public._create_dish_from_unmapped_core(uuid, text, boolean) TO service_role;

-- Las que llama la pantalla.
-- La scoped de resolve nacio hace un rato con los grants por defecto de
-- Supabase (anon incluido). El guard de tenancy la protegia igual, pero se
-- alinea con sus hermanas: si no hay jwt no hay nada que hacer aqui.
REVOKE ALL ON FUNCTION public.resolve_unmapped_sales_scoped(uuid, text, text, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_unmapped_sales_scoped(uuid, text, text, text, uuid, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_dish_from_unmapped_scoped(uuid, text, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unignore_unmapped_sales_scoped(uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_dish_from_unmapped_scoped(uuid, text, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unignore_unmapped_sales_scoped(uuid, text, uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
