-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — MIGRACIÓN: operación de Foodint → cuenta Llorente29
-- ════════════════════════════════════════════════════════════════════
-- Consolida locales + personal + APPCC en la cuenta donde ya viven la
-- cocina (escandallos, marcas) y las ventas, para que el prime cost sea
-- cruzable y para que arranquen los fichajes en la cuenta correcta.
--
-- Origen : 51ad1792-6629-4ef7-833a-b57b09a86710  (Foodint)
-- Destino: 00000000-0000-0000-0000-000000000001  (Llorente29)
--
-- Mueve (cambia account_id):
--   · locations (3): Alcalá, Carabanchel, Plaza Castilla
--   · user_profiles (3): roles worker/manager  — EXCLUYE el admin ajeno
--   · appcc_schedules (12)
--   · brand_location_availability (3)
-- Borra:
--   · "Nuevo local" placeholder de Llorente29 (verificado vacío: 0 ventas/emp/appcc)
-- NO toca:
--   · employees (cuelgan de location_id, que no cambia → vínculo intacto)
--   · el admin de Foodint (se queda; se identifica/trata aparte)
--   · turnos, vacaciones, disponibilidades (cuelgan por id, se mantienen)
--
-- SQL Editor hace autocommit por query → BEGIN/COMMIT explícito obligatorio.
-- Llorente29 NO está en uso real por el cliente → riesgo operativo nulo.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Locales (los 3 de Foodint) → Llorente29
UPDATE public.locations
SET account_id = '00000000-0000-0000-0000-000000000001'
WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

-- 2) Perfiles de usuario: SOLO worker/manager (el admin ajeno NO se mueve)
UPDATE public.user_profiles
SET account_id = '00000000-0000-0000-0000-000000000001'
WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  AND role IN ('worker', 'manager');

-- 3) Programaciones APPCC → Llorente29
UPDATE public.appcc_schedules
SET account_id = '00000000-0000-0000-0000-000000000001'
WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

-- 4) Disponibilidad marca×local → Llorente29
UPDATE public.brand_location_availability
SET account_id = '00000000-0000-0000-0000-000000000001'
WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';

-- 5) Borrar el "Nuevo local" placeholder (verificado vacío)
DELETE FROM public.locations
WHERE id = 'fccd1205-8980-4822-a42c-48ca89372f04';

COMMIT;
