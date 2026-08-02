-- Cockpit "Casado" F3 — separar "sin casar" de "falta precio".
--
-- Diagnóstico (RECON en vivo, 02/08): "Nestea Limón" salía en "Sin casar" con
-- botón "Asignar receta", pero SÍ tiene recipe_item_id enlazado en las 8
-- marcas — lo que le falta es que su recipe_item tiene computed_cost NULL.
-- El cockpit confundía "no tiene enlace" con "tiene enlace pero sin coste".
--
-- Arquitectura confirmada por RECON: un recipe_item es a la vez escandallo Y
-- artículo/ingrediente (recipe_line.parent_item_id / child_item_id, ambos
-- recipe_item). Una bebida de reventa se casa igual que un plato: su
-- menu_item.recipe_item_id apunta a su propio recipe_item. La distinción
-- reventa-vs-plato para el LENGUAJE del front (no para el status, que ya
-- existe) es un hecho estructural: 0 recipe_line (como padre) = reventa,
-- ≥1 = plato. Ese conteo no lo devolvía la RPC — se añade aquí.
--
-- No se edita 20260802T1030/T1100 (ya aplicadas) — cambia la firma de
-- retorno (columna nueva) → DROP FUNCTION antes del CREATE (si no, Postgres
-- rechaza el CREATE OR REPLACE con "cannot change return type of existing
-- function").
--
-- Aplicar por SQL Editor a mano. Verificar el cuerpo vivo con
-- `select pg_get_functiondef('public.menu_item_link_health'::regproc)` (NO
-- fiarse del "Success"). Verificar también con la query de RECON del
-- encargo (¿algún plato real con recipe_line=0 que NO sea reventa? — si
-- aparece, avisar antes de dar el lenguaje reventa/plato por bueno).

drop function if exists public.menu_item_link_health(uuid, uuid);

create or replace function public.menu_item_link_health(
  p_account_id uuid, p_brand_id uuid default null
) returns table(
  menu_item_id uuid, item_name text, brand_id uuid, brand_name text,
  recipe_item_id uuid, recipe_name text, cost numeric,
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
    ri.id, ri.name,
    round(coalesce(ri.computed_cost, ri.fixed_cost), 4),
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
      and pg_get_function_result(p.oid) like '%recipe_line_count integer%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: menu_item_link_health no devuelve recipe_line_count';
  end if;
end $$;

notify pgrst, 'reload schema';
