-- ============================================================================
-- 20260617T2350_hubrise_adapter.sql
-- Adaptador canónico de HubRise (ingesta de pedidos).
--
-- Gemelo de adapt_lastapp_order pero con el formato de HubRise:
--   - items[]                          -> sale_line product / combo_item
--   - items[].options[]                -> sale_line modifier  (casa por option.ref)
--   - combos PLANOS: items con deal_line.deal_key agrupados bajo deals{key}{name,ref}
--   - matrícula = sku_ref (NO organizationProductId)
--   - precios "9.00 EUR" (NO céntimos /100)
--
-- Reutiliza SIN TOCAR: close_sale, cancel_sale, compute_sale_line_cost,
--   compute_sale_line_consumption (todas agnósticas de fuente).
--
-- Reglas aplicadas:
--   * DDL idempotente (IF NOT EXISTS / CREATE OR REPLACE). Sin BEGIN/COMMIT explícito
--     (SQL Editor). Sin SELECT de prueba (no se ejecuta SECURITY DEFINER aquí).
--   * Tras correr: regenerar src/types/database.ts (tablas + función nuevas).
-- ============================================================================


-- ── 1) Mapa de LOCATION genérico multi-fuente ────────────────────────────────
-- Gemelo de external_brand_map pero para resolver cuenta+local desde el id de
-- location externo. lastapp_location_map sigue intacto (migrarlo = limpieza
-- opcional, fuera de alcance). HubRise puebla source='hubrise'.
CREATE TABLE IF NOT EXISTS public.external_location_map (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source               text NOT NULL,                       -- 'hubrise' | 'otter' | ...
  external_location_id text NOT NULL,                        -- id de location en el proveedor
  account_id           uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  location_id          uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_location_id)
);

ALTER TABLE public.external_location_map ENABLE ROW LEVEL SECURITY;

-- RLS: la cuenta ve lo suyo; superadmin ve todo. Patrón current_user_account_ids
-- (mismo helper que usa external_brand_map / el resto de tablas multi-tenant).
DROP POLICY IF EXISTS external_location_map_select ON public.external_location_map;
CREATE POLICY external_location_map_select ON public.external_location_map
  FOR SELECT USING (account_id IN (SELECT public.current_user_account_ids()));

DROP POLICY IF EXISTS external_location_map_write ON public.external_location_map;
CREATE POLICY external_location_map_write ON public.external_location_map
  FOR ALL USING (account_id IN (SELECT public.current_user_account_ids()))
  WITH CHECK (account_id IN (SELECT public.current_user_account_ids()));


-- ── 2) Log de webhook genérico multi-fuente ──────────────────────────────────
-- Gemelo de lastapp_webhook_log pero con columna source. Auditoría + reproceso
-- desde el log si algo falló (igual que Last). No lleva RLS de cuenta (es traza
-- de frontera, escrita por service_role; sin lectura de cliente).
CREATE TABLE IF NOT EXISTS public.external_webhook_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  headers     jsonb,
  payload     jsonb,
  note        text,
  processed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS external_webhook_log_source_created_idx
  ON public.external_webhook_log (source, created_at DESC);


