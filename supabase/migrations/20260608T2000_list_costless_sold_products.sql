-- 20260608T2000_list_costless_sold_products.sql
-- Aplicada: 2026-06-08
--
-- Grifo del termómetro: lista los productos VENDIDOS (líneas reales casadas) cuyo
-- recipe_item no tiene coste (computed_cost y fixed_cost NULL) = dinero vendido cuyo
-- food cost es desconocido. Es lo que la señal cuenta como "casado pero sin coste";
-- esta RPC lo hace accionable en la pantalla de excepciones (grupo "casado sin coste").
--
-- Ordenado por dinero vendido (lo que más envenena el food cost primero). Marca si el
-- recipe_item tiene líneas de receta (escandallo a medias) o no (cascarón), para que el
-- front ofrezca "completar/crear escandallo" o "es reventa".
--
-- Solo productos con ventas DIRECTAS: los modificadores (Base Pollo, etc.) van anidados
-- en modifiers[] y no se venden sueltos → no tienen líneas casadas → no aparecen aquí.
-- Su coste se aborda en el frente de modificadores (un plato es su escandallo + su
-- modificador, inseparables).

BEGIN;

CREATE OR REPLACE FUNCTION public.list_costless_sold_products(
  p_account_id uuid,
  p_from timestamptz DEFAULT (now() - interval '90 days'),
  p_to   timestamptz DEFAULT now()
)
RETURNS TABLE(
  recipe_item_id uuid,
  product_name text,
  recipe_type text,
  has_recipe_lines boolean,
  is_purchasable boolean,
  ventas integer,
  importe numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'list_costless_sold_products: sin acceso a la cuenta %', p_account_id;
  END IF;

  RETURN QUERY
  SELECT
    ri.id,
    max(ri.name)                                  AS product_name,
    max(ri.type)                                  AS recipe_type,
    (count(rl.id) > 0)                            AS has_recipe_lines,
    bool_or(ri.is_purchasable)                    AS is_purchasable,
    count(DISTINCT sl.id)::integer                AS ventas,
    ROUND(SUM(COALESCE(sl.line_total, sl.unit_price * sl.quantity)), 2) AS importe
  FROM sale_line sl
  JOIN sale s        ON s.id = sl.sale_id
  JOIN menu_item mi  ON mi.id = sl.menu_item_id
  JOIN recipe_item ri ON ri.id = mi.recipe_item_id
  LEFT JOIN recipe_line rl ON rl.parent_item_id = ri.id
  WHERE sl.account_id = p_account_id
    AND s.source = 'lastapp'
    AND s.is_active = true
    AND COALESCE(sl.line_type, 'product') = 'product'
    AND s.sold_at >= p_from
    AND s.sold_at <  p_to
    AND ri.computed_cost IS NULL
    AND ri.fixed_cost IS NULL
  GROUP BY ri.id
  HAVING count(DISTINCT sl.id) > 0
  ORDER BY importe DESC NULLS LAST;
END;
$function$;

COMMIT;
