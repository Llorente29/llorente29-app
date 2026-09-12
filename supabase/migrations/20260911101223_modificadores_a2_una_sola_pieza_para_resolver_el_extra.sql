-- ═══════════════════════════════════════════════════════════════════════════
-- MODIFICADORES · A2 — una sola pieza de busqueda para los tres adaptadores
--
-- Hoy cada adaptador busca a su manera, y las dos maneras acaban en lo mismo:
-- si el codigo no casa, se busca EL NOMBRE EN TODA LA CUENTA, en cualquier
-- marca, en opciones activas o no, con `LIMIT 1` Y SIN ORDEN. Medido el 11/09
-- sobre ventas cedidas de la ventana fija: de 165 lineas enlazadas, 4 cayeron
-- en la copia de otra marca. No es azar con forma de azar: es que `LIMIT 1`
-- sin `ORDER BY` deja que Postgres devuelva la fila que le venga mejor, y esa
-- puede cambiar entre dos ejecuciones identicas.
--
-- Esta funcion es la unica puerta a partir de ahora, y busca EN ESTE ORDEN:
--
--   1. POR CODIGO, DENTRO DE LAS PREGUNTAS DE ESE PLATO. Es lo correcto y es
--      lo que ya hacen los pedidos de Folvy (`_adapt_folvy_pos_order`), que
--      llevan haciendolo bien desde siempre: `mo.id` + `mga.menu_item_id`.
--   2. POR CODIGO, EN CUALQUIER OPCION DE LA CUENTA. Primero la de la marca
--      del pedido; si hay varias, la que tiene «que lleva»; y si sigue
--      habiendo empate, un desempate FIJO por `mo.id`. Nunca `LIMIT 1` suelto.
--   3. POR NOMBRE NORMALIZADO, y SOLO en opciones activas de la marca del
--      pedido. La busqueda por nombre en toda la cuenta desaparece.
--   4. Nada: la linea queda sin enlazar, y con motivo.
--
-- Devuelve tambien CÓMO se enlazo, que es lo que A3 guarda en `map_source`:
-- 'pos' si fue por codigo, 'fuzzy' si fue por nombre, NULL si nada.
--
-- Por que ese vocabulario y no uno nuevo: porque es el que el sistema YA
-- habla. Medido en `sale_line` de Foodint: `pos`, `fuzzy`, `manual`, `human`
-- y `unmapped`, y `fuzzy` ya significa exactamente «casado por parecido de
-- nombre, no por codigo» en productos y en lineas de combo. Inventar una
-- columna nueva para decir lo mismo habria obligado a tocar a los catorce
-- lectores de `map_source` sin ganar nada.
--
-- Y de paso arregla una MENTIRA que hay hoy en la tabla: las 4.353 lineas de
-- extra enlazadas dicen `map_source = 'pos'`, o sea «caso por codigo», cuando
-- en cedidas solo SEIS casaron por codigo de verdad. El resto lo caso el
-- nombre a ciegas y la columna afirmaba lo contrario.
--
-- ── MEDIDO SOBRE LA POBLACION REAL, antes de tocar ningun adaptador ───────
--
-- Ventana fija 12/08–10/09, con `pos_modifier_id` ya relleno por la pasada de
-- A1 de las 12:11. Se compara, linea a linea, lo que elige esta funcion
-- contra lo que la linea tiene hoy:
--
--   cedidas (175)         175 por codigo · 0 por nombre · 0 sin enlazar
--                         160 igual · 4 cambian · 11 GANAN enlace · 0 pierden
--   propias HubRise (935) 935 por codigo · 935 IGUALES · ni una cambia
--   propias «lastapp»(233) 232 por nombre · 1 sin enlazar · 122 cambian
--
-- Y lo que importa de las que cambian, que es si el cambio mejora:
--
--                              antes        despues
--   en las preguntas del plato   0            4   (cedidas)
--   de OTRA marca                4            0
--   en las preguntas del plato   0           87   (propias «lastapp»)
--   de OTRA marca              107            0
--
-- Ninguna pierde el enlace. Una sola deja de descontar, y es lo correcto:
-- «Salsa Tzatziki (Recomendada)» en un plato de Meraki Pita estaba
-- descontando por la copia de THE URBAN KEBAB — stock de otra marca. Ahora
-- coge la copia de Meraki Pita, que todavia no tiene «que lleva», y pasa a
-- «sin decidir». Deja de descontar mal en vez de seguir descontando bien por
-- accidente.
-- ═══════════════════════════════════════════════════════════════════════════