-- ── 3) Helper: parsear "9.00 EUR" -> 9.00 ────────────────────────────────────
-- HubRise da importes como string "<monto> <ISO4217>". Devuelve numeric en
-- unidades MAYORES (euros), nunca céntimos. NULL/'' -> 0.
CREATE OR REPLACE FUNCTION public.hubrise_money(p text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN p IS NULL OR btrim(p) = '' THEN 0
           ELSE COALESCE(NULLIF(split_part(btrim(p), ' ', 1), '')::numeric, 0)
         END;
$$;


-- ── 4) Motor canónico: adapt_hubrise_order(p_sale_id) ────────────────────────
CREATE OR REPLACE FUNCTION public.adapt_hubrise_order(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale        sale%ROWTYPE;
  v_acc         uuid;
  v_brand_ext   text;
  v_order       jsonb;
  v_items       jsonb;
  v_deals       jsonb;
  v_item        jsonb;
  v_mod         jsonb;
  v_deal        jsonb;
  v_deal_key    text;
  v_deal_keys   text[];
  v_parent_id   uuid;       -- línea padre (product standalone o combo)
  v_child_id    uuid;       -- línea combo_item
  v_menu        uuid;
  v_n_match     integer;
  v_matricula   text;       -- sku_ref del item / ref del deal
  v_mod_opt     uuid;
  v_norm        text;
  v_count       integer := 0;
  v_qty         numeric;
  v_price       numeric;
  v_reason      text;
  v_combo_matched boolean;
  v_deduced_brand uuid;
  v_deduced_menu  uuid;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_acc := v_sale.account_id;
  v_brand_ext := nullif(v_sale.external_brand_text, '');

  -- Guard de fuente: este motor solo procesa HubRise (raw en raw_tab).
  IF v_sale.source <> 'hubrise' OR v_sale.raw_tab IS NULL THEN RETURN 0; END IF;

  v_order := v_sale.raw_tab::jsonb;
  v_items := COALESCE(v_order->'items', '[]'::jsonb);
  v_deals := COALESCE(v_order->'deals', '{}'::jsonb);

  -- Borrar y reescribir SOLO nuestras líneas (preservar manuales / ignored / delisted).
  DELETE FROM sale_line
  WHERE sale_id = p_sale_id
    AND coalesce(map_source,'') <> 'manual'
    AND coalesce(unmapped_reason,'') NOT IN ('ignored','delisted');

  -- ──────────────────────────────────────────────────────────────────────────
  -- A) ITEMS STANDALONE (sin deal_line) -> product
  -- ──────────────────────────────────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    IF COALESCE(v_item->>'deleted','false') = 'true' THEN CONTINUE; END IF;
    -- Si pertenece a un deal, se procesa en el bloque de combos.
    IF jsonb_typeof(v_item->'deal_line') = 'object' THEN CONTINUE; END IF;

    v_qty       := COALESCE((v_item->>'quantity')::numeric, 1);
    v_price     := public.hubrise_money(v_item->>'price');
    v_matricula := nullif(v_item->>'sku_ref','');
    v_menu      := NULL;

    IF v_matricula IS NOT NULL THEN
      SELECT count(*) INTO v_n_match
      FROM menu_item mi
      WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
        AND mi.external_id = v_matricula AND mi.archived_at IS NULL;

      IF v_n_match = 1 THEN
        SELECT mi.id INTO v_menu FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
          AND mi.external_id = v_matricula AND mi.archived_at IS NULL
        LIMIT 1;
      ELSIF v_n_match > 1 AND v_sale.brand_id IS NOT NULL THEN
        SELECT mi.id INTO v_menu FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
          AND mi.external_id = v_matricula AND mi.archived_at IS NULL
          AND mi.brand_id = v_sale.brand_id
        LIMIT 1;
      END IF;
    END IF;

    IF v_menu IS NOT NULL THEN
      v_reason := NULL;
    ELSIF v_matricula IS NULL THEN
      v_reason := 'no_recipe';
    ELSE
      v_reason := 'no_menu_item';
    END IF;

    INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                           external_source, external_product_id, external_brand_id)
    VALUES (v_acc, p_sale_id, v_item->>'product_name', v_item->>'product_name', 'product',
            v_qty, v_price, v_price * v_qty, v_menu,
            CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
            (v_menu IS NULL), v_reason, NULL,
            'hubrise', v_matricula, v_brand_ext)
    RETURNING id INTO v_parent_id;
    v_count := v_count + 1;

    -- options[] -> modifiers del item standalone
    IF jsonb_typeof(v_item->'options') = 'array' THEN
      FOR v_mod IN SELECT * FROM jsonb_array_elements(v_item->'options')
      LOOP
        v_mod_opt := NULL;
        IF v_menu IS NOT NULL AND nullif(v_mod->>'ref','') IS NOT NULL THEN
          SELECT mo.id INTO v_mod_opt
          FROM modifier_group_assignment mga
          JOIN modifier_option mo ON mo.modifier_group_id = mga.modifier_group_id
          WHERE mga.menu_item_id = v_menu
            AND mo.external_id = (v_mod->>'ref')
          LIMIT 1;
        END IF;
        IF v_mod_opt IS NULL THEN
          v_norm := regexp_replace(regexp_replace(btrim(lower(public.unaccent(coalesce(v_mod->>'name','')))),'\.$',''),'\s+',' ','g');
          SELECT mo.id INTO v_mod_opt FROM modifier_option mo
          WHERE mo.account_id = v_acc
            AND regexp_replace(regexp_replace(btrim(lower(public.unaccent(mo.name))),'\.$',''),'\s+',' ','g') = v_norm
          LIMIT 1;
        END IF;

        INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, modifier_option_id,
                               map_source, map_needs_review, parent_sale_line_id,
                               external_source, external_product_id, external_brand_id)
        VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                COALESCE((v_mod->>'quantity')::numeric,1),
                public.hubrise_money(v_mod->>'price'),
                public.hubrise_money(v_mod->>'price'),
                v_mod_opt,
                CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_mod_opt IS NULL), v_parent_id,
                'hubrise', nullif(v_mod->>'ref',''), v_brand_ext);
        v_count := v_count + 1;
      END LOOP;
    END IF;
  END LOOP;

  -- ──────────────────────────────────────────────────────────────────────────
  -- B) COMBOS: agrupar items por deal_line.deal_key (combos planos de HubRise)
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT ARRAY(
    SELECT DISTINCT (it->'deal_line'->>'deal_key')
    FROM jsonb_array_elements(v_items) it
    WHERE jsonb_typeof(it->'deal_line') = 'object'
      AND COALESCE(it->>'deleted','false') <> 'true'
      AND nullif(it->'deal_line'->>'deal_key','') IS NOT NULL
  ) INTO v_deal_keys;

  FOREACH v_deal_key IN ARRAY COALESCE(v_deal_keys, '{}'::text[])
  LOOP
    v_deal      := v_deals->v_deal_key;            -- {name, ref}
    v_matricula := nullif(v_deal->>'ref','');
    v_menu      := NULL;
    v_combo_matched := false;

    -- 1) intentar casar el combo por ref (matrícula externa)
    IF v_matricula IS NOT NULL THEN
      SELECT count(*) INTO v_n_match FROM menu_item mi
      WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
        AND mi.external_id = v_matricula AND mi.archived_at IS NULL;
      IF v_n_match = 1 THEN
        SELECT mi.id INTO v_menu FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
          AND mi.external_id = v_matricula AND mi.archived_at IS NULL LIMIT 1;
      ELSIF v_n_match > 1 AND v_sale.brand_id IS NOT NULL THEN
        SELECT mi.id INTO v_menu FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
          AND mi.external_id = v_matricula AND mi.archived_at IS NULL
          AND mi.brand_id = v_sale.brand_id LIMIT 1;
      END IF;
    END IF;

    -- 2) si no casó por ref, intentar por nombre dentro de la marca del ticket
    IF v_menu IS NULL AND v_sale.brand_id IS NOT NULL THEN
      SELECT mi.id INTO v_menu FROM menu_item mi
      WHERE mi.account_id = v_acc AND mi.brand_id = v_sale.brand_id AND mi.archived_at IS NULL
        AND lower(public.unaccent(mi.name)) = lower(public.unaccent(coalesce(v_deal->>'name','')))
      LIMIT 1;
    END IF;

    v_combo_matched := (v_menu IS NOT NULL);

    IF v_menu IS NOT NULL THEN
      v_reason := NULL;
    ELSIF v_sale.brand_id IS NULL THEN
      v_reason := 'no_brand';
    ELSE
      v_reason := 'no_menu_item';
    END IF;

    -- línea PADRE del combo (anclaje del escandallo; coste por componentes)
    INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                           external_source, external_product_id, external_brand_id)
    VALUES (v_acc, p_sale_id, coalesce(v_deal->>'name','Combo'), coalesce(v_deal->>'name','Combo'), 'product',
            1, 0, 0, v_menu,
            CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
            (v_menu IS NULL), v_reason, NULL,
            'hubrise', v_matricula, v_brand_ext)
    RETURNING id INTO v_parent_id;
    v_count := v_count + 1;

    -- hijos: items con este deal_key -> combo_item (conservan su precio HubRise)
    FOR v_item IN
      SELECT it FROM jsonb_array_elements(v_items) it
      WHERE (it->'deal_line'->>'deal_key') = v_deal_key
        AND COALESCE(it->>'deleted','false') <> 'true'
    LOOP
      v_qty       := COALESCE((v_item->>'quantity')::numeric, 1);
      v_price     := public.hubrise_money(v_item->>'price');
      v_matricula := nullif(v_item->>'sku_ref','');
      v_menu      := NULL;

      IF v_matricula IS NOT NULL THEN
        SELECT count(*) INTO v_n_match FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
          AND mi.external_id = v_matricula AND mi.archived_at IS NULL;
        IF v_n_match = 1 THEN
          SELECT mi.id INTO v_menu FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
            AND mi.external_id = v_matricula AND mi.archived_at IS NULL LIMIT 1;
        ELSIF v_n_match > 1 AND v_sale.brand_id IS NOT NULL THEN
          SELECT mi.id INTO v_menu FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.external_source = 'hubrise'
            AND mi.external_id = v_matricula AND mi.archived_at IS NULL
            AND mi.brand_id = v_sale.brand_id LIMIT 1;
        END IF;
      END IF;

      IF v_menu IS NOT NULL THEN
        v_reason := NULL;
      ELSIF v_matricula IS NULL THEN
        v_reason := 'no_recipe';
      ELSE
        v_reason := 'no_menu_item';
      END IF;

      INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                             quantity, unit_price, line_total, menu_item_id,
                             map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                             external_source, external_product_id, external_brand_id)
      VALUES (v_acc, p_sale_id, v_item->>'product_name', coalesce(v_item->>'product_name','combo_item'), 'combo_item',
              v_qty, v_price, v_price * v_qty, v_menu,
              CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
              (v_menu IS NULL), v_reason, v_parent_id,
              'hubrise', v_matricula, v_brand_ext)
      RETURNING id INTO v_child_id;
      v_count := v_count + 1;

      -- options[] del hijo -> modifiers
      IF jsonb_typeof(v_item->'options') = 'array' THEN
        FOR v_mod IN SELECT * FROM jsonb_array_elements(v_item->'options')
        LOOP
          v_mod_opt := NULL;
          IF v_menu IS NOT NULL AND nullif(v_mod->>'ref','') IS NOT NULL THEN
            SELECT mo.id INTO v_mod_opt
            FROM modifier_group_assignment mga
            JOIN modifier_option mo ON mo.modifier_group_id = mga.modifier_group_id
            WHERE mga.menu_item_id = v_menu
              AND mo.external_id = (v_mod->>'ref')
            LIMIT 1;
          END IF;
          IF v_mod_opt IS NULL THEN
            v_norm := regexp_replace(regexp_replace(btrim(lower(public.unaccent(coalesce(v_mod->>'name','')))),'\.$',''),'\s+',' ','g');
            SELECT mo.id INTO v_mod_opt FROM modifier_option mo
            WHERE mo.account_id = v_acc
              AND regexp_replace(regexp_replace(btrim(lower(public.unaccent(mo.name))),'\.$',''),'\s+',' ','g') = v_norm
            LIMIT 1;
          END IF;

          INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                                 quantity, unit_price, line_total, modifier_option_id,
                                 map_source, map_needs_review, parent_sale_line_id,
                                 external_source, external_product_id, external_brand_id)
          VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                  COALESCE((v_mod->>'quantity')::numeric,1),
                  public.hubrise_money(v_mod->>'price'),
                  public.hubrise_money(v_mod->>'price'),
                  v_mod_opt,
                  CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                  (v_mod_opt IS NULL), v_child_id,
                  'hubrise', nullif(v_mod->>'ref',''), v_brand_ext);
          v_count := v_count + 1;
        END LOOP;
      END IF;
    END LOOP;

    -- Si el combo padre NO casó, deducir la marca de un hijo casado y reintentar
    -- por nombre (mismo patrón que adapt_lastapp_order: el combo se identifica
    -- por sus componentes).
    IF NOT v_combo_matched THEN
      SELECT mi.brand_id INTO v_deduced_brand
      FROM sale_line child
      JOIN menu_item mi ON mi.id = child.menu_item_id
      WHERE child.parent_sale_line_id = v_parent_id
        AND child.menu_item_id IS NOT NULL
      LIMIT 1;

      IF v_deduced_brand IS NOT NULL THEN
        SELECT mi.id INTO v_deduced_menu
        FROM menu_item mi
        WHERE mi.account_id = v_acc
          AND mi.brand_id = v_deduced_brand
          AND mi.archived_at IS NULL
          AND lower(public.unaccent(mi.name)) = lower(public.unaccent(coalesce(v_deal->>'name','')))
        LIMIT 1;

        IF v_deduced_menu IS NOT NULL THEN
          UPDATE sale_line
          SET menu_item_id = v_deduced_menu,
              map_source = 'pos',
              map_needs_review = false,
              unmapped_reason = NULL
          WHERE id = v_parent_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;


