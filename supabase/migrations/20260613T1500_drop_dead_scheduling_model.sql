-- 20260613T1500_drop_dead_scheduling_model.sql
-- Aplicada: 2026-06-13
--
-- Retira el MODELO MUERTO de horarios (opción A). El modelo vivo es
-- schedules.cells vía schedulerService + shift_templates; estas tablas eran un
-- esqueleto paralelo a 0 filas que solo tocaban calendarService.ts y
-- locationPlanningService.ts (ambos ya eliminados del repo, build verde).
-- MinimumsSection (Avisos) amputada: la cobertura minima vive en
-- shift_templates.coverage_*. weekly_availability era de locationPlanningService.
--
-- DROP en orden de dependencias (hijos antes que padres). CASCADE por si quedan
-- FKs/policies colgando. Idempotente (IF EXISTS).

BEGIN;

DROP TABLE IF EXISTS public.shift_assignments   CASCADE;  -- FK -> weekly_plans, shift_types
DROP TABLE IF EXISTS public.location_planning   CASCADE;  -- FK -> shift_types
DROP TABLE IF EXISTS public.shift_minimums      CASCADE;  -- FK -> shift_types
DROP TABLE IF EXISTS public.weekly_plans        CASCADE;
DROP TABLE IF EXISTS public.weekly_availability CASCADE;
DROP TABLE IF EXISTS public.shift_types         CASCADE;  -- el padre, al final

COMMIT;
