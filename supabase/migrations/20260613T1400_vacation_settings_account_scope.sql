-- 20260613T1400_vacation_settings_account_scope.sql
-- Aplicada: 2026-06-13
--
-- ARREGLO MULTI-CUENTA de vacation_settings.
--
-- PROBLEMA: la tabla no tenía account_id. La RLS de lectura
-- (vacation_settings_read) solo contemplaba filas ligadas a un empleado
-- (JOIN employees ON employee_id), por lo que la fila scope='global'
-- (employee_id NULL) NO casaba el JOIN y quedaba OCULTA PARA TODOS, incluido el
-- superadmin. Resultado: la pantalla de ajustes no cargaba y los saldos del
-- portal salían vacíos, aunque el dato existía.
--
-- SOLUCIÓN: account_id en la tabla + una fila global POR CUENTA + RLS sobre
-- account_id (cubre global y por-empleado). Multi-cliente desde el día 1.
--
-- DDL transaccional e idempotente. No ejecuta funciones SECURITY DEFINER dentro
-- de la transacción (las funciones de tenancy se invocan luego, en las consultas
-- de la app, con sesión real).

BEGIN;

-- ── 1) Columna account_id (FK a accounts) ─────────────────────────────────
ALTER TABLE public.vacation_settings
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE;

-- ── 2) Backfill de filas por-empleado: cuenta vía employees→locations ──────
UPDATE public.vacation_settings vs
SET account_id = l.account_id
FROM public.employees e
JOIN public.locations l ON l.id = e.location_id
WHERE vs.scope <> 'global'
  AND vs.employee_id = e.id
  AND vs.account_id IS NULL;

-- ── 3) Una fila GLOBAL por cada cuenta con empleados ──────────────────────
-- Copia los valores de la fila global huérfana (sin cuenta) si existe; si no,
-- usa los defaults España. No duplica si la cuenta ya tiene su fila global.
WITH g AS (
  SELECT vacation_days_per_year, asuntos_propios_per_year,
         min_staff_per_location, min_lead_days, request_types_disabled
  FROM public.vacation_settings
  WHERE scope = 'global' AND account_id IS NULL
  ORDER BY created_at
  LIMIT 1
),
acc AS (
  SELECT DISTINCT l.account_id
  FROM public.employees e
  JOIN public.locations l ON l.id = e.location_id
  WHERE l.account_id IS NOT NULL
)
INSERT INTO public.vacation_settings
  (scope, account_id, employee_id, vacation_days_per_year, asuntos_propios_per_year,
   min_staff_per_location, min_lead_days, request_types_disabled)
SELECT 'global', acc.account_id, NULL,
       COALESCE((SELECT vacation_days_per_year   FROM g), 22),
       COALESCE((SELECT asuntos_propios_per_year FROM g), 3),
       COALESCE((SELECT min_staff_per_location   FROM g), 2),
       COALESCE((SELECT min_lead_days            FROM g), 30),
       COALESCE((SELECT request_types_disabled   FROM g), '{}'::text[])
FROM acc
WHERE NOT EXISTS (
  SELECT 1 FROM public.vacation_settings vs2
  WHERE vs2.scope = 'global' AND vs2.account_id = acc.account_id
);

-- ── 4) Eliminar la fila global huérfana (sin cuenta), ya sustituida ───────
DELETE FROM public.vacation_settings
WHERE scope = 'global' AND account_id IS NULL;

-- ── 5) account_id obligatorio (toda fila pertenece a una cuenta) ──────────
ALTER TABLE public.vacation_settings
  ALTER COLUMN account_id SET NOT NULL;

-- ── 6) Una sola fila global por cuenta ────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_vacation_settings_global_per_account
  ON public.vacation_settings (account_id)
  WHERE scope = 'global';

-- ── 7) RLS reescrita sobre account_id (cubre global y por-empleado) ───────
DROP POLICY IF EXISTS vacation_settings_read  ON public.vacation_settings;
DROP POLICY IF EXISTS vacation_settings_write ON public.vacation_settings;

CREATE POLICY vacation_settings_read ON public.vacation_settings
  FOR SELECT
  USING (
    account_id = ANY (public.current_user_account_ids())
    OR public.current_user_is_admin()
  );

CREATE POLICY vacation_settings_write ON public.vacation_settings
  FOR ALL
  USING (
    public.current_user_is_admin()
    OR public.current_user_is_admin_of(account_id)
  )
  WITH CHECK (
    public.current_user_is_admin()
    OR public.current_user_is_admin_of(account_id)
  );

COMMIT;

-- NOTA / FRENTE FUTURO: las cuentas NUEVAS necesitan su fila global de
-- vacation_settings al darse de alta (onboarding) — o que el servicio la cree
-- al primer acceso. Disparador: alta de cliente nuevo.
