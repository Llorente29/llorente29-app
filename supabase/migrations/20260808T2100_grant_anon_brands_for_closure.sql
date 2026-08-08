-- FIX: "KDS · brands_for_closure: permission denied for function brands_for_closure"
-- en la Estacion de tablet (app.folvy.app/estacion, pestaña Disponibilidad -> Cerrar marca).
--
-- CAUSA: la Estacion funciona SIN login, asi que el cliente entra como rol `anon`.
-- Las 6 RPC by-token de la Estacion (availability_panel_by_token, orders_feed_by_token,
-- set_product_availability_by_token, search_products_by_token, preview_scope_by_token,
-- device_location_by_token) tienen GRANT EXECUTE a anon. brands_for_closure NO lo recibio
-- al crearse: solo authenticated/service_role/postgres. De ahi el permission denied.
--
-- SEGURIDAD: no abre nada. La funcion es SECURITY DEFINER y valida internamente:
--   - con p_token: resuelve kds_resolve_device y LANZA EXCEPCION si el token no es valido
--   - con p_account_id: exige current_user_is_admin() o current_user_is_admin_or_manager_of()
-- Es exactamente el mismo patron de las otras seis.

GRANT EXECUTE ON FUNCTION public.brands_for_closure(uuid, text) TO anon;

DO $g$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
     WHERE routine_schema='public' AND routine_name='brands_for_closure'
       AND grantee='anon' AND privilege_type='EXECUTE'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'el grant a anon no quedo aplicado';
  END IF;
END $g$;

NOTIFY pgrst, 'reload schema';
