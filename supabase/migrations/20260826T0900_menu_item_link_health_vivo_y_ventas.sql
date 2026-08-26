-- 20260826T0900_menu_item_link_health_vivo_y_ventas.sql
-- APLICADA en produccion el 26-08-2026.
--
-- ── EL PARTE ─────────────────────────────────────────────────────────────
-- "El aviso rojo de Cartas dice 'Casado: 85 sin casar · 2 sin precio/escandallo
-- · 141 para revisar · 254 bien' y no coincide con ninguna metrica verificada.
-- Casado de ventas ya esta a 0. Casado de recepciones es 6/347/372."
--
-- No coincide porque no mide lo mismo. Son TRES ejes consecutivos de la misma
-- cadena, y dos se llamaban igual:
--
--   venta -> producto de carta        casado de ventas       (100 % en Foodint)
--   producto de carta -> escandallo   ESTE                   (85 sin casar)
--   linea de albaran -> articulo      casado de recepciones  (6 / 347 / 372)
--
-- Una venta puede casar perfectamente con un producto que no sabe lo que
-- cuesta ni descuenta de almacen. Por eso el de ventas esta a 0 y este no, sin
-- que ninguno mienta. El componente es LinkHealthBanner (KitchenMenuPage) y
-- come de menu_item_link_health.
--
-- ── PERO NO ERA UTIL ─────────────────────────────────────────────────────
-- Los 85 "sin casar", desglosados:
--
--   vivo en carta Last   vendio 90d   productos   EUR 90d
--   si                   si                  34    7.286,68
--   si                   no                  17        0,00
--   no                   si                   6    4.440,50
--   no                   no                  28        0,00
--
-- 28 de 85 no estan vivos en el catalogo ni han vendido en 90 dias: restos
-- fuera de carta. Un tercio del rojo era basura, y "141 para revisar" ni
-- siquiera es un fallo — son productos CASADOS cuyo coste si se calcula, solo
-- que oficina no los ha confirmado. El aviso sumaba 228 "problemas" de los que
-- 59 lo eran.
--
-- ── LO QUE HACE ──────────────────────────────────────────────────────────
-- Tres columnas nuevas, ADITIVAS: no se filtra ni una fila, el cockpit de
-- Casado sigue viendo exactamente lo mismo que antes.
--
--   sold_lines_90d   lineas de venta en 90 dias
--   sold_eur_90d     importe vendido en esos 90 dias
--   live_in_catalog  sigue pedible en el catalogo externo
--
-- Con eso el aviso puede separar lo que duele (vivo o vendiendo) de lo que
-- sobra, y decir el dinero en vez de un numero pelado. Medido: el agregado de
-- ventas anade ~37 ms en Foodint (16.999 lineas, 8.350 ventas).
--
-- Cambia el tipo de retorno, asi que DROP + CREATE. Sin dependencias: no la
-- llama ninguna otra funcion, vista ni cron.

DROP FUNCTION IF EXISTS public.menu_item_link_health(uuid, uuid);

CREATE FUNCTION public.menu_item_link_health(p_account_id uuid, p_brand_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(menu_item_id uuid, item_name text, brand_id uuid, brand_name text,
               recipe_item_id uuid, recipe_name text, recipe_type text, cost numeric,
               price numeric, needs_review boolean, link_approved_at timestamp with time zone,
               status text, shared_with integer, recipe_line_count integer,
               sold_lines_90d integer, sold_eur_90d numeric, live_in_catalog boolean)
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
    -- escandallo que ademas no vende no es una urgencia. Mismo agregado por
    -- cuenta, ~37 ms medidos en Foodint.
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
    (vi.matricula is not null) as live_in_catalog
  from menu_item mi
  left join recipe_item ri on ri.id = mi.recipe_item_id
  left join brand b on b.id = mi.brand_id
  left join share_counts sc on sc.recipe_item_id = mi.recipe_item_id
  left join line_counts lc on lc.parent_item_id = mi.recipe_item_id
  left join ventas_90d v on v.mi_id = mi.id
  left join vivos vi on vi.matricula = mi.external_id
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
