-- Cockpit "Casado" F3 (corrección en vivo, 02/08) — bug cazado por Julio:
-- un producto de venta casado con un `raw` CON coste (aunque el coste sea
-- absurdamente bajo, ej. 0,019 €) salía "Falta precio" con botón "Poner
-- precio" — mal, porque SÍ tiene coste. "Falta precio" es SOLO para `raw`
-- SIN coste (cost IS NULL). Un `raw` con coste, sea cual sea, va a "Para
-- revisar"; el aviso se afina comparando precio de venta vs coste — hecho
-- aritmético, no juicio de cocina, no is_purchasable (ese flag está sucio,
-- verificado en el RECON de hoy).
--
-- Para esa aritmética el front necesita el PRECIO DE VENTA del menu_item,
-- que menu_item_link_health no devolvía. Se añade aquí.
--
-- 20260802T1200 (recipe_type + recipe_line_count) YA ESTÁ APLICADA en vivo
-- — no se edita, migración nueva. Cambia la firma de retorno (columna
-- nueva) → DROP FUNCTION antes del CREATE.
--
-- Aplicar por SQL Editor a mano. Verificar el cuerpo vivo con
-- `select pg_get_functiondef('public.menu_item_link_health'::regproc)` (NO
-- fiarse del "Success").

drop function if exists public.menu_item_link_health(uuid, uuid);

create or replace function public.menu_item_link_health(
  p_account_id uuid, p_brand_id uuid default null
) returns table(
  menu_item_id uuid, item_name text, brand_id uuid, brand_name text,
  recipe_item_id uuid, recipe_name text, recipe_type text, cost numeric,
  price numeric,
  needs_review boolean, link_approved_at timestamptz,
  status text, shared_with integer, recipe_line_count integer
)
language plpgsql stable security definer set search_path to 'public'
as $function$
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
    coalesce(lc.n, 0) as recipe_line_count
  from menu_item mi
  left join recipe_item ri on ri.id = mi.recipe_item_id
  left join brand b on b.id = mi.brand_id
  left join share_counts sc on sc.recipe_item_id = mi.recipe_item_id
  left join line_counts lc on lc.parent_item_id = mi.recipe_item_id
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

-- Guard: aborta si la columna nueva no quedó en la firma de retorno.
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'menu_item_link_health'
      and pg_get_function_result(p.oid) like '%price numeric%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: menu_item_link_health no devuelve price';
  end if;
end $$;

notify pgrst, 'reload schema';
