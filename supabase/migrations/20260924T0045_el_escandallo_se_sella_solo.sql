-- ENCARGO CODE 23/09 «Que los terminos de la resta sean medibles» — PUNTO 2
-- La version del escandallo, viva.
--
-- ESTADO MEDIDO ANTES DE ESCRIBIR NADA (23/09):
--
--   recipe_item_version ........ 1 fila, 1 ficha, creada el 30/06, 0 de Foodint
--   disparadores en la tabla ... 0
--   crons ...................... 0
--   fichas con escandallo ...... 244 (169 Foodint + 75 plantilla)
--   lineas de escandallo ....... 1.575 en Foodint
--   lineas EDITADAS alguna vez .... 94, en 63 fichas, del 15/06 al 20/09
--
-- (La primera cuenta que hice decia «501 lineas tocadas en 30 dias» y era falsa:
--  496 de ellas eran lineas CREADAS, no editadas. Corregido separando
--  created_at de updated_at. Regla 5: la consulta tiene que medir lo que uno cree.)
--
-- La tabla existe desde el 30/06 y NADIE la ha escrito nunca. El modelo era
-- «hito manual»: un boton en la pestana Historico. El boton no se ha pulsado.
--
-- Y hay DOS sitios del motor que citan su vacio como el motivo de no poder
-- hacer algo — o sea, la deuda ya estaba escrita en el codigo:
--
--   generate_sale_consumption, linea 258:
--     «distinguirlas pediria comparar versiones de escandallo que no existen:
--      recipe_item_version tiene 1 fila»
--     → la nota de «ya no lo pide» no puede decir CUAL de las tres causas es.
--
--   sale_line_cost_sweep, lineas 37-44:
--     «de las 606 lineas reparables de toda la vida, 598 (98,7 %) se costearian
--      con una receta tocada DESPUES de la venta, y recipe_item_version tiene
--      0 filas. Escribir el coste de hoy sobre una venta del 7 de junio es
--      inventar una cifra con cara de medida.»
--     → de ahi sale la ventana de 30 dias, que es una renuncia, no un diseno.
--
-- LO QUE HACE ESTA MIGRACION, y lo que NO:
--
--   SI: el escandallo se sella SOLO. Cada cambio de linea (alta, edicion, baja)
--       y cada cambio de nombre o de raciones deja una version con su foto y su
--       coste. Hacia delante, que es la regla de Julio del 12/09.
--   SI: una semilla con la foto de HOY para las 244 fichas con escandallo, para
--       que la cadena tenga principio.
--   NO: inventar el pasado. Antes de la semilla no hay versiones y no las va a
--       haber: nadie guardo esa foto. La pestana Historico lo dice con todas sus
--       letras en la nota de la semilla, en vez de dejar que alguien lea
--       «v1 · 24/09» y concluya que la receta nacio ese dia (regla 30).
--   NO: tocar el motor de consumo, ni sellar la version EN la venta. Eso pide una
--       columna en sale_line —camino del pedido— y cambiar el motor, las dos cosas
--       prohibidas en este encargo. No hace falta una columna: valid_from/valid_to
--       ya contestan «que receta regia el 12/09 a las 21:40». Ese cable lo tira el
--       encargo que lo use.
--
-- BANDA: crea disparadores sobre recipe_line, y eso toma ACCESS EXCLUSIVE sobre
-- una tabla que _sale_line_raw_consumption y compute_sale_line_cost leen en CADA
-- pedido. Espera a la noche. Ademas la condicion de este encargo es 12:15-00:30.
--
-- REGLA 10: es un cambio sobre el camino del coste y del stock, asi que el ensayo
-- va por CAMINOS —cerrar una venta, recibir un albaran, apuntar una merma y
-- aprobar un recuento— dentro de una transaccion revertida, no solo por SELECT.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · La marca de quien sello: a mano o solo.
-- ─────────────────────────────────────────────────────────────────────────────
-- Explicita, no deducida del texto de la nota. Hace falta para no pisar la RED de
-- restore_recipe_version: esa funcion guarda primero el estado actual como version
-- y LUEGO reescribe las lineas; sin esta marca, el sellado automatico de esas
-- lineas habria sobrescrito justo la foto que era la red. (Encontrado al pensar
-- el caso, antes de aplicar.)
ALTER TABLE public.recipe_item_version
  ADD COLUMN IF NOT EXISTS is_auto boolean NOT NULL DEFAULT false;

