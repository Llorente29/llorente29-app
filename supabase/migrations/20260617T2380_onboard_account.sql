-- ============================================================================
-- 20260617T2380_onboard_account.sql
-- EL GRAN SALTO: onboard_account deja un cliente COMPLETO y operable, deuda 0.
--
-- Se llama A MANO tras crear la cuenta (el plan y el usuario admin son decisión
-- por cliente; lo universal —APPCC, vacaciones, gestoría, árbol de familias de
-- ingrediente— ya nace por trigger AFTER INSERT accounts).
--
--   SELECT public.onboard_account(
--     p_account_id   => '...',          -- cuenta ya creada
--     p_plan_code    => 'professional', -- starter | professional | enterprise
--     p_admin_user_id=> '...'           -- auth.users.id del admin (NULL si aún no)
--   );
--
-- Idempotente: cada bloque comprueba existencia; re-ejecutar no duplica.
-- SECURITY DEFINER (siembra multi-tabla); NO usa auth.uid() -> seguro fuera de
-- la transacción que la crea. Tras crear: regen database.ts (función nueva).
--
-- NO siembra (dato del cliente, no se inventa): brands, suppliers, escandallos,
-- recetas, menu_item, precios, proveedores. El acceso superadmin NO se siembra
-- (es transversal vía current_user_is_admin()).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.onboard_account(
  p_account_id    uuid,
  p_plan_code     text DEFAULT 'professional',
  p_admin_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan         billing_plans%ROWTYPE;
  v_sub_id       uuid;
  v_loc_id       uuid;
  v_unit_weight  uuid;
  v_unit_volume  uuid;
  v_unit_unit    uuid;
  v_sm           uuid;
  v_tpl          record;
  v_item_id      uuid;
  v_base_unit    uuid;
  v_fam_id       uuid;
  v_n_items      integer := 0;
  v_n_alg        integer := 0;
  v_alg_rows     integer := 0;
  v_n_dish_fam   integer := 0;
  v_n_chan       integer := 0;
  v_result       jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'Cuenta % no existe', p_account_id;
  END IF;

  -- Unidades base GLOBALES por dimensión (account_id IS NULL).
  SELECT id INTO v_unit_weight FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='weight' LIMIT 1;
  SELECT id INTO v_unit_volume FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='volume' LIMIT 1;
  SELECT id INTO v_unit_unit   FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='unit'   LIMIT 1;
  IF v_unit_weight IS NULL OR v_unit_volume IS NULL OR v_unit_unit IS NULL THEN
    RAISE EXCEPTION 'Faltan unidades base globales (weight/volume/unit)';
  END IF;

  -- ── 1) SUSCRIPCIÓN ─────────────────────────────────────────────────────────
  SELECT * INTO v_plan FROM billing_plans WHERE code = p_plan_code;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Plan % no existe', p_plan_code; END IF;

  SELECT id INTO v_sub_id FROM subscriptions WHERE account_id = p_account_id LIMIT 1;
  IF v_sub_id IS NULL THEN
    INSERT INTO subscriptions (account_id, plan_id, status, billing_cycle,
                               trial_ends_at, current_period_start, current_period_end)
    VALUES (p_account_id, v_plan.id, 'trialing', COALESCE(v_plan.billing_cycle,'monthly'),
            now() + (COALESCE(v_plan.trial_days,14)||' days')::interval,
            now(), now() + interval '1 month')
    RETURNING id INTO v_sub_id;

    -- Items = submódulos incluidos del plan.
    FOREACH v_sm IN ARRAY COALESCE(v_plan.included_submodules, '{}'::uuid[])
    LOOP
      INSERT INTO subscription_items (subscription_id, submodule_id, status, starts_at)
      VALUES (v_sub_id, v_sm, 'active', now())
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- ── 2) LOCATION POR DEFECTO (su trigger siembra estaciones de cocina) ───────
  SELECT id INTO v_loc_id FROM locations WHERE account_id = p_account_id LIMIT 1;
  IF v_loc_id IS NULL THEN
    INSERT INTO locations (account_id, name, active, is_billable, clock_geofence_mode, clock_radius_m)
    VALUES (p_account_id, 'Principal', true, true, 'warn', 200)
    RETURNING id INTO v_loc_id;
  END IF;

  -- ── 3) KITCHEN_SETTINGS (sin esto el motor de coste no opera) ───────────────
  IF NOT EXISTS (SELECT 1 FROM kitchen_settings WHERE account_id = p_account_id) THEN
    INSERT INTO kitchen_settings (
      account_id, currency, cost_strategy_default, cost_window_days_default,
      indirect_cost_pct_default, allow_negative_yield, price_rounding,
      ai_default_model, ai_escalation_enabled, transcription_language,
      audit_mode_default, audit_threshold_default, audit_shadow_min_samples,
      reliability_min_pct, max_recipe_depth_warning, version_alert_pct, photo_retention_days
    ) VALUES (
      p_account_id, 'EUR', 'average_window', 30,
      0, false, 'none',
      'claude-sonnet-4-6', true, 'es',
      'shadow', 0.15, 5,
      70, 6, 20, 365
    );
  END IF;

  -- ── 4) STORAGE_AREA por defecto (ligada a la location) ──────────────────────
  IF NOT EXISTS (SELECT 1 FROM storage_area WHERE account_id = p_account_id) THEN
    INSERT INTO storage_area (account_id, location_id, name, position, active)
    VALUES (p_account_id, v_loc_id, 'Almacén principal', 0, true);
  END IF;

  -- ── 5) SALES_CHANNEL (5 canales: Salón + plataformas + tienda) ──────────────
  INSERT INTO sales_channel (account_id, name, slug, channel_type, is_active)
  SELECT p_account_id, x.name, x.slug, x.channel_type, true
  FROM (VALUES
    ('Salón',  'salon',   'dine_in'),
    ('Glovo',   'glovo',   'delivery'),
    ('JustEat', 'justeat', 'delivery'),
    ('Uber',    'uber',    'delivery'),
    ('Shop',    'shop',    'takeaway')
  ) AS x(name, slug, channel_type)
  WHERE NOT EXISTS (
    SELECT 1 FROM sales_channel sc
    WHERE sc.account_id = p_account_id AND sc.slug = x.slug
  );
  GET DIAGNOSTICS v_n_chan = ROW_COUNT;

  -- ── 6) FAMILIAS DE PLATO desde dish_family_template (simetría con ingrediente)
  INSERT INTO recipe_family (account_id, scope, code, name, icon, position, template_id, is_active)
  SELECT p_account_id, 'dish', dft.code, dft.name_es, dft.icon, dft.position, dft.id, true
  FROM dish_family_template dft
  WHERE NOT EXISTS (
    SELECT 1 FROM recipe_family rf
    WHERE rf.account_id = p_account_id AND rf.scope = 'dish' AND rf.code = dft.code
  );
  GET DIAGNOSTICS v_n_dish_fam = ROW_COUNT;

  -- ── 7) SIEMBRA DEL MASTER (ingredient_template -> recipe_item type='raw') ────
  FOR v_tpl IN SELECT * FROM ingredient_template WHERE is_active LOOP
    -- ¿ya sembrado? (idempotente por template_code)
    IF EXISTS (
      SELECT 1 FROM recipe_item ri
      WHERE ri.account_id = p_account_id AND ri.template_code = v_tpl.code
    ) THEN CONTINUE; END IF;

    -- Unidad base por dimensión del master.
    v_base_unit := CASE lower(COALESCE(v_tpl.default_base_dimension,'weight'))
                     WHEN 'volume' THEN v_unit_volume
                     WHEN 'unit'   THEN v_unit_unit
                     ELSE v_unit_weight
                   END;

    -- Familia de la cuenta cuyo code = family_code del master (puede ser NULL).
    v_fam_id := NULL;
    IF nullif(v_tpl.family_code,'') IS NOT NULL THEN
      SELECT rf.id INTO v_fam_id FROM recipe_family rf
      WHERE rf.account_id = p_account_id AND rf.scope = 'ingredient' AND rf.code = v_tpl.family_code
      LIMIT 1;
    END IF;

    INSERT INTO recipe_item (
      account_id, name, type, source, base_unit_id, family_id,
      template_code, template_version,
      kitchen_photo_url, conservation_type, default_waste_pct,
      shelf_life_days, nutrition, cost_strategy, is_active,
      is_purchasable, is_stockable, is_sellable, needs_review
    ) VALUES (
      p_account_id, COALESCE(v_tpl.name_es, v_tpl.name_en, 'Ingrediente'), 'raw', 'template_global',
      v_base_unit, v_fam_id,
      v_tpl.code, v_tpl.version,
      v_tpl.photo_url, v_tpl.conservation_type, v_tpl.default_waste_pct,
      v_tpl.shelf_life_days, v_tpl.nutrition,
      (SELECT cost_strategy_default FROM kitchen_settings WHERE account_id = p_account_id),
      true, true, true, false, false
    ) RETURNING id INTO v_item_id;
    v_n_items := v_n_items + 1;

    -- ── 8) ALÉRGENOS heredados del master ─────────────────────────────────────
    INSERT INTO recipe_item_allergen (recipe_item_id, allergen_code, state, source)
    SELECT v_item_id, ita.allergen_code, ita.state, 'inherited'
    FROM ingredient_template_allergen ita
    WHERE ita.template_id = v_tpl.id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_alg_rows = ROW_COUNT;
    v_n_alg := v_n_alg + v_alg_rows;
  END LOOP;

  -- ── 9) USUARIO ADMIN (solo si se pasa user_id) ──────────────────────────────
  IF p_admin_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_profiles
      WHERE account_id = p_account_id AND user_id = p_admin_user_id
    ) THEN
      INSERT INTO user_profiles (account_id, user_id, role, active)
      VALUES (p_account_id, p_admin_user_id, 'admin', true);
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'account_id', p_account_id,
    'plan', p_plan_code,
    'subscription_id', v_sub_id,
    'location_id', v_loc_id,
    'channels_seeded', v_n_chan,
    'dish_families_seeded', v_n_dish_fam,
    'ingredients_seeded', v_n_items,
    'allergens_seeded', v_n_alg,
    'admin_linked', (p_admin_user_id IS NOT NULL)
  );
  RETURN v_result;
END;
$function$;
