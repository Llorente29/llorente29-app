-- ==========================================================================
-- EL CUERPO DEL CANDADO DICE QUE ES EL CUERPO DEL CANDADO
--
-- Correccion de Julio, 13/09 21:05, ANTES de aplicar la tanda. El filo que
-- vio, y que yo no habia escrito en ningun sitio:
--
--   `_impacto_completo` es IMMUTABLE, que es justo lo que permite usarla
--   dentro del CHECK. Pero eso significa que la definicion de «completo» vive
--   FUERA del candado: el dia que alguien haga un CREATE OR REPLACE de esta
--   funcion --para anadir un tipo nuevo, por ejemplo-- las filas que ya estan
--   NO SE VUELVEN A COMPROBAR, y el candado pasa a significar otra cosa sin
--   que salte nada.
--
-- Y no es teorico: hoy mismo hemos medido que `remove_item` SI lleva cantidad
-- y que `multiply` NO usa ficha. La proxima correccion de ese tipo toca
-- exactamente aqui.
--
-- Asi que el aviso se pone DONDE se va a leer: dentro de la funcion, que es
-- lo que abre quien la vaya a cambiar. Un aviso en un parte de septiembre no
-- lo lee nadie en noviembre.
--
-- VA ANTES DEL CHECK a proposito: asi el candado nace ya apoyado en el cuerpo
-- comentado, y no hay una ventana en la que el CHECK exista sobre una funcion
-- que no avisa de nada.
--
-- LO QUE **NO** CAMBIA: ni una coma de la logica. El `case` es identico,
-- token a token. Lo unico que se mueve son comentarios y la etiqueta
-- `COMMENT ON`. Si alguien compara los dos cuerpos y ve una diferencia de
-- logica, esta migracion esta mal y hay que pararla.
--
-- BANDA: `CREATE OR REPLACE FUNCTION` no toma ningun cierre, y a esta funcion
-- no la llama ningun cron ni ningun disparador. Va en la tanda de las 23:45
-- porque la arrastra el CHECK, no porque tuviera que esperar.
-- ==========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._impacto_completo(
  p_tipo text, p_ficha uuid, p_cantidad numeric
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $imp$
  -- ⚠️ ESTA FUNCION ES EL CUERPO DEL CANDADO `impacto_confirmado_completo`
  -- de la tabla `modifier_recipe_impact`.
  --
  -- Si cambias lo que aqui significa «completo», las filas viejas NO SE
  -- REVALIDAN SOLAS: hay que volver a validar la tabla, y eso toma cierre
  -- exclusivo sobre algo que el pedido lee en cada linea — o sea, de
  -- madrugada. (Julio, 13/09.)
  --
  -- La receta, si llega ese dia:
  --   1. Se mide cuantas filas confirmadas incumpliria la definicion NUEVA.
  --   2. Se enderezan esas, o se dice por que se quedan.
  --   3. `ALTER TABLE ... DROP CONSTRAINT impacto_confirmado_completo`
  --      y se vuelve a anadir, o `VALIDATE CONSTRAINT` si se anadio NOT VALID.
  --   4. Y los otros CINCO sitios que leen esta misma frase: los dos
  --      predicados de `modificadores_lista_preguntas` y los tres de
  --      `kitchen_las_iguales`. Sus huellas cuentan las apariciones, asi que
  --      si te dejas uno, saltan.
  --
  -- QUE EXIGE CADA TIPO, y por que (medido el 13/09, no supuesto):
  --   none         · no lleva nada. Es una respuesta, no un hueco.
  --   multiply     · cantidad. NO usa ficha: multiplica lo que ya hay.
  --   add_item     · ficha y cantidad.
  --   remove_item  · ficha y cantidad. SI lleva cantidad: quitar «algo de»
  --                  no es quitarlo entero.
  --   replace_item · ficha y cantidad.
  --   bundle       · ficha y cantidad.
  select case p_tipo
           when 'none'         then true
           when 'multiply'     then p_cantidad is not null and p_cantidad > 0
           when 'add_item'     then p_ficha is not null and p_cantidad is not null and p_cantidad > 0
           when 'remove_item'  then p_ficha is not null and p_cantidad is not null and p_cantidad > 0
           when 'replace_item' then p_ficha is not null and p_cantidad is not null and p_cantidad > 0
           when 'bundle'       then p_ficha is not null and p_cantidad is not null and p_cantidad > 0
           else false
         end;
$imp$;

COMMENT ON FUNCTION public._impacto_completo(text, uuid, numeric) IS
  'Cuerpo del candado impacto_confirmado_completo de modifier_recipe_impact. '
  'Si cambias lo que aqui significa «completo», las filas viejas no se revalidan '
  'solas: hay que volver a validar la tabla, y eso toma cierre exclusivo — de '
  'madrugada. Lee los comentarios de dentro antes de tocarla.';

-- -- HUELLA: la logica es la de antes, token a token -----------------------
DO $huella$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_impacto_completo';
  IF v_n <> 1 THEN RAISE EXCEPTION '_impacto_completo tiene % firmas, no 1', v_n; END IF;

  -- Sigue siendo IMMUTABLE: sin eso no puede vivir dentro de un CHECK.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='_impacto_completo'
                    AND p.provolatile = 'i') THEN
    RAISE EXCEPTION '_impacto_completo ha dejado de ser IMMUTABLE: no podria sostener el candado';
  END IF;

  -- Y RESPONDE LO MISMO. Las trece respuestas que definen la frase, una a una.
  -- Comprobar que «existe» no prueba que no se haya movido (regla 31).
  IF NOT (
       public._impacto_completo('none', NULL, NULL)              IS TRUE
   AND public._impacto_completo('none', NULL, 5)                 IS TRUE
   AND public._impacto_completo('multiply', NULL, 2)             IS TRUE
   AND public._impacto_completo('multiply', NULL, NULL)          IS FALSE
   AND public._impacto_completo('multiply', NULL, 0)             IS FALSE
   AND public._impacto_completo('add_item', gen_random_uuid(), 1)    IS TRUE
   AND public._impacto_completo('add_item', gen_random_uuid(), NULL) IS FALSE
   AND public._impacto_completo('add_item', NULL, 1)             IS FALSE
   AND public._impacto_completo('remove_item', gen_random_uuid(), 1) IS TRUE
   AND public._impacto_completo('remove_item', gen_random_uuid(), NULL) IS FALSE
   AND public._impacto_completo('replace_item', gen_random_uuid(), 1) IS TRUE
   AND public._impacto_completo('bundle', gen_random_uuid(), -1)  IS FALSE
   AND public._impacto_completo('loquesea', gen_random_uuid(), 1) IS FALSE
  ) THEN
    RAISE EXCEPTION 'la frase ha cambiado de significado: esto solo tenia que anadir comentarios';
  END IF;

  RAISE NOTICE 'el aviso queda dentro de la funcion, y la frase responde lo mismo en los 13 casos';
END;
$huella$;

COMMIT;