-- Sin indice por ficha la tabla solo tenia la PK: con una version por cambio eso
-- deja de ser gratis.
CREATE INDEX IF NOT EXISTS idx_recipe_item_version_item_from
  ON public.recipe_item_version (recipe_item_id, valid_from DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · UN solo constructor de foto, para los dos caminos.
-- ─────────────────────────────────────────────────────────────────────────────
-- create_recipe_version la construia dentro. Si el sellado automatico se hiciera
-- su propia copia, las dos fotos podrian separarse y diffSnapshots ensenaria
-- cambios fantasma. Es la familia de la regla 30: la lista con la que se escribe
-- no puede ser otra que la lista con la que se lee.
CREATE OR REPLACE FUNCTION public._recipe_snapshot(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'name', ri.name,
    'yield_portions', ri.yield_portions,
    'computed_cost', ri.computed_cost,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', rl.id,
        'child_item_id', rl.child_item_id,
        'child_name', ci.name,
        'quantity_net', rl.quantity_net,
        'quantity_gross', rl.quantity_gross,
        'unit_id', rl.unit_id,
        'cut_type_id', rl.cut_type_id,
        'comment', rl.comment,
        'position', rl.position
      ) ORDER BY rl.position, rl.created_at)
      FROM recipe_line rl
      JOIN recipe_item ci ON ci.id = rl.child_item_id
      WHERE rl.parent_item_id = ri.id
    ), '[]'::jsonb),
    'steps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'position', s.position,
        'text', s.text,
        'kind', s.kind,
        'duration_min', s.duration_min,
        'temperature_c', s.temperature_c,
        'photo_url', s.photo_url
      ) ORDER BY s.position, s.created_at)
      FROM recipe_item_step s
      WHERE s.recipe_item_id = ri.id
    ), '[]'::jsonb),
    'step_lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('step_id', sl.step_id, 'line_id', sl.line_id))
      FROM recipe_item_step_line sl
      WHERE sl.step_id IN (SELECT id FROM recipe_item_step WHERE recipe_item_id = ri.id)
    ), '[]'::jsonb)
  )
  FROM recipe_item ri
  WHERE ri.id = p_item_id;
$function$;

