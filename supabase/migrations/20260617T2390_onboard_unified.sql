-- ============================================================================
-- 20260617T2390_onboard_unified.sql
-- UNE las dos vías de alta en UNA sola, completa y atómica:
--   formulario(plan) -> create-account -> create_account_tx -> onboard_account
--
-- 1) onboard_account gana p_status (trial|active) para crear la suscripción con
--    el estado comercial correcto (antes hardcodeaba 'trialing', que ni siquiera
--    es el valor que usa el sistema: usa 'trial'/'active'). Cambia la firma
--    (3->4 args) => DROP de la sobrecarga vieja ANTES (lección SECURITY DEFINER).
-- 2) create_account_tx deja de sembrar subscription_items desde la lista
--    hardcodeada del formulario y LLAMA a onboard_account con el plan. Mantiene
--    su firma (no rompe la Edge Function create-account). p_submodule_ids pasa a
--    ser override opcional (add-ons sueltos sobre el plan).
--
-- onboard_account es idempotente: la location y la suscripción que crea
-- create_account_tx NO se duplican (las detecta). Resultado: cliente completo
-- en una transacción. Tras correr: regen database.ts.
-- ============================================================================

-- ── 1) onboard_account con p_status (DROP de la firma vieja de 3 args) ────────
DROP FUNCTION IF EXISTS public.onboard_account(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.onboard_account(
  p_account_id    uuid,
  p_plan_code     text DEFAULT 'professional',
  p_admin_user_id uuid DEFAULT NULL,
  p_status        text DEFAULT 'trial'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan         billing_plans%ROWTYPE;
  v_status       text;
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
  v_status := CASE WHEN p_status IN ('active','trial') THEN p_status ELSE 'trial' END;

  -- Unidades base GLOBALES por dimensión (account_id IS NULL).
  SELECT id INTO v_unit_weight FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='weight' LIMIT 1;
  SELECT id INTO v_unit_volume FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='volume' LIMIT 1;
  SELECT id INTO v_unit_unit   FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='unit'   LIMIT 1;
  IF v_unit_weight IS NULL OR v_unit_volume IS NULL OR v_unit_unit IS NULL THEN
    RAISE EXCEPTION 'Faltan unidades base globales (weight/volume/unit)';
  END IF;

  -- ── 1) SUSCRIPCIÓN (con estado comercial; idempotente) ──────────────────────
  SELECT * INTO v_plan FROM billing_plans WHERE code = p_plan_code;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Plan % no existe', p_plan_code; END IF;

  SELECT id INTO v_sub_id FROM subscriptions WHERE account_id = p_account_id LIMIT 1;
  IF v_sub_id IS NULL THEN
    INSERT INTO subscriptions (account_id, plan_id, status, billing_cycle,
                               trial_ends_at, current_period_start, current_period_end)
    VALUES (p_account_id, v_plan.id, v_status, COALESCE(v_plan.billing_cycle,'monthly'),
            CASE WHEN v_status='trial'
                 THEN now() + (COALESCE(v_plan.trial_days,14)||' days')::interval
                 ELSE NULL END,
            now(), now() + interval '1 month')
    RETURNING id INTO v_sub_id;

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

  -- ── 3) KITCHEN_SETTINGS ─────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM kitchen_settings WHERE account_id = p_account_id) THEN
    INSERT INTO kitchen_settings (
      account_id, currency, cost_strategy_default, cost_window_days_default,
      indirect_cost_pct_default, allow_negative_yield, price_rounding,
      ai_default_model, ai_escalation_enabled, transcription_language,
      audit_mode_default, audit_threshold_default, audit_shadow_min_samples,
      reliability_min_pct, max_recipe_depth_warning, version_alert_pct, photo_retention_days
    ) VALUES (
      p_account_id, 'EUR', 'avg_window', 30,
      0, false, 'none',
      'claude-sonnet-4-6', true, 'es',
      'shadow', 0.15, 5,
      70, 6, 20, 365
    );
  END IF;

  -- ── 4) STORAGE_AREA por defecto ─────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM storage_area WHERE account_id = p_account_id) THEN
    INSERT INTO storage_area (account_id, location_id, name, position, active)
    VALUES (p_account_id, v_loc_id, 'Almacén principal', 0, true);
  END IF;

  -- ── 5) SALES_CHANNEL (Salón + plataformas + tienda) ─────────────────────────
  INSERT INTO sales_channel (account_id, name, slug, channel_type, is_active)
  SELECT p_account_id, x.name, x.slug, x.channel_type, true
  FROM (VALUES
    ('Salón',   'salon',   'dine_in'),
    ('Glovo',   'glovo',   'delivery'),
    ('JustEat', 'justeat', 'delivery'),
    ('Uber',    'uber',    'delivery'),
    ('Shop',    'shop',    'takeaway')
  ) AS x(name, slug, channel_type)
  WHERE NOT EXISTS (
    SELECT 1 FROM sales_channel sc WHERE sc.account_id = p_account_id AND sc.slug = x.slug
  );
  GET DIAGNOSTICS v_n_chan = ROW_COUNT;

  -- ── 6) FAMILIAS DE PLATO desde dish_family_template ─────────────────────────
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
    IF EXISTS (
      SELECT 1 FROM recipe_item ri
      WHERE ri.account_id = p_account_id AND ri.template_code = v_tpl.code
    ) THEN CONTINUE; END IF;

    v_base_unit := CASE lower(COALESCE(v_tpl.default_base_dimension,'weight'))
                     WHEN 'volume' THEN v_unit_volume
                     WHEN 'unit'   THEN v_unit_unit
                     ELSE v_unit_weight
                   END;

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
      -- recipe_item.cost_strategy exige 'average_window'; kitchen_settings usa
      -- 'avg_window'. Traducir para no violar el CHECK de recipe_item.
      CASE (SELECT cost_strategy_default FROM kitchen_settings WHERE account_id = p_account_id)
        WHEN 'avg_window' THEN 'average_window'
        WHEN 'last_purchase' THEN 'last_purchase'
        WHEN 'fixed' THEN 'fixed'
        ELSE 'average_window'
      END,
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

  -- ── 9) USUARIO ADMIN (idempotente; create_account_tx ya pudo crearlo) ───────
  IF p_admin_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_profiles WHERE account_id = p_account_id AND user_id = p_admin_user_id
    ) THEN
      INSERT INTO user_profiles (account_id, user_id, role, active)
      VALUES (p_account_id, p_admin_user_id, 'admin', true);
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'account_id', p_account_id, 'plan', p_plan_code, 'status', v_status,
    'subscription_id', v_sub_id, 'location_id', v_loc_id,
    'channels_seeded', v_n_chan, 'dish_families_seeded', v_n_dish_fam,
    'ingredients_seeded', v_n_items, 'allergens_seeded', v_n_alg,
    'admin_linked', (p_admin_user_id IS NOT NULL)
  );
  RETURN v_result;
