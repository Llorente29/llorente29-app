-- 20260910214827_conteo_p17_la_apertura_la_decide_la_persona.sql
--
-- LA APERTURA LA DECIDE LA PERSONA, EL MOTOR SOLO PROPONE
--
-- `build_inventory_count` hacía esto cada vez que genera la hoja:
--
--   SELECT EXISTS (... movement_type = 'apertura') INTO v_has_opening;
--   UPDATE inventory_count SET is_opening = NOT v_has_opening;
--
-- O sea: pisaba la decisión al pulsar «Empezar». Una casilla «Inventario de
-- apertura» en la pantalla se habría borrado sola, sin decir nada — y justo en
-- los dos locales donde está el problema del packaging:
--
--   Alcalá          1 movimiento de apertura  -> el motor diría NO
--   Carabanchel    97 movimientos de apertura -> el motor diría NO
--   Plaza Castilla  0 movimientos             -> el motor diría SÍ, aun sin pedirlo
--
-- Es la familia del botón que calla (regla 8): la pantalla habría dicho
-- «apertura» y el inventario habría salido con sus 28.800 € de merma igual.
--
-- Y ENSEÑA UN AGUJERO EN LA VERIFICACIÓN DE LA p13: allí puse `is_opening` a
-- mano en la fila y nunca pasé por `build_inventory_count`. Probé que la
-- apertura se comporta bien; no probé que se pudiera LLEGAR a ella.
--
-- QUÉ CAMBIA. `is_opening_manual` marca que alguien lo ha decidido a mano. El
-- motor sigue proponiendo igual que hasta ahora cuando nadie ha decidido —el
-- comportamiento de todo lo existente no se mueve— y se calla cuando sí.
--
-- ENSAYO, en los dos sentidos y revertido:
--   A · creado apertura, SIN marcar   -> tras Empezar: false  (el motor gana)
--   B · creado apertura, MARCADO      -> tras Empezar: true
--   C · Plaza Castilla, marcado que NO -> tras Empezar: false
--
-- Este fichero lleva la transformación, no el cuerpo literal, por lo mismo que
-- la p16: `build_inventory_count` se define en 20260825T1000, del formato viejo.
-- md5 del resultado: 778d02c985140749cccc25504a726420 (3.570 caracteres).

BEGIN;

ALTER TABLE public.inventory_count
  ADD COLUMN IF NOT EXISTS is_opening_manual boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.inventory_count.is_opening_manual IS
  'true cuando una persona marcó a mano si esto es un inventario de apertura. '
  'Mientras sea false, build_inventory_count sigue decidiéndolo por el ledger. '
  '10/09/2026: antes el motor lo pisaba siempre y la casilla habría sido decorativa.';

DO $patch$
DECLARE
  v_def text; v_viejo text; v_nuevo text; v_n integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'build_inventory_count';

  v_viejo := 'SET is_opening = NOT v_has_opening';
  v_nuevo := 'SET is_opening = CASE WHEN is_opening_manual THEN is_opening ELSE NOT v_has_opening END';

  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Esperaba 1 asignacion de is_opening, encontradas %', v_n;
  END IF;

  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$patch$;

COMMIT;
