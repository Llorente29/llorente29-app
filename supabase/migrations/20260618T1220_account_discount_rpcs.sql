-- ============================================================================
-- 20260618T1220_account_discount_rpcs.sql
-- CAPA DE PRECIOS · P-C (datos): descuentos por cliente.
--
--   · get_account_discount(account)                      -> jsonb (activo|null)
--   · set_account_discount(account,type,value,note,until) -> aplica + audita
--   · clear_account_discount(account)                     -> retira + audita
--
-- MODELO A: un único descuento ACTIVO por cuenta. set_ desactiva el anterior
-- activo (si lo hay) e inserta el nuevo -> respeta el índice único parcial
-- account_discount_one_active. Para pasar a B (apilables): DROP de ese índice
-- y este set_ se cambiaría por uno que no desactiva; nada más.
--
-- Auditados como 'system_config_changed' DIRIGIDO A LA CUENTA (target_account_id)
-- con details.config='account_discount' -> la columna "Sobre" muestra el cliente
-- y no tocamos el CHECK de tipos de evento. auth.uid() presente desde la app.
--
-- DDL puro -> seguro en SQL Editor; los RPC se prueban desde la app.
-- ============================================================================

-- ── Leer el descuento activo de una cuenta ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_account_discount(p_account_id uuid)
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

  SELECT to_jsonb(t) INTO v
  FROM (
    SELECT id, discount_type, value, note, valid_until, active, created_at
    FROM account_discount
    WHERE account_id = p_account_id AND active
    ORDER BY created_at DESC
    LIMIT 1
  ) t;

  RETURN v;  -- null si no hay descuento activo
END;
$function$;

-- ── Aplicar / sustituir el descuento de una cuenta ───────────────────────────
CREATE OR REPLACE FUNCTION public.set_account_discount(
  p_account_id    uuid,
  p_discount_type text,
  p_value         numeric,
  p_note          text DEFAULT NULL,
  p_valid_until   timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo platform admins.';
  END IF;
  IF p_discount_type NOT IN ('percent','fixed') THEN
    RAISE EXCEPTION 'Tipo de descuento inválido (percent|fixed).';
  END IF;
  IF p_value IS NULL OR p_value <= 0 THEN
    RAISE EXCEPTION 'El valor del descuento debe ser mayor que 0.';
  END IF;
  IF p_discount_type = 'percent' AND p_value > 100 THEN
    RAISE EXCEPTION 'Un porcentaje no puede pasar de 100.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'Cuenta no encontrada.';
  END IF;

  -- MODELO A: desactivar el activo anterior (si lo hay) antes de insertar el nuevo.
  UPDATE account_discount SET active = false
  WHERE account_id = p_account_id AND active;

  INSERT INTO account_discount (account_id, discount_type, value, note, valid_until, active, created_by)
  VALUES (p_account_id, p_discount_type, p_value, NULLIF(btrim(coalesce(p_note,'')), ''), p_valid_until, true, auth.uid());

  PERFORM log_platform_event(
    'system_config_changed', p_account_id, NULL,
    jsonb_build_object(
      'config', 'account_discount', 'action', 'set',
      'discount_type', p_discount_type, 'value', p_value,
      'note', NULLIF(btrim(coalesce(p_note,'')), ''),
      'valid_until', p_valid_until));
END;
$function$;

-- ── Retirar el descuento activo de una cuenta ────────────────────────────────
CREATE OR REPLACE FUNCTION public.clear_account_discount(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo platform admins.';
  END IF;

  UPDATE account_discount SET active = false
  WHERE account_id = p_account_id AND active;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    PERFORM log_platform_event(
      'system_config_changed', p_account_id, NULL,
      jsonb_build_object('config', 'account_discount', 'action', 'clear'));
  END IF;
END;
$function$;
