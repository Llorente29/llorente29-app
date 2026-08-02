-- Trazabilidad ítem↔escandallo — RPCs de control del enlace menu_item↔recipe_item.
-- Requiere la migración 20260802T1000_menu_item_link_approval.sql aplicada antes
-- (usa menu_item.link_approved_at/by).
--
-- Guard verificado contra el policy vivo `menu_item_write` (cmd=ALL, using/with
-- check = current_user_is_admin_of(account_id)): las 3 RPC de ESCRITURA (2.1-2.3)
-- usan exactamente ese predicado — current_user_is_admin_of ya incluye el bypass
-- de current_user_is_admin() internamente, no hace falta combinarlo con
-- admin_or_manager_of (eso abriría por RPC una puerta que el RLS tiene cerrada).
-- Decisión de producto (Julio, opción A): asignar/quitar/aprobar = solo admin.
-- Las 2 de LECTURA (2.4-2.5) usan admin() OR admin_or_manager_of(...), igual que
-- kitchen_item_delete_check — deliberadamente más estrecho que menu_item_read
-- (que deja leer a cualquier miembro de la cuenta), porque aquí se expone coste.
--
-- Aplicar por SQL Editor a mano. Verificar cada función con un select de prueba
-- tras aplicar. NUNCA ejecutar en la misma tx que la crea.

