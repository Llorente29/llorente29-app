-- 20260602T2200_connector_secret_functions.sql
-- D2.2a — Funciones wrapper para gestionar credenciales de conectores en Supabase Vault.
--
-- POR QUÉ WRAPPERS: supabase-js solo llama funciones del esquema `public` vía rpc;
-- no puede llamar a vault.create_secret directamente, y exponer el esquema `vault`
-- sería inseguro. Estas funciones SECURITY DEFINER en `public` encapsulan el acceso
-- a Vault, son atómicas (cifrar + guardar referencia en una operación) y están
-- restringidas a service_role (las llama la Edge Function connector-credentials).
--
-- SEGURIDAD:
--   - SECURITY DEFINER: corren con privilegios del owner (acceso a vault).
--   - REVOKE a public/anon/authenticated; GRANT solo a service_role.
--   - El gating de rol (admin/manager de la cuenta) se valida DENTRO con p_user_id
--     (la Edge Function valida el JWT y pasa el user_id; NO se usa auth.uid()
--     porque la Edge Function corre con service_role, no con el JWT del usuario).
--   - El secreto se cifra vía vault.create_secret/update_secret (NUNCA INSERT crudo).
--   - connector_secret_status NUNCA devuelve el valor del secreto, solo si existe.
--
-- Aplicada: 2026-06-02 en Supabase (proyecto xzmpnchlguibclvxyynt).
-- Ref: docs/folvy_d2_cifrado_credenciales_diseno.md
-- IMPORTANTE: NO probar (SELECT) estas funciones en el SQL Editor (auth.uid() null
-- y SECURITY DEFINER). Verificar desde la app / Edge Function.

-- ─────────────────────────────────────────────────────────────────────
-- Helper interno: ¿es p_user_id admin o manager (activo) de la cuenta dueña
-- de esta conexión? Devuelve el account_id si OK; lanza excepción si no.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.connector_assert_manager(
  p_account_connector_id uuid,
  p_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_account_id uuid;
  v_ok boolean;
BEGIN
  -- Cuenta dueña de la conexión.
  SELECT account_id INTO v_account_id
  FROM public.account_connector
  WHERE id = p_account_connector_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Conexión % no encontrada', p_account_connector_id;
  END IF;

  -- ¿El usuario es admin/manager ACTIVO de esa cuenta?
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.user_id = p_user_id
      AND up.account_id = v_account_id
      AND up.active = true
      AND up.role IN ('admin', 'manager')
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Sin permiso: el usuario no es admin/manager de la cuenta';
  END IF;

  RETURN v_account_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- save: cifra el secreto (JSON con los campos sensibles) en Vault, guarda
-- el uuid en credentials_ref, los campos no sensibles en config, y marca
-- la conexión como conectada. Si ya había credentials_ref, ACTUALIZA el
-- secreto existente en vez de crear uno nuevo.
-- Devuelve void (la Edge Function consulta status aparte si lo necesita).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.connector_secret_save(
  p_account_connector_id uuid,
  p_user_id uuid,
  p_secret_json text,
  p_config jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_account_id uuid;
  v_existing_ref text;
  v_secret_id uuid;
  v_secret_name text;
BEGIN
  -- Gating de rol (lanza si no autorizado).
  v_account_id := public.connector_assert_manager(p_account_connector_id, p_user_id);

  -- Nombre único del secreto en Vault (legible para auditoría, sin el valor).
  v_secret_name := 'connector:' || p_account_connector_id::text;

  SELECT credentials_ref INTO v_existing_ref
  FROM public.account_connector
  WHERE id = p_account_connector_id;

  IF v_existing_ref IS NOT NULL THEN
    -- Actualiza el secreto existente.
    PERFORM vault.update_secret(v_existing_ref::uuid, p_secret_json, v_secret_name, NULL);
    v_secret_id := v_existing_ref::uuid;
  ELSE
    -- Crea uno nuevo y obtiene su uuid.
    v_secret_id := vault.create_secret(p_secret_json, v_secret_name, 'Credenciales de conector Folvy');
  END IF;

  -- Guarda referencia + config no sensible + estado.
  UPDATE public.account_connector
  SET credentials_ref = v_secret_id::text,
      config = COALESCE(p_config, config),
      status = 'connected',
      connected_at = now(),
      connected_by = p_user_id,
      updated_at = now()
  WHERE id = p_account_connector_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- status: ¿hay credenciales guardadas? NO devuelve el valor, solo booleano.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.connector_secret_status(
  p_account_connector_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ref text;
BEGIN
  PERFORM public.connector_assert_manager(p_account_connector_id, p_user_id);

  SELECT credentials_ref INTO v_ref
  FROM public.account_connector
  WHERE id = p_account_connector_id;

  RETURN v_ref IS NOT NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- clear: borra el secreto de Vault y limpia la referencia. Marca la
-- conexión como 'paused' (desconectada pero no archivada).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.connector_secret_clear(
  p_account_connector_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ref text;
BEGIN
  PERFORM public.connector_assert_manager(p_account_connector_id, p_user_id);

  SELECT credentials_ref INTO v_ref
  FROM public.account_connector
  WHERE id = p_account_connector_id;

  IF v_ref IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_ref::uuid;
  END IF;

  UPDATE public.account_connector
  SET credentials_ref = NULL,
      status = 'paused',
      updated_at = now()
  WHERE id = p_account_connector_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Permisos: revocar de todos, conceder SOLO a service_role.
-- (Las llama la Edge Function connector-credentials, que corre con service_role.)
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.connector_assert_manager(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.connector_secret_save(uuid, uuid, text, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.connector_secret_status(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.connector_secret_clear(uuid, uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.connector_secret_save(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.connector_secret_status(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.connector_secret_clear(uuid, uuid) TO service_role;
