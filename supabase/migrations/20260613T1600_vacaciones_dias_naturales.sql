-- 20260613T1600_vacaciones_dias_naturales.sql
-- Aplicada: 2026-06-13
--
-- Vacaciones pasan a contarse en DIAS NATURALES (hosteleria trabaja findes).
-- El computo natural ya se aplica en el front (naturalDaysBetween). Aqui se
-- ajusta el dato: el minimo legal es 30 dias naturales (Art. 38 ET) frente a
-- los 22 laborables anteriores. Sube las filas globales que sigan en el default
-- antiguo (22) y fija el default de la columna en 30 para cuentas futuras.
-- asuntos_propios sin cambio. Solo toca filas en 22 (no pisa valores ya
-- personalizados por un gestor).

BEGIN;

UPDATE public.vacation_settings
SET vacation_days_per_year = 30,
    updated_at = now()
WHERE scope = 'global'
  AND vacation_days_per_year = 22;

ALTER TABLE public.vacation_settings
  ALTER COLUMN vacation_days_per_year SET DEFAULT 30;

COMMIT;
