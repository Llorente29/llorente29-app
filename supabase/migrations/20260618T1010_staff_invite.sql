-- ============================================================================
-- 20260618T1010_staff_invite.sql
-- STAFF · Pieza B (datos): alta transaccional de un platform_admin.
--
-- La Edge Function create-platform-admin orquesta Auth (crear/encontrar el
-- usuario + welcome); la parte Postgres (atómica) vive aquí, igual que el alta
-- de cliente separa create-account (Auth) de create_account_tx (RPC).
--
--   · get_auth_user_id_by_email(email, created_by) -> uuid
--       Resuelve un usuario Auth ya existente por email (para reutilizarlo en
--       vez de duplicar). Verifica que el creador tiene manage_admins.
--   · create_platform_admin_tx(user_id, full_name, role, created_by) -> uuid
--       Inserta platform_admins + platform_admin_permissions (defaults del rol,
--       vía default_permissions_for_role de Staff-A) y audita admin_created.
--       Verifica manage_admins del creador (autoritativo, no depende de sesión).
--
-- Ambas reciben p_created_by explícito (la Edge Function corre con service_role,
-- donde auth.uid() es null), igual que create_account_tx. DDL puro -> seguro en
-- SQL Editor; los RPC NO se prueban aquí (manage_admins daría falso sin sesión).
-- ============================================================================

-- ── helper: ¿este usuario (por id) tiene manage_admins? (sin depender de sesión)
CREATE OR REPLACE FUNCTION public._user_can_manage_admins(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT pap.platform_can_manage_admins
    FROM platform_admins pa
    JOIN platform_admin_permissions pap ON pap.platform_admin_id = pa.id
    WHERE pa.user_id = p_user_id AND pa.active = true
    LIMIT 1
  ), false);
$function$;

-- ── Resolver usuario Auth existente por email ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email text, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT _user_can_manage_admins(p_created_by) THEN
    RAISE EXCEPTION 'Acceso denegado: requiere el permiso "Gestionar admins".';
  END IF;
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
  RETURN v_id;  -- NULL si no existe
END;
$function$;

-- ── Alta transaccional del platform_admin ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_platform_admin_tx(
  p_user_id   uuid,
  p_full_name text,
  p_role      text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_creator_admin_id uuid;
  v_new_admin_id     uuid;
  v_perms            jsonb;
BEGIN
  -- Autorización: el creador debe tener manage_admins.
  IF NOT _user_can_manage_admins(p_created_by) THEN
    RAISE EXCEPTION 'Acceso denegado: requiere el permiso "Gestionar admins".';
  END IF;
  SELECT id INTO v_creator_admin_id
  FROM platform_admins WHERE user_id = p_created_by AND active = true LIMIT 1;

  -- Validaciones.
  IF p_role NOT IN ('ceo','senior_admin','admin','support') THEN
    RAISE EXCEPTION 'Rol inválido: %', p_role;
  END IF;
  IF length(btrim(COALESCE(p_full_name,''))) < 2 THEN
    RAISE EXCEPTION 'El nombre del admin es obligatorio.';
  END IF;
  IF EXISTS (SELECT 1 FROM platform_admins WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Ese usuario ya es administrador de plataforma.';
  END IF;

  -- 1) Fila de platform_admins.
  INSERT INTO platform_admins (user_id, full_name, role, active, created_by)
  VALUES (p_user_id, btrim(p_full_name), p_role, true, p_created_by)
  RETURNING id INTO v_new_admin_id;

  -- 2) Permisos por defecto del rol (matriz de Staff-A).
  v_perms := default_permissions_for_role(p_role);
  INSERT INTO platform_admin_permissions (
    platform_admin_id,
    platform_can_create_accounts, platform_can_suspend_accounts, platform_can_archive_accounts,
    platform_can_delete_accounts, platform_can_edit_seed_data, platform_can_impersonate,
    platform_can_manage_admins, platform_can_reset_2fa_of_others, platform_can_send_global_notifications,
    platform_can_view_audit_log, platform_can_view_system_health, updated_by)
  VALUES (
    v_new_admin_id,
    (v_perms->>'platform_can_create_accounts')::boolean,
    (v_perms->>'platform_can_suspend_accounts')::boolean,
    (v_perms->>'platform_can_archive_accounts')::boolean,
    (v_perms->>'platform_can_delete_accounts')::boolean,
    (v_perms->>'platform_can_edit_seed_data')::boolean,
    (v_perms->>'platform_can_impersonate')::boolean,
    (v_perms->>'platform_can_manage_admins')::boolean,
    (v_perms->>'platform_can_reset_2fa_of_others')::boolean,
    (v_perms->>'platform_can_send_global_notifications')::boolean,
    (v_perms->>'platform_can_view_audit_log')::boolean,
    (v_perms->>'platform_can_view_system_health')::boolean,
    p_created_by);

  -- 3) Auditoría (actor = el creador; insert directo porque aquí no hay sesión).
  INSERT INTO platform_audit_log (platform_admin_id, event_type, target_user_id, details)
  VALUES (
    v_creator_admin_id, 'admin_created', p_user_id,
    jsonb_build_object('admin', btrim(p_full_name), 'role', p_role));

  RETURN v_new_admin_id;
END;
$function$;
