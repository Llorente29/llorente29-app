-- 20260826T1100_menu_item_link_health_excluir_combos.sql
-- APLICADA en produccion el 26-08-2026.
--
-- Corrige la metrica de escandallos de la carta: dos cosas que estan bien por
-- diseno dejan de contar como fallo.
--
-- ── 1) COMBOS — confirmado, se excluyen ──────────────────────────────────
-- Un producto que se vende como combo no lleva escandallo propio a proposito:
-- sus componentes ya descuentan por separado y ponerle uno duplicaria el
-- consumo. La senal es la misma que usa generate_sale_consumption: lineas
-- hijas de tipo 'combo_item'.
--
-- Verificado: 46 productos venden como combo y los 46 tienen al menos un
-- componente con producto casado. En el rojo habia 4 de ellos, 4.255,10 EUR.
--
-- ── 2) RAW — ya estaba bien, no habia nada que arreglar ──────────────────
-- Coca-Cola, Tarta 3 Leches, Cheesecake, Mahou, salsas sueltas: apuntan a un
-- recipe_item type='raw' con 0 recipe_line, y es correcto — el raw se descuenta
-- a si mismo por la condicion de parada de explode_recipe_to_raws.
--
-- classifyMenuItemLink ya lo sabia: un raw solo cae en rojo si le falta el
-- COSTE, y hoy son 0. Comprobado uno a uno: Coca-Cola 0,5909, Tarta 3 Leches
-- 3,1580, Cheesecake de Nutella 3,1580 — todos con coste, todos clasificados
-- 'bien' o 'para_revisar'. Nunca estuvieron en el rojo.
--
-- Lo que si estaba mal era el ROTULO: el aviso llamaba "sin escandallo" a todo
-- el conjunto rojo, incluido 'falta_precio' (raw sin coste), que es otro
-- problema. Ahora se nombran aparte.
--
-- Tampoco hay punto ciego por tipo: la carta solo usa 'dish' (253) y 'raw'
-- (150). El tipo 'recipe' no existe en esta cuenta.
--
-- ── LO QUE NO SE EXCLUYE, Y POR QUE ──────────────────────────────────────
-- El predicado propuesto era "NOT EXISTS (cualquier sale_line hija)", sin
-- filtrar line_type. Eso se lleva por delante mas de la cuenta: hay 3.567
-- lineas hijas de tipo 'modifier' (una hamburguesa pedida "sin cebolla"
-- tambien tiene hijas) y **0 de las 3.567 llevan menu_item_id**, asi que no
-- descuentan nada y no pueden sustituir a un escandallo.
--
-- Medido, sobre el rojo de hoy:
--
--   A  rojo actual                                53 productos   9.360,28 EUR
--   B  A menos combos reales (combo_item)         49 productos   5.105,18 EUR
--   C  el predicado amplio (cualquier hija)       30 productos     228,60 EUR
--
-- La diferencia B-C son 19 productos y 4.876,58 EUR de fuga REAL que el
-- predicado amplio escondia. Entre ellos:
--
--   Combo Duo Smash            1.277,20 EUR   50 ventas
--   Combo Individual Smash       856,00 EUR   51 ventas
--   Smash Bacon Cheeseburger     368,80 EUR   23 ventas
--   Doble Scandal Bacon Cheezy   253,30 EUR   14 ventas
--
-- Los dos primeros se llaman "Combo" pero NO lo son a efectos de stock: sus
-- hijas son 'modifier' sin producto y ellos mismos no tienen recipe_item_id.
-- Hoy no descuentan absolutamente nada. Son la fuga mas grande de la lista y
-- tienen que salir en rojo, no esconderse.
--
-- Por eso la regla es estricta: solo 'combo_item'.
--
-- Columna nueva sells_as_combo, aditiva: no se filtra ni una fila y el cockpit
-- de Casado sigue viendo lo mismo. ~18 ms medidos. DROP + CREATE por cambio de
-- firma; sin dependencias.

DROP FUNCTION IF EXISTS public.menu_item_link_health(uuid, uuid);

