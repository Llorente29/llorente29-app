-- 20260722T1900_menu_add_existing_product.sql
--
-- ENCARGO: "Añadir producto existente" al menú (autonomía del cliente multimarca).
--
-- Reutiliza un producto (identificado por su RECETA) que ya existe en la cuenta,
-- en OTRA marca de la misma cuenta, en una sola acción:
--   · crea el menu_item apuntando al MISMO recipe_item_id  → escandallo vinculado,
--   · y (si el producto tiene modificadores) CLONA sus grupos + opciones +
--     asignaciones a la marca destino (modifier_group es POR-MARCA).
--
-- NO es un mirror (sin sincronización con marca origen) y NO duplica la receta:
-- REUTILIZA la receta. Es exactamente el mismo mecanismo de datos que ya usa
-- addRecipeToBrand() para el item, más el clonado de modificadores por producto.
--
-- Decisiones de diseño (cerradas con Julio, 22/07/2026):
--   · Modificadores: SÍ se traen (clonar grupos). En esta cuenta 71/103 productos
--     reutilizables tienen modificadores, así que reutilizar sin ellos dejaría la
--     mayoría de platos incompletos.
--   · Fuente de los modificadores: entre los menu_item de la cuenta con esa receta,
--     se elige el "más rico" (más grupos asignados; desempate por antigüedad). El
--     cliente sólo conoce la RECETA (dedupe por receta), no la marca origen.
--   · Opciones: se PRESERVA recipe_item_id (mismo account) para no perder el
--     escandallo de cada opción — a diferencia de clone_brand_catalog, que puede ser
--     cross-account y por eso lo anula.
--   · external_id/external_source = NULL en lo clonado (evita choque con los índices
--     únicos uq_modifier_group_external / uq_modifier_option_external).
--   · Dedupe: si la receta ya está ACTIVA en la marca destino → no duplica (skipped).
--     Si existe ARCHIVADA en (brand, channel NULL, recipe) → la reactiva y actualiza
--     PVP/IVA/categoría (mismo criterio que addRecipeToBrand).
--
-- Multi-tenant: SECURITY DEFINER (bypassa RLS) pero valida por ROW que la marca
-- destino y la receta pertenecen a p_account. Grant sólo a authenticated.