-- El normalizador, en UN solo sitio. Es exactamente el que hoy tienen dentro
-- `adapt_lastapp_order` y `adapt_hubrise_order`, copiado sin cambiarle nada:
-- si aqui se «mejorara», el antes y el despues se medirian con varas
-- distintas y el paso 3 dejaria de casar lo que casaba (regla 31).
CREATE OR REPLACE FUNCTION public._extra_nombre_normalizado(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT regexp_replace(
           regexp_replace(
             btrim(lower(public.unaccent(coalesce(p_nombre, '')))),
           '\.$', ''),
         '\s+', ' ', 'g');
$fn$;

CREATE OR REPLACE FUNCTION public.resolver_opcion_de_extra(
  p_account_id   uuid,
  p_menu_item_id uuid,   -- el plato de la linea padre; NULL si no esta enlazado
  p_brand_id     uuid,   -- la marca del pedido
  p_ref          text,   -- el codigo que trae el pedido
  p_name         text,   -- el nombre que trae el pedido
  p_source       text    -- 'lastapp' | 'hubrise' | 'folvy'
)
RETURNS TABLE(option_id uuid, como text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_id   uuid;
  v_norm text := public._extra_nombre_normalizado(p_name);
  v_ref  text := nullif(btrim(coalesce(p_ref, '')), '');
BEGIN
  -- ── 1 · por codigo, dentro de las preguntas de ese plato ────────────────
  IF v_ref IS NOT NULL AND p_menu_item_id IS NOT NULL THEN
    SELECT mo.id INTO v_id
      FROM public.modifier_group_assignment mga
      JOIN public.modifier_group mg ON mg.id = mga.modifier_group_id
      JOIN public.modifier_option mo ON mo.modifier_group_id = mg.id
     WHERE mga.menu_item_id = p_menu_item_id
       AND mo.account_id = p_account_id
       AND mo.is_active AND mg.is_active
       AND CASE p_source
             WHEN 'lastapp' THEN mo.pos_modifier_id = v_ref
             WHEN 'hubrise' THEN public._modifier_option_ref(mo.id) = v_ref
             WHEN 'folvy'   THEN mo.id::text = v_ref
             ELSE false
           END
     ORDER BY mo.id      -- desempate FIJO: sin esto, dos ejecuciones iguales
     LIMIT 1;            -- pueden devolver opciones distintas.
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'pos'::text; RETURN;
    END IF;
  END IF;

  -- ── 2 · por codigo, en cualquier opcion de la cuenta ────────────────────
  --
  -- Aqui es donde entran los extras de un plato que Folvy todavia no tiene
  -- enlazado: son las 18 lineas cedidas del 11/09 (9 del burrito de birria de
  -- Dos Coyotes, 8 de los tequeños de Ay Mamita, 1 del Cochinita Bowl y 1 de
  -- las Classic French Fries). Enlazar ESOS PLATOS es otro encargo (D12); sus
  -- extras se enlazan igual por aqui.
  IF v_ref IS NOT NULL THEN
    SELECT mo.id INTO v_id
      FROM public.modifier_option mo
      JOIN public.modifier_group mg ON mg.id = mo.modifier_group_id
     WHERE mo.account_id = p_account_id
       AND mo.is_active AND mg.is_active
       AND CASE p_source
             WHEN 'lastapp' THEN mo.pos_modifier_id = v_ref
             WHEN 'hubrise' THEN public._modifier_option_ref(mo.id) = v_ref
             WHEN 'folvy'   THEN mo.id::text = v_ref
             ELSE false
           END
     ORDER BY
       -- primero la de la marca del pedido
       (mg.brand_id IS NOT DISTINCT FROM p_brand_id) DESC,
       -- luego la que tiene «que lleva» confirmado: entre dos copias, la util
       (EXISTS (SELECT 1 FROM public.modifier_recipe_impact mri
                 WHERE mri.modifier_option_id = mo.id AND mri.status = 'confirmed')) DESC,
       -- y si siguen empatadas, siempre la misma
       mo.id
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'pos'::text; RETURN;
    END IF;
  END IF;

  -- ── 3 · por nombre, SOLO en la marca del pedido ─────────────────────────
  --
  -- Lo que desaparece respecto a hoy: «en toda la cuenta» y «activas o no».
  -- Sin marca del pedido no se busca por nombre: preferimos una linea sin
  -- enlazar y con motivo a una linea enlazada a la copia de otra marca, que
  -- es lo que descuenta del almacen equivocado.
  IF v_norm <> '' AND p_brand_id IS NOT NULL THEN
    SELECT mo.id INTO v_id
      FROM public.modifier_option mo
      JOIN public.modifier_group mg ON mg.id = mo.modifier_group_id
     WHERE mo.account_id = p_account_id
       AND mo.is_active AND mg.is_active
       AND mg.brand_id = p_brand_id
       AND public._extra_nombre_normalizado(mo.name) = v_norm
     ORDER BY
       -- si el plato existe, la copia que de verdad cuelga de ese plato
       (EXISTS (SELECT 1 FROM public.modifier_group_assignment mga
                 WHERE mga.modifier_group_id = mg.id
                   AND mga.menu_item_id IS NOT DISTINCT FROM p_menu_item_id)) DESC,
       (EXISTS (SELECT 1 FROM public.modifier_recipe_impact mri
                 WHERE mri.modifier_option_id = mo.id AND mri.status = 'confirmed')) DESC,
       mo.id
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'fuzzy'::text; RETURN;
    END IF;
  END IF;

  -- ── 4 · nada ────────────────────────────────────────────────────────────
  RETURN QUERY SELECT NULL::uuid, NULL::text;
END;
$fn$;

REVOKE ALL ON FUNCTION public._extra_nombre_normalizado(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._extra_nombre_normalizado(text) FROM anon;
GRANT EXECUTE ON FUNCTION public._extra_nombre_normalizado(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolver_opcion_de_extra(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolver_opcion_de_extra(uuid, uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.resolver_opcion_de_extra(uuid, uuid, uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_opcion_de_extra(uuid, uuid, uuid, text, text, text) TO service_role;
