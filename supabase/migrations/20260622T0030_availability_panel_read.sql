-- 20260622T0030_availability_panel_read.sql
-- ============================================================================
-- PANEL DE DISPONIBILIDAD — función de LECTURA (solo SELECT).
-- Une las DOS fuentes de "agotado" y las agrupa por PRODUCTO FÍSICO:
--   (1) agotado desde Folvy  -> product_availability (is_available=false)
--   (2) agotado en Last      -> external_catalog_product (is_enabled=false)
-- Respeta el filtro de local (p_location_id null = todos los locales).
-- Agrupa duplicados propia/cedida por recipe_item_id (la unión de matrículas).
-- Devuelve una fila por (producto físico × local) agotado, con origen.
--
-- Solo lectura, sin empuje, sin secret. SECURITY DEFINER con guard (auth.uid()
-- desde la app). Crea la función, no la ejecuta -> segura en el SQL Editor.
-- ============================================================================

create or replace function public.availability_panel(
  p_account_id  uuid,
  p_location_id uuid default null
)
returns table (
  product_key       text,        -- clave de agrupación (recipe_item_id o matrícula)
  name              text,
  representative_menu_item_id uuid,
  recipe_item_id    uuid,
  location_id       uuid,        -- local Folvy (null = no atribuible / todos)
  location_name     text,
  brands            int,
  source_folvy      boolean,     -- agotado desde Folvy (product_availability)
  source_last       boolean,     -- agotado en Last (espejo is_enabled=false)
  reason            text,
  available_until   timestamptz,
  set_at            timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- guard
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'availability_panel: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with
  -- (2) agotado en Last: producto × local, vía el mapa de locations
  last_off as (
    select
      ecp.organization_product_id::text                       as matricula,
      elm.location_id                                          as loc,
      bool_or(true)                                            as off
    from external_catalog_product ecp
    join external_location_map elm
      on elm.account_id = ecp.account_id and elm.source='lastapp'
     and elm.external_location_id = ecp.external_location_id::text and elm.is_active
    where ecp.account_id = p_account_id
      and ecp.source = 'lastapp'
      and ecp.is_enabled = false
    group by ecp.organization_product_id::text, elm.location_id
  ),
  -- (1) agotado desde Folvy
  folvy_off as (
    select pa.external_id as matricula, pa.recipe_item_id, pa.location_id as loc,
           pa.reason, pa.available_until, pa.set_at
    from product_availability pa
    where pa.account_id = p_account_id and pa.is_available = false
  ),
  -- identidad: matrícula -> recipe_item_id (la unión), nombre, marcas, ficha repr.
  ident as (
    select mi.external_id,
           max(mi.recipe_item_id::text)                        as rec,
           min(mi.name)                                        as name,
           count(distinct mi.brand_id)                         as brands,
           min(mi.id::text)                                    as repr
    from menu_item mi
    where mi.account_id = p_account_id and mi.external_id is not null
    group by mi.external_id
  ),
  -- unir ambas fuentes a nivel (matrícula × local)
  unioned as (
    select matricula, loc, true as s_last, false as s_folvy,
           null::text as reason, null::timestamptz as until, null::timestamptz as set_at
    from last_off
    union all
    select matricula, loc, false, true,
           reason, available_until, set_at
    from folvy_off
  ),
  -- colapsar por PRODUCTO FÍSICO (recipe_item si existe; si no, matrícula) × local
  grouped as (
    select
      coalesce(i.rec, u.matricula)                             as product_key,
      max(i.name)                                              as name,
      max(i.repr)                                              as repr,
      max(i.rec)                                               as rec,
      u.loc                                                    as loc,
      max(i.brands)                                            as brands,
      bool_or(u.s_folvy)                                       as s_folvy,
      bool_or(u.s_last)                                        as s_last,
      max(u.reason)                                            as reason,
      max(u.until)                                             as until,
      max(u.set_at)                                            as set_at
    from unioned u
    left join ident i on i.external_id = u.matricula
    group by coalesce(i.rec, u.matricula), u.loc
  )
  select
    g.product_key,
    coalesce(g.name, '(producto)'),
    g.repr::uuid,
    g.rec::uuid,
    g.loc,
    l.name,
    coalesce(g.brands, 0),
    g.s_folvy,
    g.s_last,
    coalesce(g.reason, 'manual'),
    g.until,
    g.set_at
  from grouped g
  left join locations l on l.id = g.loc
  where p_location_id is null
     or g.loc = p_location_id
     or g.loc is null
  order by g.name;
end;
$function$;
