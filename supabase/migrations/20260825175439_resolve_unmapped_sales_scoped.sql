-- ── NUCLEO: resolver/crear el producto, SIN recast ───────────────────────
-- Copia literal del cuerpo de 'link' de resolve_unmapped_sales, quitando la
-- llamada a recast_lastapp_sales. Ni resolve_unmapped_sales ni
-- recast_lastapp_sales cambian de comportamiento: la primera pasa a delegar en
-- este nucleo y sigue haciendo el recast global despues, exactamente como antes.
CREATE OR REPLACE FUNCTION public._resolve_unmapped_link_core(
  p_account_id uuid, p_product_name text, p_brand_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(menu_item_id uuid, recipe_item_id uuid, brand_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text; v_matricula text; v_brand_id uuid; v_is_combo boolean := false;
  v_cat_name text; v_cat_price numeric; v_unit uuid; v_recipe_id uuid; v_menu_item uuid;
BEGIN
  v_norm := public.sales_product_norm(p_product_name);

  SELECT sl.external_product_id, s.brand_id INTO v_matricula, v_brand_id
  FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND coalesce(sl.line_type,'product') = 'product'
    AND (p_brand_id IS NULL OR s.brand_id = p_brand_id)
    AND public.sales_product_norm(sl.product_name) = v_norm
  ORDER BY (sl.external_product_id IS NOT NULL) DESC, (s.brand_id IS NOT NULL) DESC
  LIMIT 1;

  v_brand_id := coalesce(p_brand_id, v_brand_id);

  IF v_matricula IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver "%" por matrícula (sus ventas no traen id de producto del TPV).', p_product_name;
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
    RAISE EXCEPTION 'El producto "%" es un combo; su coste es Σ componentes, no una receta. (Frente propio: combos.)', p_product_name;
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
    RAISE EXCEPTION 'No se pudo resolver la marca de "%".', p_product_name;
  END IF;

  SELECT mi.id, mi.recipe_item_id INTO v_menu_item, v_recipe_id
  FROM menu_item mi
  WHERE mi.account_id = p_account_id AND mi.external_source = 'lastapp'
    AND mi.external_id = v_matricula AND mi.brand_id = v_brand_id
    AND mi.archived_at IS NULL
  LIMIT 1;

  IF v_menu_item IS NULL THEN
    SELECT id INTO v_unit FROM kitchen_unit
    WHERE lower(coalesce(abbreviation,'')) = 'ud' OR lower(coalesce(name,'')) = 'unidad'
    ORDER BY (lower(coalesce(abbreviation,'')) = 'ud') DESC LIMIT 1;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'No existe la unidad base "Unidad" en kitchen_unit.';
    END IF;

    INSERT INTO recipe_item (account_id, type, name, base_unit_id, source, needs_review, is_sellable)
    VALUES (p_account_id, 'dish', coalesce(nullif(btrim(v_cat_name),''), p_product_name),
            v_unit, 'import', true, true)
    RETURNING id INTO v_recipe_id;

    INSERT INTO menu_item (account_id, brand_id, channel_id, recipe_item_id, name, price,
                           product_type, external_source, external_id, source, needs_review)
    VALUES (p_account_id, v_brand_id, NULL, v_recipe_id,
            coalesce(nullif(btrim(v_cat_name),''), p_product_name),
            coalesce(v_cat_price,0)::numeric / 100.0,
            'item', 'lastapp', v_matricula, 'import', true)
    RETURNING id INTO v_menu_item;
  END IF;

  menu_item_id := v_menu_item; recipe_item_id := v_recipe_id; brand_id := v_brand_id;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public._resolve_unmapped_link_core(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._resolve_unmapped_link_core(uuid,text,uuid) FROM anon, authenticated;

-- ── VERSION ACOTADA, la unica que conocera la bandeja ────────────────────
-- resolve_unmapped_sales('link') termina llamando a recast_lastapp_sales, que
-- reprocesa TODAS las ventas de Last de la cuenta sin ventana: 7.196 ventas
-- desde el 12-06 en Foodint, regenerando consumo con fechas viejas contra 98
-- conteos aprobados. Es A3 a escala 11x.
--
-- Esta version reprocesa SOLO las ventas del producto casado que son
-- POSTERIORES al ultimo conteo aprobado de su local. Lo anterior ya lo absorbio
-- el ajuste de aquel conteo: meterlo otra vez seria doble descuento.
-- Ir mas atras exige p_include_before_last_count = true (segunda confirmacion
-- explicita) y despues hay que reanclar con reanchor_counted_adjustments.
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
  v_norm text; v_core record; r record;
  v_repro integer := 0; v_prot integer := 0; v_eur numeric := 0;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'resolve_unmapped_sales_scoped: sin acceso a la cuenta %', p_account_id;
  END IF;
  IF p_action NOT IN ('link','ignore','delist') THEN
    RAISE EXCEPTION 'resolve_unmapped_sales_scoped: acción inválida %', p_action;
  END IF;

  -- ignore / delist no reprocesan nada: se delega tal cual.
  IF p_action IN ('ignore','delist') THEN
    RETURN QUERY
      SELECT r2.resultado, r2.menu_item_id, r2.recipe_item_id, r2.brand_id,
             0, 0, 0::numeric
        FROM public.resolve_unmapped_sales(p_account_id, p_product_name, p_action, p_reason, p_brand_id) r2;
    RETURN;
  END IF;

  v_norm := public.sales_product_norm(p_product_name);

  SELECT * INTO v_core
    FROM public._resolve_unmapped_link_core(p_account_id, p_product_name, p_brand_id);

  -- Ventas de ESTE producto, clasificadas por el corte del ultimo conteo
  -- aprobado de su local.
  FOR r IN
    SELECT DISTINCT s.id, s.sold_at, s.location_id,
           (SELECT max(coalesce(ic.closed_at, ic.created_at))
              FROM inventory_count ic
             WHERE ic.location_id = s.location_id AND ic.status = 'aprobado') AS corte,
           (SELECT coalesce(sum(sl2.quantity * coalesce(sl2.unit_price,0)),0)
              FROM sale_line sl2 WHERE sl2.sale_id = s.id
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

  resultado := 'linked'; menu_item_id := v_core.menu_item_id;
  recipe_item_id := v_core.recipe_item_id; brand_id := v_core.brand_id;
  ventas_reprocesadas := v_repro; ventas_protegidas := v_prot;
  euros_protegidos := round(v_eur, 2);
  RETURN NEXT;
END;
$function$;

-- ── La original pasa a delegar en el nucleo. Comportamiento IDENTICO. ────
CREATE OR REPLACE FUNCTION public.resolve_unmapped_sales(
  p_account_id uuid, p_product_name text, p_action text,
  p_reason text DEFAULT NULL::text, p_brand_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(resultado text, menu_item_id uuid, recipe_item_id uuid, brand_id uuid, lineas_afectadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text; v_afect integer := 0; v_core record;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'resolve_unmapped_sales: sin acceso a la cuenta %', p_account_id;
  END IF;
  IF p_action NOT IN ('link','ignore','delist') THEN
    RAISE EXCEPTION 'resolve_unmapped_sales: acción inválida %', p_action;
  END IF;

  v_norm := public.sales_product_norm(p_product_name);

  IF p_action IN ('ignore','delist') THEN
    UPDATE sale_line sl
    SET unmapped_reason = CASE WHEN p_action = 'ignore' THEN 'ignored' ELSE 'delisted' END,
        ignore_reason = nullif(btrim(coalesce(p_reason,'')), ''),
        ignored_at = now(), map_needs_review = false, updated_at = now()
    FROM sale s
    WHERE sl.sale_id = s.id AND sl.account_id = p_account_id AND s.source = 'lastapp'
      AND sl.menu_item_id IS NULL AND coalesce(sl.line_type,'product') = 'product'
      AND sl.map_source <> 'manual'
      AND (p_brand_id IS NULL OR s.brand_id = p_brand_id)
      AND public.sales_product_norm(sl.product_name) = v_norm;
    GET DIAGNOSTICS v_afect = ROW_COUNT;
    RETURN QUERY SELECT CASE WHEN p_action='ignore' THEN 'ignored' ELSE 'delisted' END,
                        NULL::uuid, NULL::uuid, p_brand_id, v_afect;
    RETURN;
  END IF;

  SELECT * INTO v_core
    FROM public._resolve_unmapped_link_core(p_account_id, p_product_name, p_brand_id);

  -- Recast GLOBAL, como siempre. Ojo: reprocesa todas las ventas de Last de la
  -- cuenta. Para la bandeja usa resolve_unmapped_sales_scoped.
  PERFORM public.recast_lastapp_sales(p_account_id);

  SELECT count(*) INTO v_afect
  FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND sl.menu_item_id = v_core.menu_item_id
    AND public.sales_product_norm(sl.product_name) = v_norm;

  RETURN QUERY SELECT 'linked'::text, v_core.menu_item_id, v_core.recipe_item_id,
                      v_core.brand_id, v_afect;
END;
$function$;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='resolve_unmapped_sales_scoped') then
    raise exception 'Falta resolve_unmapped_sales_scoped';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='resolve_unmapped_sales'
                   and pg_get_functiondef(p.oid) like '%_resolve_unmapped_link_core%') then
    raise exception 'resolve_unmapped_sales no delega en el nucleo';
  end if;
end $$;