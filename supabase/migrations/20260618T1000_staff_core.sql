-- ============================================================================
-- 20260618T1000_staff_core.sql
-- STAFF · Pieza A: datos y lógica de gestión de administradores de plataforma.
--
-- Construye SOBRE lo existente (no reinventa):
--   · platform_admins (role ceo/senior_admin/admin/support, active, ...)
--   · platform_admin_permissions (11 flags por admin, UNIQUE platform_admin_id)
--   · current_user_has_platform_permission(flag)  -> autoriza
--   · trg_protect_last_admin                       -> protege al último CEO
--   · log_platform_event(...)                      -> auditoría
--
-- Contenido:
--   1) Amplía el CHECK de auditoría con 'admin_role_changed'.
--   2) default_permissions_for_role(role) -> jsonb  (matriz aprobada; única
--      fuente de verdad de los defaults por rol).
--   3) list_platform_admins()            -> lista enriquecida (requiere manage_admins).
--   4) set_platform_admin_role(id, role)        -> cambia rol + audita.
--   5) set_platform_admin_active(id, active)    -> suspende/reactiva + audita.
--   6) set_platform_admin_permissions(id, jsonb)-> fija los 11 flags + audita el diff.
--
-- Todos los mutadores: SECURITY DEFINER + exigen platform_can_manage_admins.
-- protect_last_admin sigue disparando (BEFORE UPDATE) aunque el RPC sea DEFINER:
-- si se intenta desactivar/degradar al último CEO, lanza su EXCEPTION y el front
-- la muestra como mensaje claro.
--
-- auth.uid() es null en SQL Editor -> NO probar los RPC aquí; verificar desde la
-- app (hay sesión). DDL puro al crearse -> seguro en SQL Editor.
-- ============================================================================

-- ── 1) Vocabulario de auditoría: añadir admin_role_changed ───────────────────
ALTER TABLE public.platform_audit_log
  DROP CONSTRAINT IF EXISTS platform_audit_log_event_type_valid;

ALTER TABLE public.platform_audit_log
  ADD CONSTRAINT platform_audit_log_event_type_valid CHECK (event_type = ANY (ARRAY[
    'account_created','account_suspended','account_unsuspended','account_archived',
    'account_unarchived','account_deleted','account_restored',
    'account_status_changed','account_modules_changed',
    'impersonation_started','impersonation_ended',
    'admin_created','admin_suspended','admin_reactivated','admin_role_changed',
    'admin_2fa_reset','admin_permissions_changed',
    'seed_data_modified','system_config_changed','global_notification_sent','permission_set_modified'
  ]));