-- El camino a mano, ahora apoyado en el constructor unico. Misma firma y mismo
-- comportamiento: no aplica la regla 2 (no se anade parametro).
CREATE OR REPLACE FUNCTION public.create_recipe_version(p_item_id uuid, p_label text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_is_milestone boolean DEFAULT false, p_created_by_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ri        recipe_item%ROWTYPE;
  v_next      integer;
  v_new_id    uuid;
BEGIN
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'create_recipe_version: falta el id del plato';
  END IF;

  SELECT * INTO v_ri FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_recipe_version: receta % no encontrada', p_item_id;
  END IF;

  IF NOT public.current_user_is_admin_or_manager_of(v_ri.account_id) THEN
    RAISE EXCEPTION 'Sin permiso para versionar esta receta';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
  FROM recipe_item_version WHERE recipe_item_id = p_item_id;

  UPDATE recipe_item_version
     SET status = 'superseded', valid_to = now()
   WHERE recipe_item_id = p_item_id
     AND valid_to IS NULL;

  INSERT INTO recipe_item_version (
    recipe_item_id, version_number, valid_from, valid_to, snapshot,
    computed_cost, status, is_milestone, is_auto, milestone_label, change_note, created_by_name
  )
  VALUES (
    p_item_id, v_next, now(), NULL, public._recipe_snapshot(p_item_id),
    v_ri.computed_cost, 'active', COALESCE(p_is_milestone, false), false,
    NULLIF(btrim(p_label), ''), NULLIF(btrim(p_note), ''),
    NULLIF(btrim(p_created_by_name), '')
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · El sellado automatico.
-- ─────────────────────────────────────────────────────────────────────────────
-- Sin guarda de permisos A PROPOSITO: corre dentro de la transaccion de quien ya
-- ha escrito la linea, y a ese la RLS de recipe_line ya le dijo que si. Ponerle
-- una guarda propia solo serviria para reventar escrituras legitimas.
CREATE OR REPLACE FUNCTION public._seal_recipe_version(p_item_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ri    recipe_item%ROWTYPE;
  v_act   recipe_item_version%ROWTYPE;
  v_snap  jsonb;
  v_next  integer;
  v_id    uuid;
BEGIN
  IF p_item_id IS NULL THEN RETURN NULL; END IF;

  -- La ficha puede haber desaparecido: un borrado de recipe_item arrastra sus
  -- lineas en cascada y el disparador de la linea llega cuando el padre ya no esta.
  SELECT * INTO v_ri FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Solo se versiona lo que ES una receta: una ficha sin lineas y sin historia no
  -- tiene escandallo que sellar. Si ya tiene versiones si se sella, para poder
  -- registrar el caso «le han quitado la ultima linea».
  IF NOT EXISTS (SELECT 1 FROM recipe_line WHERE parent_item_id = p_item_id)
     AND NOT EXISTS (SELECT 1 FROM recipe_item_version WHERE recipe_item_id = p_item_id)
  THEN
    RETURN NULL;
  END IF;

  v_snap := public._recipe_snapshot(p_item_id);

  SELECT * INTO v_act FROM recipe_item_version
   WHERE recipe_item_id = p_item_id AND valid_to IS NULL
   ORDER BY version_number DESC LIMIT 1;

  -- (a) La receta no ha cambiado: no se escribe una version nueva. El coste si
  --     puede haberse movido sin que cambie la receta (sube un ingrediente), y
  --     se refresca — pero SOLO sobre una version automatica: la foto de un hito
  --     que guardo una persona no se toca.
  IF FOUND AND v_act.snapshot = v_snap THEN
    IF v_act.is_auto AND v_act.computed_cost IS DISTINCT FROM v_ri.computed_cost THEN
      UPDATE recipe_item_version SET computed_cost = v_ri.computed_cost WHERE id = v_act.id;
    END IF;
    RETURN v_act.id;
  END IF;

  -- (b) Misma transaccion y version automatica: se corrige la que esta en curso.
  --     Editar un escandallo de doce lineas es una sola decision, no doce.
  IF FOUND AND v_act.is_auto AND v_act.valid_from = transaction_timestamp() THEN
    UPDATE recipe_item_version
       SET snapshot = v_snap, computed_cost = v_ri.computed_cost
     WHERE id = v_act.id;
    RETURN v_act.id;
  END IF;

  -- (c) Cambio de verdad: se cierra la anterior y se abre la siguiente.
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
    FROM recipe_item_version WHERE recipe_item_id = p_item_id;

  UPDATE recipe_item_version
     SET status = 'superseded', valid_to = transaction_timestamp()
   WHERE recipe_item_id = p_item_id AND valid_to IS NULL;

  INSERT INTO recipe_item_version (
    recipe_item_id, version_number, valid_from, valid_to, snapshot,
    computed_cost, status, is_milestone, is_auto, change_note
  ) VALUES (
    p_item_id, v_next, transaction_timestamp(), NULL, v_snap,
    v_ri.computed_cost, 'active', false, true, 'Sellada sola al cambiar el escandallo.'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_seal_recipe_version_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._seal_recipe_version(OLD.parent_item_id);
    RETURN OLD;
  END IF;
  -- Mover una linea de un plato a otro deja dos fichas distintas.
  IF TG_OP = 'UPDATE' AND NEW.parent_item_id IS DISTINCT FROM OLD.parent_item_id THEN
    PERFORM public._seal_recipe_version(OLD.parent_item_id);
  END IF;
  PERFORM public._seal_recipe_version(NEW.parent_item_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_seal_recipe_version_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._seal_recipe_version(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recipe_line_seal_version ON public.recipe_line;
CREATE TRIGGER trg_recipe_line_seal_version
  AFTER INSERT OR UPDATE OR DELETE ON public.recipe_line
  FOR EACH ROW EXECUTE FUNCTION public.trg_seal_recipe_version_line();

-- Del plato solo lo que viaja en la foto. El coste NO dispara sellado: cambia
-- cada vez que se mueve el precio de cualquier ingrediente, en cascada, y eso
-- llenaria la historia de versiones con la misma receta dentro. El coste viaja
-- igual, refrescado sobre la version viva por la rama (a).
DROP TRIGGER IF EXISTS trg_recipe_item_seal_version ON public.recipe_item;
CREATE TRIGGER trg_recipe_item_seal_version
  AFTER UPDATE OF name, yield_portions ON public.recipe_item
  FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name
     OR NEW.yield_portions IS DISTINCT FROM OLD.yield_portions)
  EXECUTE FUNCTION public.trg_seal_recipe_version_item();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · La semilla: la foto de HOY, dicha como lo que es.
-- ─────────────────────────────────────────────────────────────────────────────
-- 244 fichas con escandallo (169 Foodint + 75 plantilla). Se salta las que ya
-- tengan alguna version, para no pisar la unica fila del 30/06.
INSERT INTO public.recipe_item_version (
  recipe_item_id, version_number, valid_from, valid_to, snapshot,
  computed_cost, status, is_milestone, is_auto, change_note
)
SELECT ri.id, 1, now(), NULL, public._recipe_snapshot(ri.id),
       ri.computed_cost, 'active', false, true,
       'Semilla del 24/09: es la foto de HOY, no el origen de la receta. '
       || 'Antes de esta fecha no hay versiones guardadas y no se pueden inventar.'
  FROM public.recipe_item ri
 WHERE EXISTS (SELECT 1 FROM public.recipe_line rl WHERE rl.parent_item_id = ri.id)
   AND NOT EXISTS (SELECT 1 FROM public.recipe_item_version v WHERE v.recipe_item_id = ri.id);
