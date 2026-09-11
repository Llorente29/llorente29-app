-- 20260911082714_extras_p3b_el_grupo_devuelve_la_referencia_efectiva.sql
--
-- `_extras_group_options` devolvia el `external_id` CRUDO, y los dos
-- envoltorios —oficina y tablet— se saltan las copias que lo tienen a NULL.
-- Resultado: la p3 arreglo el core y no cambio nada, porque el filtro de
-- arriba seguia descartando las 31 antes de llegar a el.
--
-- LO CAZO LA PRUEBA DE VERDAD, no una revision: agotar «Sin Salsa Harisa» de
-- The Urban Kebab devolvio `opciones: 1, sin_ref: 4` cuando tenia que devolver
-- 5 y 0. Si me hubiera quedado en el ensayo del core —que salio verde— habria
-- dado por bueno un arreglo que no arreglaba nada.
--
-- El punto unico es este: el grupo devuelve la referencia EFECTIVA, la misma
-- que publica `hubrise-catalog-publish`. Los envoltorios no cambian.
--
-- md5 de `prosrc`: e8aa37728b6c57b01fa95759f2d98432 (198 caracteres).

BEGIN;

CREATE OR REPLACE FUNCTION public._extras_group_options(p_account_id uuid, p_clave text)
RETURNS TABLE(option_id uuid, external_id text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
  SELECT mo.id, public._modifier_option_ref(mo.id), mo.name
    FROM public.modifier_option mo
   WHERE mo.account_id = p_account_id
     AND mo.is_active
     AND lower(btrim(mo.name)) = p_clave;
$fn$;

COMMENT ON FUNCTION public._extras_group_options(uuid, text) IS
  'Las copias de un extra en la cuenta, agrupadas por NOMBRE normalizado, con '
  'su referencia de canal EFECTIVA (la misma que publica hubrise-catalog-publish). '
  'NULL en marca cedida: alli la carta la manda el canal.';

COMMIT;