END;
$function$;


-- ── 2) create_account_tx: misma firma, nuevo cuerpo (llama a onboard_account) ─
CREATE OR REPLACE FUNCTION public.create_account_tx(
  p_account_name text, p_account_slug text, p_admin_user_id uuid,
  p_admin_display_name text, p_location_name text, p_brand_name text,
  p_brand_slug text, p_submodule_ids uuid[], p_plan_id uuid,
  p_status text, p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id        uuid;
  v_user_profile_id   uuid;
  v_gerente_total_id  uuid;
  v_platform_admin_id uuid;
  v_plan_code         text;
  v_sub_id            uuid;
  v_sm                uuid;
BEGIN
  SELECT id INTO v_platform_admin_id
  FROM platform_admins WHERE user_id = p_created_by AND active = true LIMIT 1;
  IF v_platform_admin_id IS NULL THEN
    RAISE EXCEPTION 'No existe platform_admin activo para user_id %', p_created_by;
  END IF;

  SELECT id INTO v_gerente_total_id
  FROM permission_sets WHERE name = 'gerente_total' AND is_system = true AND account_id IS NULL LIMIT 1;
  IF v_gerente_total_id IS NULL THEN
    RAISE EXCEPTION 'No existe el permission_set global gerente_total';
  END IF;

  -- Cuenta (dispara triggers AFTER INSERT: appcc, familias ingrediente, gestoría, vacaciones).
  INSERT INTO accounts (name, slug, status, country, created_by)
  VALUES (p_account_name, p_account_slug, p_status, 'ES', p_created_by)
  RETURNING id INTO v_account_id;

  -- Perfil admin + permisos.
  INSERT INTO user_profiles (user_id, account_id, role, active, display_name)
  VALUES (p_admin_user_id, v_account_id, 'admin', true, p_admin_display_name)
  RETURNING id INTO v_user_profile_id;
  INSERT INTO permission_set_assignments (user_profile_id, permission_set_id, assigned_by)
  VALUES (v_user_profile_id, v_gerente_total_id, p_created_by);

  -- Local inicial (nombre del formulario).
  INSERT INTO locations (name, account_id, active)
  VALUES (p_location_name, v_account_id, true);

  -- Marca inicial.
  INSERT INTO brand (account_id, name, slug, ownership_type, is_active)
  VALUES (v_account_id, p_brand_name, p_brand_slug, 'own', true);

  -- Resolver plan_id -> code (default professional si no llega o no existe).
  SELECT code INTO v_plan_code FROM billing_plans WHERE id = p_plan_id;
  IF v_plan_code IS NULL THEN v_plan_code := 'professional'; END IF;

  -- ONBOARDING COMPLETO (suscripción+items del plan, kitchen_settings, canales,
  -- familias de plato, siembra del master con alérgenos). Idempotente: no duplica
  -- la location/suscripción ya creadas aquí.
  PERFORM public.onboard_account(v_account_id, v_plan_code, p_admin_user_id, p_status);

  -- Override opcional: add-ons sueltos extra no incluidos en el plan.
  IF p_submodule_ids IS NOT NULL AND array_length(p_submodule_ids, 1) > 0 THEN
    SELECT id INTO v_sub_id FROM subscriptions WHERE account_id = v_account_id LIMIT 1;
    IF v_sub_id IS NOT NULL THEN
      FOREACH v_sm IN ARRAY p_submodule_ids LOOP
        INSERT INTO subscription_items (subscription_id, submodule_id, quantity, unit_price_eur, status)
        SELECT v_sub_id, v_sm, 1, 0, 'active'
        WHERE NOT EXISTS (
          SELECT 1 FROM subscription_items si
          WHERE si.subscription_id = v_sub_id AND si.submodule_id = v_sm
        );
      END LOOP;
    END IF;
  END IF;

  -- Auditoría.
  INSERT INTO platform_audit_log (platform_admin_id, event_type, target_account_id, target_user_id, details)
  VALUES (
    v_platform_admin_id, 'account_created', v_account_id, p_admin_user_id,
    jsonb_build_object('slug', p_account_slug, 'status', p_status, 'plan', v_plan_code, 'onboarded', true)
  );

  RETURN v_account_id;
END;
$function$;
