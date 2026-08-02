-- Cockpit "Casado" F3 — separar "sin casar" de "falta precio"/"falta
-- escandallo", clasificando por la NATURALEZA real del artículo enlazado.
--
-- ⚠️ REESCRITA (02/08): el borrador original de este fichero solo añadía
-- recipe_line_count bajo la regla "0 líneas = reventa". El RECON en vivo la
-- descartó: un `dish` sin montar (Kebab de Falafel, Gringas, Tequeños)
-- también tiene 0 líneas y NO es reventa; is_sellable/is_purchasable están
-- sucios (Nestea con is_purchasable=false, 154 dishes con is_sellable=false
-- que sí se venden) → tampoco sirven de eje. Nunca se aplicó esta versión
-- vieja — se reescribe aquí, no hay dos migraciones que reconciliar.
--
-- El eje fiable (verificado limpio en el RECON) es recipe_item.type: dish /
-- raw / packaging / tool / recipe. Caso real: "Nestea Limón" SÍ tiene
-- recipe_item_id enlazado (en las 8 marcas) a un recipe_item type='raw' con
-- computed_cost NULL — está casado, le falta precio, no receta. El cockpit
-- pedía una receta que ya tenía.
--
-- Arquitectura confirmada por RECON: un recipe_item es a la vez escandallo Y
-- artículo/ingrediente (recipe_line.parent_item_id / child_item_id, ambos
-- recipe_item) — una bebida de reventa se casa exactamente igual que un
-- plato, vía menu_item.recipe_item_id. No hace falta modelo de reventa
-- nuevo, ya existe.
--
-- Esta migración solo añade las FACTS crudas (recipe_type, recipe_line_count)
-- y excluye del Casado los tipos que no son de venta (packaging/tool/recipe,
-- y cualquier raw sin vender simplemente no tiene menu_item que lo traiga a
-- esta consulta). La clasificación fina en 5 estados humanos vive en el
-- front (menuLinkService.ts, classifyMenuItemLink) para no seguir haciendo
-- crecer este CASE cada vez que el criterio evolucione — el `status` técnico
-- (7 valores) se mantiene igual que antes, como señal cruda adicional.
--
-- No se edita 20260802T1030/T1100 (ya aplicadas) — cambia la firma de
-- retorno (columna nueva) → DROP FUNCTION antes del CREATE (si no, Postgres
-- rechaza el CREATE OR REPLACE con "cannot change return type of existing
-- function").
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
    -- Solo naturalezas de venta reales: sin enlace (aún no sabemos qué es,
    -- se queda "Sin casar") o enlazado a un plato/artículo de venta. Un
    -- enlace a packaging/tool/recipe no debería existir en la práctica —
    -- si aparece por dato sucio, se oculta en vez de mostrarse roto.
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

-- Guard: aborta si las columnas nuevas no quedaron en la firma de retorno.
do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'menu_item_link_health'
      and pg_get_function_result(p.oid) like '%recipe_type text%'
      and pg_get_function_result(p.oid) like '%recipe_line_count integer%'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: menu_item_link_health no devuelve recipe_type/recipe_line_count';
  end if;
end $$;

notify pgrst, 'reload schema';
