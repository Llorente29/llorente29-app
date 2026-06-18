-- ============================================================================
-- 20260618T0905_audit_writes.sql
-- AUDITORÍA · Pieza B: ESCRITURA de eventos (la deuda viva: hoy solo el alta
-- registra; suspender, cancelar, reactivar y cambiar módulos no dejaban rastro).
--
-- 1) Amplía el CHECK de event_type con dos tipos nuevos y claros:
--      account_status_changed   (details {from, to})
--      account_modules_changed  (details {activated:[codes], deactivated:[codes]})
--    (Las claves son un contrato: NO se renombran luego.)
-- 2) RPC log_platform_event(...): escribe un evento resolviendo el actor
--    (platform_admin de la sesión) y capturando IP/User-Agent REALES desde las
--    cabeceras de la request (PostgREST request.headers -> x-forwarded-for).
--    Best-effort en IP/UA: un header raro NUNCA rompe el registro.
--    La usa la app (setAccountModules) tras la acción.
-- 3) TRIGGER AFTER UPDATE OF status en accounts: registra account_status_changed
--    automáticamente en CUALQUIER cambio de estado, venga de donde venga. No se
--    puede olvidar. Solo audita si el estado cambia de verdad (IS DISTINCT).
--
-- SECURITY DEFINER (escriben en el log). auth.uid() es null en SQL Editor, así
-- que el trigger/RPC no se prueban ahí: se verifican desde la app (hay sesión).
-- DDL puro al crearse -> seguro en SQL Editor.
-- ============================================================================

-- ── 1) Ampliar el CHECK de event_type (drop + recreate con la lista completa) ─
ALTER TABLE public.platform_audit_log
  DROP CONSTRAINT IF EXISTS platform_audit_log_event_type_valid;

ALTER TABLE public.platform_audit_log
  ADD CONSTRAINT platform_audit_log_event_type_valid CHECK (event_type = ANY (ARRAY[
    'account_created','account_suspended','account_unsuspended','account_archived',
    'account_unarchived','account_deleted','account_restored',
    'account_status_changed','account_modules_changed',
    'impersonation_started','impersonation_ended',
    'admin_created','admin_suspended','admin_reactivated','admin_2fa_reset','admin_permissions_changed',
    'seed_data_modified','system_config_changed','global_notification_sent','permission_set_modified'
  ]));

-- ── 2) RPC log_platform_event (escritura desde la app) ───────────────────────
CREATE OR REPLACE FUNCTION public.log_platform_event(
  p_event_type        text,
  p_target_account_id uuid DEFAULT NULL,
  p_target_user_id    uuid DEFAULT NULL,
  p_details           jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_headers  json;
  v_ip       text;
  v_ip_inet  inet;
  v_ua       text;
  v_id       uuid;
BEGIN
  -- Actor = platform_admin de la sesión actual (la app tiene sesión).
  SELECT id INTO v_admin_id FROM platform_admins
  WHERE user_id = auth.uid() AND active = true LIMIT 1;

  -- IP/UA reales desde las cabeceras de la request (best-effort).
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    v_ua := v_headers->>'user-agent';
    v_ip := nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for',''), ',', 1)), '');
    IF v_ip IS NOT NULL THEN v_ip_inet := v_ip::inet; END IF;
  EXCEPTION WHEN others THEN
    v_ip_inet := NULL;
  END;

  INSERT INTO platform_audit_log
    (event_type, platform_admin_id, target_account_id, target_user_id, details, ip_address, user_agent)
  VALUES
    (p_event_type, v_admin_id, p_target_account_id, p_target_user_id, p_details, v_ip_inet, v_ua)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- ── 3) Trigger de auditoría en cambios de estado de cuenta ───────────────────
CREATE OR REPLACE FUNCTION public.audit_account_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id uuid;
  v_headers  json;
  v_ip       text;
  v_ip_inet  inet;
  v_ua       text;
BEGIN
  -- Solo audita si el estado cambia de verdad (un re-marcado no genera ruido).
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_admin_id FROM platform_admins
  WHERE user_id = auth.uid() AND active = true LIMIT 1;

  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    v_ua := v_headers->>'user-agent';
    v_ip := nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for',''), ',', 1)), '');
    IF v_ip IS NOT NULL THEN v_ip_inet := v_ip::inet; END IF;
  EXCEPTION WHEN others THEN
    v_ip_inet := NULL;
  END;

  INSERT INTO platform_audit_log
    (event_type, platform_admin_id, target_account_id, details, ip_address, user_agent)
  VALUES
    ('account_status_changed', v_admin_id, NEW.id,
     jsonb_build_object('from', OLD.status, 'to', NEW.status), v_ip_inet, v_ua);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_account_status ON public.accounts;
CREATE TRIGGER trg_audit_account_status
  AFTER UPDATE OF status ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_account_status_change();