-- ── 5) reprocess_sale: DISPATCH por sale.source ──────────────────────────────
-- Antes llamaba a adapt_lastapp_order HARDCODED. Ahora elige el motor por la
-- fuente de la venta, para que el recast/re-vinculación funcione también con
-- HubRise (y cualquier futura fuente). Last queda IDÉNTICO.
-- NOTA: resolve_sale_brand_from_map solo se aplica a lastapp (su lógica es de
-- Last; en HubRise la marca la fija la frontera vía external_brand_map antes de
-- adaptar). Generalizar resolve_sale_brand_from_map a multi-fuente = deuda
-- declarada, disparador: re-resolver marca de HubRise desde la cola de
-- excepciones. No bloquea la ingesta (la frontera ya deja brand_id correcto).
CREATE OR REPLACE FUNCTION public.reprocess_sale(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_loc        uuid;
  v_source     text;
  v_line_id    uuid;
  v_item       uuid;
  v_old_items  uuid[];
  v_n          integer := 0;
BEGIN
  SELECT account_id, location_id, source INTO v_account_id, v_loc, v_source
  FROM sale WHERE id = p_sale_id;
  IF v_account_id IS NULL THEN RETURN 0; END IF;

  v_old_items := ARRAY(
    SELECT DISTINCT sm.recipe_item_id
    FROM stock_movement sm
    WHERE sm.account_id = v_account_id
      AND sm.movement_type = 'consumo'
      AND sm.source_type = 'sale'
      AND sm.source_id IN (SELECT id FROM sale_line WHERE sale_id = p_sale_id)
  );
  DELETE FROM stock_movement sm
  WHERE sm.account_id = v_account_id
    AND sm.movement_type = 'consumo'
    AND sm.source_type = 'sale'
    AND sm.source_id IN (SELECT id FROM sale_line WHERE sale_id = p_sale_id);

  -- 0.bis) Resolver la marca desde external_brand_map (solo Last; ver nota arriba).
  IF v_source = 'lastapp' THEN
    PERFORM public.resolve_sale_brand_from_map(p_sale_id);
  END IF;

  -- 1) Reconstruir las líneas canónicas con el motor de la fuente correcta.
  IF v_source = 'hubrise' THEN
    PERFORM public.adapt_hubrise_order(p_sale_id);
  ELSE
    PERFORM public.adapt_lastapp_order(p_sale_id);
  END IF;

  -- 2) Por cada línea product: coste y consumo.
  FOR v_line_id IN
    SELECT id FROM sale_line
    WHERE sale_id = p_sale_id AND line_type = 'product'
  LOOP
    PERFORM public.compute_sale_line_cost(v_line_id);
    PERFORM public.compute_sale_line_consumption(v_line_id);
    v_n := v_n + 1;
  END LOOP;

  -- 3) Recalcular el stock de los raws que solo tenían el consumo viejo.
  IF v_loc IS NOT NULL THEN
    FOREACH v_item IN ARRAY COALESCE(v_old_items, '{}'::uuid[])
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_loc);
    END LOOP;
  END IF;

  RETURN v_n;
END;
$function$;