create or replace function public.add_existing_product_to_brand(
  p_account          uuid,
  p_dst_brand        uuid,
  p_recipe_item_id   uuid,
  p_name             text,
  p_price            numeric,
  p_vat_rate         numeric default 10,
  p_menu_category_id uuid default null,
  p_with_modifiers   boolean default true
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_src_item      uuid;
  v_existing      uuid;
  v_existing_arch timestamptz;
  v_new_item      uuid;
  v_name          text;
  v_groups        int := 0;
  v_options       int := 0;
begin
  if p_account is null or p_dst_brand is null or p_recipe_item_id is null then
    raise exception 'Parametros nulos no permitidos';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'Precio invalido';
  end if;

  -- Autorización del llamante: el RPC es SECURITY DEFINER (salta RLS), así que hay
  -- que exigir explícitamente que el usuario sea admin de la cuenta — mismo predicado
  -- que el policy menu_item_write. Sin esto, un authenticated podría inyectar un
  -- producto en la marca de OTRA cuenta.
  if not current_user_is_admin_of(p_account) then
    raise exception 'No autorizado para esta cuenta';
  end if;

  -- La marca destino debe pertenecer a la cuenta
  perform 1 from brand where id = p_dst_brand and account_id = p_account;
  if not found then raise exception 'La marca destino no pertenece a la cuenta'; end if;

  -- La receta debe pertenecer a la cuenta
  perform 1 from recipe_item where id = p_recipe_item_id and account_id = p_account;
  if not found then raise exception 'La receta no pertenece a la cuenta'; end if;

  -- Nombre visible: el que pasa el cliente (lo que vio en el buscador) o, si viene
  -- vacío, el nombre de la receta.
  v_name := coalesce(nullif(btrim(p_name), ''),
                     (select name from recipe_item where id = p_recipe_item_id));

  -- Dedupe sobre (brand, channel NULL, recipe): el producto base en la marca.
  select id, archived_at into v_existing, v_existing_arch
    from menu_item
   where brand_id = p_dst_brand
     and recipe_item_id = p_recipe_item_id
     and channel_id is null
   limit 1;

  if v_existing is not null then
    if v_existing_arch is null then
      -- Ya está activo en esta marca: no duplicar.
      return jsonb_build_object('status','skipped','menu_item_id',v_existing,
                                'name',v_name,'groups_cloned',0,'options_cloned',0);
    end if;
    -- Archivado: reactivar + actualizar PVP/IVA/categoría.
    update menu_item
       set is_active = true, archived_at = null, price = p_price,
           vat_rate = coalesce(p_vat_rate, 10),
           menu_category_id = coalesce(p_menu_category_id, menu_category_id)
     where id = v_existing;
    return jsonb_build_object('status','reactivated','menu_item_id',v_existing,
                              'name',v_name,'groups_cloned',0,'options_cloned',0);
  end if;

  -- Alta del producto (reutiliza la receta → escandallo vinculado). channel_id NULL:
  -- el precio por canal se ajusta luego con menu_item_override.
  insert into menu_item (account_id, brand_id, recipe_item_id, name, price, vat_rate,
                         product_type, menu_category_id, channel_id, is_available, source)
  values (p_account, p_dst_brand, p_recipe_item_id, v_name, p_price, coalesce(p_vat_rate, 10),
          'item', p_menu_category_id, null, true, 'manual')
  returning id into v_new_item;

  -- Modificadores: clonar los grupos del menu_item "más rico" con esa receta.
  if p_with_modifiers then
    select m.id into v_src_item
      from menu_item m
     where m.account_id = p_account
       and m.recipe_item_id = p_recipe_item_id
       and m.archived_at is null
       and m.id <> v_new_item
     order by (select count(*) from modifier_group_assignment a where a.menu_item_id = m.id) desc,
              m.created_at asc
     limit 1;

    if v_src_item is not null then
      create temp table _map_g (old_id uuid, new_id uuid) on commit drop;

      -- Un uuid nuevo por cada grupo distinto asignado al producto origen.
      insert into _map_g(old_id, new_id)
      select distinct a.modifier_group_id, gen_random_uuid()
        from modifier_group_assignment a
       where a.menu_item_id = v_src_item;

      -- Grupos (por-marca) → a la marca destino, sin external_*.
      insert into modifier_group (id, account_id, brand_id, name, internal_name, group_type,
                                  min_selections, max_selections, allow_repetition, position,
                                  is_active, external_id, external_source)
      select mg.new_id, p_account, p_dst_brand, g.name, g.internal_name, g.group_type,
             g.min_selections, g.max_selections, g.allow_repetition, g.position,
             g.is_active, null, null
        from modifier_group g
        join _map_g mg on mg.old_id = g.id;
      get diagnostics v_groups = row_count;

      -- Opciones: PRESERVA recipe_item_id (mismo account) → conserva su escandallo.
      insert into modifier_option (id, account_id, modifier_group_id, name, price_impact,
                                   is_default, recipe_item_id, position, is_active,
                                   external_id, external_source)
      select gen_random_uuid(), p_account, mg.new_id, o.name, o.price_impact,
             o.is_default, o.recipe_item_id, o.position, o.is_active, null, null
        from modifier_option o
        join _map_g mg on mg.old_id = o.modifier_group_id;
      get diagnostics v_options = row_count;

      -- Asignaciones: nuevo producto ↔ nuevos grupos (conserva la posición).
      insert into modifier_group_assignment (account_id, menu_item_id, modifier_group_id, position)
      select p_account, v_new_item, mg.new_id, a.position
        from modifier_group_assignment a
        join _map_g mg on mg.old_id = a.modifier_group_id
       where a.menu_item_id = v_src_item;
    end if;
  end if;

  return jsonb_build_object('status','created','menu_item_id',v_new_item,
                            'name',v_name,'groups_cloned',v_groups,'options_cloned',v_options);
end;
$function$;

grant execute on function public.add_existing_product_to_brand(
  uuid, uuid, uuid, text, numeric, numeric, uuid, boolean
) to authenticated;