CREATE FUNCTION public.menu_item_link_health(p_account_id uuid, p_brand_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(menu_item_id uuid, item_name text, brand_id uuid, brand_name text,
               recipe_item_id uuid, recipe_name text, recipe_type text, cost numeric,
               price numeric, needs_review boolean, link_approved_at timestamp with time zone,
               status text, shared_with integer, recipe_line_count integer,
               sold_lines_90d integer, sold_eur_90d numeric, live_in_catalog boolean,
               sells_as_combo boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'menu_item_link_health: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with share_counts as (
    select m2.recipe_item_id, count(*)::int as n
    from menu_item m2
    where m2.account_id = p_account_id
      and m2.archived_at is null
      and m2.recipe_item_id is not null
    group by m2.recipe_item_id
  ),
  line_counts as (
    -- Agregado una vez por cuenta (no correlated subquery por fila) — mismo
    -- criterio de rendimiento que share_counts.
    select rl.parent_item_id, count(*)::int as n
    from recipe_line rl
    where rl.account_id = p_account_id
    group by rl.parent_item_id
  ),
  ventas_90d as (
    -- Para separar lo que duele de lo que sobra: un producto de carta sin
    -- escandallo que ademas no vende no es una urgencia. ~37 ms medidos.
    select sl.menu_item_id as mi_id, count(*)::int as n,
           round(sum(sl.quantity * coalesce(sl.unit_price,0)), 2) as eur
    from sale_line sl
    join sale s on s.id = sl.sale_id
    where sl.account_id = p_account_id
      and sl.menu_item_id is not null
      and s.sold_at >= now() - interval '90 days'
    group by sl.menu_item_id
  ),
  vivos as (
    -- Sigue pedible en el catalogo externo. Si no esta vivo y ademas no
    -- vendio, es un resto fuera de carta.
    select distinct ecp.organization_product_id::text as matricula
    from external_catalog_product ecp
    where ecp.account_id = p_account_id and ecp.is_enabled
  ),
  combos as (
    -- Un producto que se vende como combo NO lleva escandallo propio a
    -- proposito: sus componentes ya descuentan por separado, y ponerle uno
    -- duplicaria el consumo. La senal es la misma que usa
    -- generate_sale_consumption: lineas hijas de tipo 'combo_item'.
    --
    -- SOLO 'combo_item'. Las hijas 'modifier' NO valen: medido en Foodint,
    -- 0 de 3.567 lineas modifier llevan menu_item_id, asi que no descuentan
    -- nada y no pueden sustituir a un escandallo. Excluir por "tiene hijas"
    -- a secas escondia 19 productos y 4.876,58 EUR de fuga real — entre
    -- ellos "Combo Duo Smash" (1.277,20 EUR), que pese al nombre no tiene
    -- receta ni componentes casados: hoy no descuenta absolutamente nada.
    --
    -- Verificado: de los 46 productos que venden como combo, los 46 tienen
    -- al menos un componente con producto. ~18 ms.
    select distinct p.menu_item_id as mi_id
    from sale_line c
    join sale_line p on p.id = c.parent_sale_line_id
    where c.account_id = p_account_id
      and c.line_type = 'combo_item'
      and p.menu_item_id is not null
  )
  select
    mi.id, mi.name, mi.brand_id, b.name,
    ri.id, ri.name, ri.type,
    round(coalesce(ri.computed_cost, ri.fixed_cost), 4),
    mi.price,
    coalesce(ri.needs_review, false),
    mi.link_approved_at,
    case
      when mi.recipe_item_id is null                                   then 'roto_sin_escandallo'
      when ri.id is null                                               then 'roto_enlace'
      when coalesce(ri.computed_cost, ri.fixed_cost) is null           then 'roto_coste_null'
      when coalesce(ri.needs_review, false)                            then 'roto_needs_review'
      when coalesce(ri.computed_cost, ri.fixed_cost) < 0.50            then 'roto_coste_imposible'
      when mi.link_approved_at is null                                 then 'sin_aprobar'
      else 'aprobado'
    end as status,
    coalesce(sc.n, 0) as shared_with,
    coalesce(lc.n, 0) as recipe_line_count,
    coalesce(v.n, 0) as sold_lines_90d,
    coalesce(v.eur, 0)::numeric as sold_eur_90d,
    (vi.matricula is not null) as live_in_catalog,
    (cb.mi_id is not null) as sells_as_combo
  from menu_item mi
  left join recipe_item ri on ri.id = mi.recipe_item_id
  left join brand b on b.id = mi.brand_id
  left join share_counts sc on sc.recipe_item_id = mi.recipe_item_id
  left join line_counts lc on lc.parent_item_id = mi.recipe_item_id
  left join ventas_90d v on v.mi_id = mi.id
  left join vivos vi on vi.matricula = mi.external_id
  left join combos cb on cb.mi_id = mi.id
  where mi.account_id = p_account_id
    and mi.archived_at is null
    and coalesce(mi.product_type, 'item') <> 'combo'
    and (ri.id is null or ri.type in ('dish', 'raw'))
    and (p_brand_id is null or mi.brand_id = p_brand_id)
  order by
    case
      when mi.recipe_item_id is null then 0
      when coalesce(ri.computed_cost, ri.fixed_cost) is null then 1
      when coalesce(ri.needs_review, false) then 2
      when coalesce(ri.computed_cost, ri.fixed_cost) < 0.50 then 3
      when mi.link_approved_at is null then 4
      else 5
    end,
    b.name, mi.name;
end;
$function$;

NOTIFY pgrst, 'reload schema';
