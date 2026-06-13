-- 20260613T1700_seed_vacation_settings_on_account.sql
-- Aplicada: 2026-06-13
--
-- ONBOARDING (tramo 4): toda cuenta nueva nace con su fila global de
-- vacation_settings. Cierra la deuda detectada hoy: sin esta fila, la pantalla
-- de ajustes de vacaciones aparece vacia ("no se ha podido cargar la
-- configuracion global") porque la RLS acota por account_id.
--
-- Replica el patron ya existente de APPCC (seed_appcc_for_account +
-- trg_seed_appcc_on_account_insert): funcion SECURITY DEFINER + trigger
-- AFTER INSERT ON accounts. Idempotente (guard por existencia de fila global).
-- Los defaults (30/3/2/30, scope='global', request_types_disabled='{}') los
-- aporta la propia tabla; solo se fuerza account_id (NOT NULL, sin default).

-- ── Funcion de siembra ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_vacation_settings_for_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Guard: si la cuenta ya tiene fila global, no hacer nada (idempotente).
  IF EXISTS (
    SELECT 1 FROM public.vacation_settings
    WHERE account_id = p_account_id AND scope = 'global'
  ) THEN
    RAISE NOTICE 'Cuenta % ya tiene vacation_settings global, omitiendo seed', p_account_id;
    RETURN;
  END IF;

  -- Inserta la fila global tomando los defaults de la tabla para los valores
  -- de politica (vacation_days_per_year=30, asuntos=3, min_staff=2,
  -- min_lead=30, scope='global', request_types_disabled='{}').
  INSERT INTO public.vacation_settings (account_id)
  VALUES (p_account_id);

  RAISE NOTICE 'vacation_settings global creada para cuenta %', p_account_id;
END;
$function$;

-- ── Trigger function (AFTER INSERT ON accounts) ─────────────────────────
CREATE OR REPLACE FUNCTION public.trg_seed_vacation_settings_on_account_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public.seed_vacation_settings_for_account(NEW.id);
  RETURN NEW;
END;
$function$;

-- ── Trigger ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_seed_vacation_settings_on_account_insert ON public.accounts;

CREATE TRIGGER trg_seed_vacation_settings_on_account_insert
  AFTER INSERT ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_seed_vacation_settings_on_account_insert();
