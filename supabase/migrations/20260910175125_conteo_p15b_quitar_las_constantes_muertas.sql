-- 20260910175125_conteo_p15b_quitar_las_constantes_muertas.sql
--
-- Las constantes 3/7/14 se quedaron DECLARADAS y sin usar tras la p15. Un resto
-- así no rompe nada, pero hace que el siguiente que lea la función crea que la
-- cadencia sigue clavada en el código, que es justo lo que se acaba de quitar.
--
-- El cuerpo resultante está en el fichero de la p15, que lleva ya las dos
-- transformaciones aplicadas. Aquí queda la transformación tal cual se ejecutó.

BEGIN;

DO $patch$
DECLARE
  v_def text; v_viejo text; v_n integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_generate_daily_count_core';

  v_viejo := E'  v_h_a integer := 3; v_h_b integer := 7; v_h_c integer := 14;\n';

  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Esperaba 1 declaracion de las constantes, encontradas %', v_n;
  END IF;
  IF v_def LIKE '%v_h_a%' AND (length(v_def) - length(replace(v_def, 'v_h_a', ''))) / 5 <> 1 THEN
    RAISE EXCEPTION 'v_h_a se usa en mas sitios: no se quita';
  END IF;

  EXECUTE replace(v_def, v_viejo, '');
END;
$patch$;

COMMIT;