-- ── 2) Defaults de permisos por rol (matriz aprobada) ────────────────────────
CREATE OR REPLACE FUNCTION public.default_permissions_for_role(p_role text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE p_role
    WHEN 'ceo' THEN jsonb_build_object(
      'platform_can_create_accounts', true,  'platform_can_suspend_accounts', true,
      'platform_can_archive_accounts', true, 'platform_can_delete_accounts', true,
      'platform_can_edit_seed_data', true,   'platform_can_impersonate', true,
      'platform_can_manage_admins', true,    'platform_can_reset_2fa_of_others', true,
      'platform_can_send_global_notifications', true,
      'platform_can_view_audit_log', true,   'platform_can_view_system_health', true)
    WHEN 'senior_admin' THEN jsonb_build_object(
      'platform_can_create_accounts', true,  'platform_can_suspend_accounts', true,
      'platform_can_archive_accounts', true, 'platform_can_delete_accounts', false,
      'platform_can_edit_seed_data', true,   'platform_can_impersonate', true,
      'platform_can_manage_admins', false,   'platform_can_reset_2fa_of_others', true,
      'platform_can_send_global_notifications', true,
      'platform_can_view_audit_log', true,   'platform_can_view_system_health', true)
    WHEN 'admin' THEN jsonb_build_object(
      'platform_can_create_accounts', true,  'platform_can_suspend_accounts', true,
      'platform_can_archive_accounts', false,'platform_can_delete_accounts', false,
      'platform_can_edit_seed_data', false,  'platform_can_impersonate', true,
      'platform_can_manage_admins', false,   'platform_can_reset_2fa_of_others', false,
      'platform_can_send_global_notifications', false,
      'platform_can_view_audit_log', true,   'platform_can_view_system_health', true)
    WHEN 'support' THEN jsonb_build_object(
      'platform_can_create_accounts', false, 'platform_can_suspend_accounts', false,
      'platform_can_archive_accounts', false,'platform_can_delete_accounts', false,
      'platform_can_edit_seed_data', false,  'platform_can_impersonate', true,
      'platform_can_manage_admins', false,   'platform_can_reset_2fa_of_others', false,
      'platform_can_send_global_notifications', false,
      'platform_can_view_audit_log', false,  'platform_can_view_system_health', true)
    ELSE jsonb_build_object(
      'platform_can_create_accounts', false, 'platform_can_suspend_accounts', false,
      'platform_can_archive_accounts', false,'platform_can_delete_accounts', false,
      'platform_can_edit_seed_data', false,  'platform_can_impersonate', false,
      'platform_can_manage_admins', false,   'platform_can_reset_2fa_of_others', false,
      'platform_can_send_global_notifications', false,
      'platform_can_view_audit_log', false,  'platform_can_view_system_health', false)
  END;
$function$;

-- ── helper interno: exige permiso de gestión de admins ───────────────────────
CREATE OR REPLACE FUNCTION public._require_manage_admins()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT current_user_has_platform_permission('platform_can_manage_admins') THEN
    RAISE EXCEPTION 'Acceso denegado: requiere el permiso "Gestionar admins".';
  END IF;
END;
$function$;

-- ── 3) Listar admins (enriquecido) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_platform_admins()
RETURNS TABLE (
  id uuid, user_id uuid, full_name text, email text, role text,
  active boolean, last_login_at timestamptz, created_at timestamptz,
  can_create_accounts boolean, can_suspend_accounts boolean, can_archive_accounts boolean,
  can_delete_accounts boolean, can_edit_seed_data boolean, can_impersonate boolean,
  can_manage_admins boolean, can_reset_2fa_of_others boolean, can_send_global_notifications boolean,
  can_view_audit_log boolean, can_view_system_health boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM _require_manage_admins();
  RETURN QUERY
  SELECT
    pa.id, pa.user_id, pa.full_name::text, au.email::text, pa.role::text,
    pa.active, pa.last_login_at, pa.created_at,
    COALESCE(p.platform_can_create_accounts, false),
    COALESCE(p.platform_can_suspend_accounts, false),
    COALESCE(p.platform_can_archive_accounts, false),
    COALESCE(p.platform_can_delete_accounts, false),
    COALESCE(p.platform_can_edit_seed_data, false),
    COALESCE(p.platform_can_impersonate, false),
    COALESCE(p.platform_can_manage_admins, false),
    COALESCE(p.platform_can_reset_2fa_of_others, false),
    COALESCE(p.platform_can_send_global_notifications, false),
    COALESCE(p.platform_can_view_audit_log, false),
    COALESCE(p.platform_can_view_system_health, false)
  FROM platform_admins pa
  LEFT JOIN auth.users au ON au.id = pa.user_id
  LEFT JOIN platform_admin_permissions p ON p.platform_admin_id = pa.id
  ORDER BY pa.active DESC, pa.created_at ASC;
END;
$function$;

-- ── 4) Cambiar rol ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_platform_admin_role(p_admin_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_role text;
  v_name     text;
  v_user_id  uuid;
BEGIN
  PERFORM _require_manage_admins();

  SELECT role, full_name, user_id INTO v_old_role, v_name, v_user_id
  FROM platform_admins WHERE id = p_admin_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin no encontrado.';
  END IF;

  IF v_old_role = p_role THEN
    RETURN;  -- sin cambio
  END IF;

  -- protect_last_admin (BEFORE UPDATE) puede abortar si es el último CEO.
  UPDATE platform_admins SET role = p_role WHERE id = p_admin_id;

  PERFORM log_platform_event(
    'admin_role_changed', NULL, v_user_id,
    jsonb_build_object('admin', v_name, 'from', v_old_role, 'to', p_role));
END;
$function$;

-- ── 5) Suspender / reactivar ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_platform_admin_active(p_admin_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_active boolean;
  v_name       text;
  v_user_id    uuid;
BEGIN
  PERFORM _require_manage_admins();

  SELECT active, full_name, user_id INTO v_old_active, v_name, v_user_id
  FROM platform_admins WHERE id = p_admin_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin no encontrado.';
  END IF;

  IF v_old_active = p_active THEN
    RETURN;
  END IF;

  -- protect_last_admin (BEFORE UPDATE) aborta si desactivas al último CEO.
  UPDATE platform_admins SET active = p_active WHERE id = p_admin_id;

  PERFORM log_platform_event(
    CASE WHEN p_active THEN 'admin_reactivated' ELSE 'admin_suspended' END,
    NULL, v_user_id,
    jsonb_build_object('admin', v_name));
END;
$function$;

-- ── 6) Fijar permisos (los 11 flags) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_platform_admin_permissions(p_admin_id uuid, p_permissions jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name       text;
  v_user_id    uuid;
  v_old        platform_admin_permissions%ROWTYPE;
  v_activated  text[] := ARRAY[]::text[];
  v_deactivated text[] := ARRAY[]::text[];
  -- nuevos valores
  n_create  boolean := COALESCE((p_permissions->>'platform_can_create_accounts')::boolean, false);
  n_suspend boolean := COALESCE((p_permissions->>'platform_can_suspend_accounts')::boolean, false);
  n_archive boolean := COALESCE((p_permissions->>'platform_can_archive_accounts')::boolean, false);
  n_delete  boolean := COALESCE((p_permissions->>'platform_can_delete_accounts')::boolean, false);
  n_seed    boolean := COALESCE((p_permissions->>'platform_can_edit_seed_data')::boolean, false);
  n_imp     boolean := COALESCE((p_permissions->>'platform_can_impersonate')::boolean, false);
  n_manage  boolean := COALESCE((p_permissions->>'platform_can_manage_admins')::boolean, false);
  n_2fa     boolean := COALESCE((p_permissions->>'platform_can_reset_2fa_of_others')::boolean, false);
  n_notif   boolean := COALESCE((p_permissions->>'platform_can_send_global_notifications')::boolean, false);
  n_audit   boolean := COALESCE((p_permissions->>'platform_can_view_audit_log')::boolean, false);
  n_health  boolean := COALESCE((p_permissions->>'platform_can_view_system_health')::boolean, false);
BEGIN
  PERFORM _require_manage_admins();

  SELECT full_name, user_id INTO v_name, v_user_id
  FROM platform_admins WHERE id = p_admin_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin no encontrado.';
  END IF;

  -- Estado anterior (si no hay fila, se tratan como defaults: false / true salud+audit).
  SELECT * INTO v_old FROM platform_admin_permissions WHERE platform_admin_id = p_admin_id;

  -- Diff legible para la auditoría.
  IF n_create  IS DISTINCT FROM COALESCE(v_old.platform_can_create_accounts,false)            THEN IF n_create  THEN v_activated:=v_activated||'create_accounts';      ELSE v_deactivated:=v_deactivated||'create_accounts';      END IF; END IF;
  IF n_suspend IS DISTINCT FROM COALESCE(v_old.platform_can_suspend_accounts,false)           THEN IF n_suspend THEN v_activated:=v_activated||'suspend_accounts';     ELSE v_deactivated:=v_deactivated||'suspend_accounts';     END IF; END IF;
  IF n_archive IS DISTINCT FROM COALESCE(v_old.platform_can_archive_accounts,false)           THEN IF n_archive THEN v_activated:=v_activated||'archive_accounts';     ELSE v_deactivated:=v_deactivated||'archive_accounts';     END IF; END IF;
  IF n_delete  IS DISTINCT FROM COALESCE(v_old.platform_can_delete_accounts,false)            THEN IF n_delete  THEN v_activated:=v_activated||'delete_accounts';      ELSE v_deactivated:=v_deactivated||'delete_accounts';      END IF; END IF;
  IF n_seed    IS DISTINCT FROM COALESCE(v_old.platform_can_edit_seed_data,false)             THEN IF n_seed    THEN v_activated:=v_activated||'edit_seed_data';       ELSE v_deactivated:=v_deactivated||'edit_seed_data';       END IF; END IF;
  IF n_imp     IS DISTINCT FROM COALESCE(v_old.platform_can_impersonate,false)                THEN IF n_imp     THEN v_activated:=v_activated||'impersonate';          ELSE v_deactivated:=v_deactivated||'impersonate';          END IF; END IF;
  IF n_manage  IS DISTINCT FROM COALESCE(v_old.platform_can_manage_admins,false)              THEN IF n_manage  THEN v_activated:=v_activated||'manage_admins';        ELSE v_deactivated:=v_deactivated||'manage_admins';        END IF; END IF;
  IF n_2fa     IS DISTINCT FROM COALESCE(v_old.platform_can_reset_2fa_of_others,false)        THEN IF n_2fa     THEN v_activated:=v_activated||'reset_2fa_of_others'; ELSE v_deactivated:=v_deactivated||'reset_2fa_of_others'; END IF; END IF;
  IF n_notif   IS DISTINCT FROM COALESCE(v_old.platform_can_send_global_notifications,false)  THEN IF n_notif   THEN v_activated:=v_activated||'send_notifications';   ELSE v_deactivated:=v_deactivated||'send_notifications';   END IF; END IF;
  IF n_audit   IS DISTINCT FROM COALESCE(v_old.platform_can_view_audit_log,true)              THEN IF n_audit   THEN v_activated:=v_activated||'view_audit_log';       ELSE v_deactivated:=v_deactivated||'view_audit_log';       END IF; END IF;
  IF n_health  IS DISTINCT FROM COALESCE(v_old.platform_can_view_system_health,true)          THEN IF n_health  THEN v_activated:=v_activated||'view_system_health';   ELSE v_deactivated:=v_deactivated||'view_system_health';   END IF; END IF;

  -- Upsert de los 11 flags (UNIQUE platform_admin_id).
  INSERT INTO platform_admin_permissions (
    platform_admin_id,
    platform_can_create_accounts, platform_can_suspend_accounts, platform_can_archive_accounts,
    platform_can_delete_accounts, platform_can_edit_seed_data, platform_can_impersonate,
    platform_can_manage_admins, platform_can_reset_2fa_of_others, platform_can_send_global_notifications,
    platform_can_view_audit_log, platform_can_view_system_health, updated_by)
  VALUES (
    p_admin_id,
    n_create, n_suspend, n_archive, n_delete, n_seed, n_imp,
    n_manage, n_2fa, n_notif, n_audit, n_health, auth.uid())
  ON CONFLICT (platform_admin_id) DO UPDATE SET
    platform_can_create_accounts            = EXCLUDED.platform_can_create_accounts,
    platform_can_suspend_accounts           = EXCLUDED.platform_can_suspend_accounts,
    platform_can_archive_accounts           = EXCLUDED.platform_can_archive_accounts,
    platform_can_delete_accounts            = EXCLUDED.platform_can_delete_accounts,
    platform_can_edit_seed_data             = EXCLUDED.platform_can_edit_seed_data,
    platform_can_impersonate                = EXCLUDED.platform_can_impersonate,
    platform_can_manage_admins              = EXCLUDED.platform_can_manage_admins,
    platform_can_reset_2fa_of_others        = EXCLUDED.platform_can_reset_2fa_of_others,
    platform_can_send_global_notifications  = EXCLUDED.platform_can_send_global_notifications,
    platform_can_view_audit_log             = EXCLUDED.platform_can_view_audit_log,
    platform_can_view_system_health         = EXCLUDED.platform_can_view_system_health,
    updated_by                              = EXCLUDED.updated_by,
    updated_at                              = now();

  IF array_length(v_activated,1) IS NOT NULL OR array_length(v_deactivated,1) IS NOT NULL THEN
    PERFORM log_platform_event(
      'admin_permissions_changed', NULL, v_user_id,
      jsonb_build_object('admin', v_name,
        'activated', to_jsonb(v_activated),
        'deactivated', to_jsonb(v_deactivated)));
  END IF;
END;
$function$;
