-- 20260729T1500_hubrise_writer_token.sql
-- HubRise: conexión "Folvy escritor" (Fase 1) — token OAuth con scope
-- account[all_catalogs.write,inventory.write], EN VAULT (nunca en claro).
-- ============================================================================
-- POR QUÉ: hoy Folvy publica catálogo (hubrise-catalog-publish) y empuja 86
-- (availability-dispatch) usando los tokens de los BRIDGES de cada plataforma
-- (external_integration.access_token, en claro), que son de solo lectura para
-- catálogo/inventario -> 403 en Glovo/JustEat (confirmado en vivo, Bendito
-- Burrito). La conexión "Folvy escritor" es una conexión OAuth PROPIA, por
-- CUENTA Folvy (multi-tenant), que sí tiene permiso de escribir.
--
-- MOLDE: mismo patrón que public.connector_secret_save/read (D2.2,
-- 20260602T2200_connector_secret_functions.sql + 20260625T1900_connector_secret_read.sql):
-- SECURITY DEFINER, search_path=public,vault, vault.create_secret/update_secret/
-- decrypted_secrets, REVOKE ALL + GRANT solo a service_role. NO se reutiliza
-- account_connector (tabla de otro módulo -I1, conectores de reparto- con otra
-- clave: id de conexión, no account_id) -> tabla propia, keyed por account_id.
--
-- SIN gating de rol de manager (a diferencia de connector_secret_save): aquí no
-- hay sesión de usuario Folvy en el momento de guardar -- el que autoriza es
-- HubRise tras el consentimiento OAuth. La puerta es (a) el nonce de
-- hubrise_oauth_state, de un solo uso y con caducidad, validado en el Edge
-- hubrise-oauth-callback, y (b) que ambas funciones están revocadas para
-- anon/authenticated: solo service_role (nuestras Edge Functions) puede llamarlas.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- hubrise_oauth_state: nonce de un solo uso para el "state" del authorize.
-- hubrise-oauth-start inserta la fila; hubrise-oauth-callback la consume
-- (borra) y valida antigüedad (<15 min) antes de aceptar el code.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hubrise_oauth_state (
  nonce      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.hubrise_oauth_state FROM public, anon, authenticated;
GRANT ALL ON TABLE public.hubrise_oauth_state TO service_role;

-- RLS deny-all (sin políticas): service_role la salta (bypassrls), es la única
-- defensa que importa aquí; esto es cinturón y tirantes por si algún día se
-- concede GRANT de más a anon/authenticated por error.
ALTER TABLE public.hubrise_oauth_state ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────
-- hubrise_writer_connection: 1 fila por cuenta Folvy con conexión escritor.
-- credentials_ref = uuid del secreto en Vault (nunca el token en esta tabla).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hubrise_writer_connection (
  account_id        uuid PRIMARY KEY,
  hubrise_account_id text,
  credentials_ref   text,
  connected_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.hubrise_writer_connection FROM public, anon, authenticated;
GRANT ALL ON TABLE public.hubrise_writer_connection TO service_role;

-- RLS deny-all (sin políticas), mismo motivo que hubrise_oauth_state arriba.
ALTER TABLE public.hubrise_writer_connection ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────
-- hubrise_writer_token_save: crea/actualiza el secreto en Vault y la fila
-- de hubrise_writer_connection. Llamada por hubrise-oauth-callback tras
-- intercambiar code->token con HubRise. Idempotente (re-autorizar rota el
-- token existente en vez de duplicar el secreto).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hubrise_writer_token_save(
  p_account_id uuid,
  p_access_token text,
  p_hubrise_account_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_existing_ref text;
  v_secret_id uuid;
  v_secret_name text;
BEGIN
  IF p_account_id IS NULL OR p_access_token IS NULL OR length(p_access_token) = 0 THEN
    RAISE EXCEPTION 'hubrise_writer_token_save: p_account_id y p_access_token son obligatorios';
  END IF;

  v_secret_name := 'hubrise-writer:' || p_account_id::text;

  SELECT credentials_ref INTO v_existing_ref
  FROM public.hubrise_writer_connection
  WHERE account_id = p_account_id;

  IF v_existing_ref IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_ref::uuid, p_access_token, v_secret_name, NULL);
    v_secret_id := v_existing_ref::uuid;
  ELSE
    v_secret_id := vault.create_secret(p_access_token, v_secret_name, 'Token escritor HubRise (Folvy) por cuenta');
  END IF;

  INSERT INTO public.hubrise_writer_connection (account_id, hubrise_account_id, credentials_ref, connected_at, updated_at)
  VALUES (p_account_id, p_hubrise_account_id, v_secret_id::text, now(), now())
  ON CONFLICT (account_id) DO UPDATE
    SET hubrise_account_id = EXCLUDED.hubrise_account_id,
        credentials_ref = EXCLUDED.credentials_ref,
        connected_at = now(),
        updated_at = now();
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- hubrise_writer_token_read: devuelve el token en claro (o NULL si no hay
-- conexión escritor para esa cuenta). Llamada por resolveWriterToken desde
-- hubrise-catalog-publish / availability-dispatch.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hubrise_writer_token_read(
  p_account_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_ref text;
  v_token text;
BEGIN
  SELECT credentials_ref INTO v_ref
  FROM public.hubrise_writer_connection
  WHERE account_id = p_account_id;

  IF v_ref IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE id = v_ref::uuid;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.hubrise_writer_token_save(uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.hubrise_writer_token_read(uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.hubrise_writer_token_save(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hubrise_writer_token_read(uuid) TO service_role;

notify pgrst, 'reload schema';