-- ─────────────────────────────────────────────────────────────────────
-- 2.1 set_menu_item_recipe — asignar/cambiar escandallo
-- Resetea la aprobación (todo cambio de enlace exige re-aprobar). NO auto-pone
-- verde.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.set_menu_item_recipe(
  p_menu_item_id uuid, p_recipe_item_id uuid
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_account uuid;
  v_ri      recipe_item%rowtype;
begin
  select account_id into v_account from menu_item where id = p_menu_item_id;
  if v_account is null then
    raise exception 'set_menu_item_recipe: ítem % no existe', p_menu_item_id;
  end if;

  if not public.current_user_is_admin_of(v_account) then
    raise exception 'set_menu_item_recipe: sin acceso a la cuenta %', v_account;
  end if;

  -- El escandallo destino DEBE ser de la MISMA cuenta y estar vivo (candado anti-fuga).
  select * into v_ri from recipe_item
   where id = p_recipe_item_id and account_id = v_account;
  if not found then
    raise exception 'set_menu_item_recipe: el escandallo no existe o no es de esta cuenta';
  end if;
  if v_ri.archived_at is not null then
    raise exception 'set_menu_item_recipe: el escandallo "%" está archivado', v_ri.name;
  end if;

  begin
    update menu_item
       set recipe_item_id = p_recipe_item_id,
           link_approved_at = null,      -- cambiar enlace exige re-aprobar
           link_approved_by = null,
           updated_at = now()
     where id = p_menu_item_id;
  exception when unique_violation then
    -- Índice único (brand_id, channel_id, recipe_item_id): con channel_id no
    -- nulo, otro ítem de la misma marca+canal ya puede usar este escandallo.
    raise exception 'set_menu_item_recipe: ya existe otro ítem de esta marca/canal enlazado al escandallo "%"', v_ri.name;
  end;

  return jsonb_build_object('ok', true, 'menu_item_id', p_menu_item_id,
                            'recipe_item_id', p_recipe_item_id, 'recipe_name', v_ri.name);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2.2 clear_menu_item_recipe — quitar escandallo
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.clear_menu_item_recipe(p_menu_item_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare v_account uuid;
begin
  select account_id into v_account from menu_item where id = p_menu_item_id;
  if v_account is null then
    raise exception 'clear_menu_item_recipe: ítem % no existe', p_menu_item_id;
  end if;
  if not public.current_user_is_admin_of(v_account) then
    raise exception 'clear_menu_item_recipe: sin acceso';
  end if;

  update menu_item
     set recipe_item_id = null, link_approved_at = null, link_approved_by = null,
         updated_at = now()
   where id = p_menu_item_id;

  return jsonb_build_object('ok', true, 'menu_item_id', p_menu_item_id);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2.3 approve_menu_item_link — oficina aprueba
-- No se puede aprobar un enlace roto. Aprobar es el ÚNICO camino al verde.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.approve_menu_item_link(p_menu_item_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_account uuid;
  v_ri_id   uuid;
  v_ri      recipe_item%rowtype;
  v_cost    numeric;
begin
  select account_id, recipe_item_id into v_account, v_ri_id
    from menu_item where id = p_menu_item_id;
  if v_account is null then
    raise exception 'approve_menu_item_link: ítem % no existe', p_menu_item_id;
  end if;
  if not public.current_user_is_admin_of(v_account) then
    raise exception 'approve_menu_item_link: sin acceso';
  end if;
  if v_ri_id is null then
    raise exception 'No se puede aprobar: el ítem no tiene escandallo enlazado';
  end if;
  select * into v_ri from recipe_item where id = v_ri_id;
  if v_ri.archived_at is not null then
    -- Hueco TOCTOU: la receta se archivó DESPUÉS de enlazarla (set_menu_item_recipe
    -- solo comprueba "no archivada" en el momento de enlazar).
    raise exception 'No se puede aprobar: el escandallo "%" está archivado', v_ri.name;
  end if;
  v_cost := coalesce(v_ri.computed_cost, v_ri.fixed_cost);
  if v_cost is null then
    raise exception 'No se puede aprobar: el escandallo no tiene coste';
  end if;
  if v_ri.needs_review then
    raise exception 'No se puede aprobar: el escandallo está marcado a revisión';
  end if;
  if v_cost < 0.50 then   -- umbral "coste imposible" (parametrizar en el front si se quiere)
    raise exception 'No se puede aprobar: coste sospechosamente bajo (% €)', round(v_cost,2);
  end if;

  update menu_item
     set link_approved_at = now(), link_approved_by = auth.uid(), updated_at = now()
   where id = p_menu_item_id;

  return jsonb_build_object('ok', true, 'menu_item_id', p_menu_item_id,
                            'recipe_name', v_ri.name, 'cost', round(v_cost,2));
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 2.4 menu_item_link_health — el barrido (estado honesto por COSTE, no por
-- nombre). Única fuente de verdad del sello — la usa tanto la fila del Menú
-- como la pantalla de barrido. Recalculado en vivo contra el estado ACTUAL
-- de recipe_item en cada llamada (no depende de link_approved_at para decidir
-- "roto"; ese campo es solo el histórico de cuándo se aprobó).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.menu_item_link_health(
  p_account_id uuid, p_brand_id uuid default null
) returns table(
  menu_item_id uuid, item_name text, brand_id uuid, brand_name text,
  recipe_item_id uuid, recipe_name text, cost numeric,
  needs_review boolean, link_approved_at timestamptz,
  status text, shared_with integer
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
    -- Compartición a NIVEL DE CUENTA (un escandallo se puede reutilizar entre
    -- marcas), no limitada por p_brand_id — una sola pasada en vez de una
    -- subconsulta correlada por fila.
    select m2.recipe_item_id, count(*)::int as n
    from menu_item m2
    where m2.account_id = p_account_id
      and m2.archived_at is null
      and m2.recipe_item_id is not null
    group by m2.recipe_item_id
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
    coalesce(sc.n, 0) as shared_with
  from menu_item mi
  left join recipe_item ri on ri.id = mi.recipe_item_id
  left join brand b on b.id = mi.brand_id
  left join share_counts sc on sc.recipe_item_id = mi.recipe_item_id
  where mi.account_id = p_account_id
    and mi.archived_at is null
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

-- ─────────────────────────────────────────────────────────────────────
-- 2.5 menu_item_shared_recipe_review — dato para la IA asesora (futura).
-- Surface de los escandallos compartidos por >1 ítem, con los nombres de los
-- ítems y la lista de ingredientes crudos del escandallo. Esta RPC NO juzga.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.menu_item_shared_recipe_review(p_account_id uuid)
returns table(
  recipe_item_id uuid, recipe_name text, n_items integer,
  item_names text[], raw_ingredients text[]
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'menu_item_shared_recipe_review: sin acceso';
  end if;

  return query
  with shared as (
    select mi.recipe_item_id, ri.name as recipe_name,
           count(distinct mi.id) as n_items,
           array_agg(distinct mi.name) as item_names
    from menu_item mi
    join recipe_item ri on ri.id = mi.recipe_item_id
    where mi.account_id = p_account_id and mi.archived_at is null
    group by mi.recipe_item_id, ri.name
    having count(distinct mi.id) > 1
  )
  select s.recipe_item_id, s.recipe_name, s.n_items::int, s.item_names,
         (select array_agg(distinct ri2.name)
            from public.explode_recipe_to_raws(s.recipe_item_id, 1) e
            join recipe_item ri2 on ri2.id = e.raw_item_id)
  from shared s
  order by s.n_items desc;
end;
$function$;

notify pgrst, 'reload schema';
