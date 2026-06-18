-- ============================================================================
-- 20260618T1210_pricing_admin_rpcs.sql
-- CAPA DE PRECIOS · P-B (datos): RPCs para editar el catálogo de precios.
--
--   · list_pricing()                          -> jsonb {plans:[], addons:[]}
--   · set_plan_pricing(id, base, per_loc, max) -> edita un plan + audita
--   · set_submodule_price(id, price)           -> edita un add-on + audita
--
-- Gated a platform admin. Auditados como 'system_config_changed' (los cambios de
-- precio son sensibles: quedan en Auditoría con quién y qué). auth.uid() presente
-- desde la app -> el actor se resuelve bien. DDL puro -> seguro en SQL Editor;
-- los RPC se prueban desde la app.
-- ============================================================================

-- ── Leer el catálogo de precios ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_pricing()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo platform admins.';
  END IF;

  v := jsonb_build_object(
    'plans', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'name', name,
        'base_price_eur', base_price_eur,
        'per_location_price', per_location_price,
        'max_locations', max_locations,
        'billing_cycle', billing_cycle
      ) ORDER BY sort_order), '[]'::jsonb)
      FROM billing_plans),
    'addons', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', sm.id, 'code', sm.code, 'name', sm.name,
        'module', m.name, 'price_eur', sm.price_eur
      ) ORDER BY m.sort_order, sm.sort_order), '[]'::jsonb)
      FROM submodules sm
      JOIN modules m ON m.id = sm.module_id
      WHERE sm.type = 'addon' AND sm.status = 'active')
  );
  RETURN v;
END;
$function$;

-- ── Editar precios de un plan ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_plan_pricing(
  p_plan_id uuid,
  p_base_price_eur numeric,
  p_per_location_price numeric,
  p_max_locations integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old billing_plans%ROWTYPE;
BEGIN
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo platform admins.';
  END IF;
  IF p_base_price_eur < 0 OR p_per_location_price < 0 OR p_max_locations < 0 THEN
    RAISE EXCEPTION 'Los precios y el máximo de locales no pueden ser negativos.';
  END IF;

  SELECT * INTO v_old FROM billing_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan no encontrado.'; END IF;

  UPDATE billing_plans
  SET base_price_eur     = p_base_price_eur,
      per_location_price = p_per_location_price,
      max_locations      = p_max_locations,
      updated_at         = now()
  WHERE id = p_plan_id;

  PERFORM log_platform_event(
    'system_config_changed', NULL, NULL,
    jsonb_build_object(
      'config', 'plan_pricing', 'plan', v_old.code,
      'from', jsonb_build_object('base', v_old.base_price_eur, 'per_location', v_old.per_location_price, 'max_locations', v_old.max_locations),
      'to',   jsonb_build_object('base', p_base_price_eur, 'per_location', p_per_location_price, 'max_locations', p_max_locations)));
END;
$function$;

-- ── Editar el precio de un add-on ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_submodule_price(p_submodule_id uuid, p_price_eur numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code  text;
  v_type  text;
  v_old   numeric;
BEGIN
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo platform admins.';
  END IF;
  IF p_price_eur < 0 THEN
    RAISE EXCEPTION 'El precio no puede ser negativo.';
  END IF;

  SELECT code, type, price_eur INTO v_code, v_type, v_old FROM submodules WHERE id = p_submodule_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submódulo no encontrado.'; END IF;
  IF v_type <> 'addon' THEN
    RAISE EXCEPTION 'Solo los add-ons tienen precio propio (este es un tier del plan).';
  END IF;

  UPDATE submodules SET price_eur = p_price_eur, updated_at = now() WHERE id = p_submodule_id;

  PERFORM log_platform_event(
    'system_config_changed', NULL, NULL,
    jsonb_build_object('config', 'addon_price', 'addon', v_code, 'from', v_old, 'to', p_price_eur));
END;
$function$;
