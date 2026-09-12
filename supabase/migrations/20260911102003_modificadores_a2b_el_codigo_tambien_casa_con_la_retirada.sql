-- ═══════════════════════════════════════════════════════════════════════════
-- MODIFICADORES · A2b — el codigo tambien casa con una opcion retirada,
--                       pero en ultimo lugar
--
-- El codigo es IDENTIDAD, no parecido. Si Last deja de servir un extra y su
-- opcion se retira en Folvy, ese codigo sigue siendo suyo y las ventas de
-- antes tienen que seguir apuntandole. Con los pasos 1 y 2 mirando solo
-- activas, A4 las DESENLAZARIA en cuanto la opcion se retire: se perderia el
-- enlace de historia correcta por un cambio de carta de hoy.
--
-- Asi que activas primero y, si no hay ninguna activa con ese codigo, la
-- retirada. El paso 3 —por nombre— sigue SOLO con activas.
--
-- Misma firma, asi que `CREATE OR REPLACE` no crea sobrecarga (regla 2).
--
-- ── Medido DESPUES de aplicar, sobre la ventana fija 12/08-10/09 ─────────
-- Las mismas cifras que antes del cambio, con la misma vara:
--   cedidas 175 · propias HubRise 935 · propias «lastapp» 233
--   por codigo 1.110 · por nombre 232 · sin enlazar 1
--   iguales a hoy: 160 / 935 / 111
-- No cambia ni una linea HOY, porque hoy no hay ninguna opcion retirada con
-- codigo. Es una red para cuando la haya, y se pone antes de necesitarla.
-- ═══════════════════════════════════════════════════════════════════════════

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
       AND CASE p_source
             WHEN 'lastapp' THEN mo.pos_modifier_id = v_ref
             WHEN 'hubrise' THEN public._modifier_option_ref(mo.id) = v_ref
             WHEN 'folvy'   THEN mo.id::text = v_ref
             ELSE false
           END
     ORDER BY (mo.is_active AND mg.is_active) DESC,  -- la viva, si la hay
              mo.id                                   -- desempate FIJO
     LIMIT 1;
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
       AND CASE p_source
             WHEN 'lastapp' THEN mo.pos_modifier_id = v_ref
             WHEN 'hubrise' THEN public._modifier_option_ref(mo.id) = v_ref
             WHEN 'folvy'   THEN mo.id::text = v_ref
             ELSE false
           END
     ORDER BY
       (mo.is_active AND mg.is_active) DESC,          -- la viva, si la hay
       (mg.brand_id IS NOT DISTINCT FROM p_brand_id) DESC,
       (EXISTS (SELECT 1 FROM public.modifier_recipe_impact mri
                 WHERE mri.modifier_option_id = mo.id AND mri.status = 'confirmed')) DESC,
       mo.id
     LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, 'pos'::text; RETURN;
    END IF;
  END IF;

  -- ── 3 · por nombre, SOLO en la marca del pedido y SOLO activas ──────────
  --
  -- Aqui NO se cae a las retiradas: por nombre no hay identidad, hay parecido,
  -- y resucitar una opcion que alguien retiro porque se parece de nombre es
  -- exactamente lo contrario de lo que se busca.
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
