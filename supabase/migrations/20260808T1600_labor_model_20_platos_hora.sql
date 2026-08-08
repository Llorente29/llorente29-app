-- Aplicada: 2026-08-08 por MCP.
-- CAMBIO DE DECISION (Julio, 08/08/2026). Revoca el prior de 12 platos/cocinero-hora
-- fijado el 10/07 ("no recalcular"). Motivos:
--   1) Dato observado: con 2 personas se han sacado 50 platos en una hora = 25/persona-hora.
--      Con 3 personas la productividad CAE a 6,4/persona-hora -> la tercera sobra.
--   2) Criterio operativo de Julio: "20 se lleva bastante bien".
--   3) El prior de 12 era un SUELO teorico, no la capacidad real de esta cocina.
-- El valor vive en team_labor_model (por cuenta/local): otro cliente tendra el suyo.
--
-- ⚠️ ESTE CAMBIO POR SI SOLO NO BASTA. El defecto medido en generate_week_schedule
-- (20260808T1500..T1550) es que team_labor_requirement REDONDEA AL ALZA hora a hora
-- antes de dividir por per_person_hour, e infla la necesidad de personal un 101%:
-- pide 79 personas-hora/semana cuando la produccion real necesita 39,4. Subir el
-- per_person_hour de 12 a 20 reduce el numero pero no corrige el redondeo — el generador
-- sigue sobredimensionado. F10 sigue 🟡, no ✅.

UPDATE public.team_labor_model
   SET per_person_hour = 20, updated_at = now()
 WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   AND role_kind = 'cocina';

DO $g$
DECLARE v numeric;
BEGIN
  SELECT per_person_hour INTO v FROM public.team_labor_model
   WHERE account_id='51ad1792-6629-4ef7-833a-b57b09a86710' AND role_kind='cocina';
  IF v IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'per_person_hour no quedo a 20 (valor: %)', v;
  END IF;
END $g$;
