-- 20260613T1800_appcc_assignment_moment.sql
-- Aplicada: 2026-06-13
--
-- TRAMO A del motor de asignacion APPCC v2: clasifica cada control por su
-- "momento" para que la asignacion se ate al turno, no a una persona al azar.
--   opening    -> lo hace quien ABRE ese dia
--   closing    -> quien CIERRA
--   fixed_time -> quien este en turno a la scheduled_time del control
--   any        -> cualquiera que trabaje ese dia (reparto equitativo) [default]
--
-- Una sola fuente del mapeo: la funcion apply_appcc_assignment_moments(account).
-- - Cuentas existentes: se ejecuta el mapeo una vez al final de esta migracion.
-- - Cuentas nuevas: el trigger de alta la llama tras seed_appcc_for_account.
-- Las plantillas nacen en 'any' por el default de la columna; el mapeo solo
-- promueve las especiales (opening/closing/fixed_time) por code.

-- ── 1. Columna ──────────────────────────────────────────────────────────
ALTER TABLE public.appcc_templates
  ADD COLUMN IF NOT EXISTS assignment_moment text NOT NULL DEFAULT 'any';

ALTER TABLE public.appcc_templates
  DROP CONSTRAINT IF EXISTS appcc_templates_assignment_moment_check;

ALTER TABLE public.appcc_templates
  ADD CONSTRAINT appcc_templates_assignment_moment_check
  CHECK (assignment_moment IN ('opening', 'closing', 'fixed_time', 'any'));

-- ── 2. Funcion de mapeo por code (idempotente, reutilizable) ─────────────
CREATE OR REPLACE FUNCTION public.apply_appcc_assignment_moments(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Apertura: se hace al abrir -> quien abre
  UPDATE public.appcc_templates SET assignment_moment = 'opening'
  WHERE account_id = p_account_id
    AND code IN ('hygiene_daily', 'temp_cameras_am');

  -- Cierre: limpiezas de cierre + temperaturas de cierre -> quien cierra
  UPDATE public.appcc_templates SET assignment_moment = 'closing'
  WHERE account_id = p_account_id
    AND code IN ('clean_kitchen_daily', 'clean_diningroom_daily',
                 'clean_toilets_daily', 'temp_cameras_pm');

  -- Hora fija: atados a un momento del servicio -> quien este en turno a esa hora
  UPDATE public.appcc_templates SET assignment_moment = 'fixed_time'
  WHERE account_id = p_account_id
    AND code IN ('oil_check_daily', 'expiry_cameras_daily');

  -- El resto queda en 'any' (default de la columna): reparto equitativo.
END;
$function$;

-- ── 3. Mapeo para cuentas EXISTENTES (una vez) ──────────────────────────
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT account_id FROM public.appcc_templates LOOP
    PERFORM public.apply_appcc_assignment_moments(r.account_id);
  END LOOP;
END;
$do$;

-- ── 4. Trigger de alta: mapear momentos tras el seed ─────────────────────
CREATE OR REPLACE FUNCTION public.trg_seed_appcc_on_account_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  PERFORM seed_appcc_for_account(NEW.id);
  PERFORM public.apply_appcc_assignment_moments(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- No bloquear el INSERT de accounts si el seed falla.
  -- La cuenta queda creada; el admin puede ejecutar manualmente
  -- SELECT seed_appcc_for_account(<uuid>) mas tarde.
  RAISE WARNING 'Seed APPCC fallo para cuenta % (%): %', NEW.id, NEW.slug, SQLERRM;
  RETURN NEW;
END;
$function$;
