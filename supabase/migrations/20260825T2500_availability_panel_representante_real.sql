-- 20260825T2500_availability_panel_representante_real.sql
--
-- ── EL PARTE ─────────────────────────────────────────────────────────────
-- Reportado: "PRODUCTOS AGOTADOS EN FOODINT ALCALA muestra productos cuyo
-- override esta en otro local". Caso: "Burrito de cochinita (BB)", override en
-- Carabanchel (92d7656e, manual, 19/08), aparece en Alcala con un boton
-- "Reactivar en Folvy" que no hace nada.
--
-- La lista SI filtra por local. El filtro final es
--   where (p_location_id is null or g.loc = p_location_id or g.loc is null)
-- y la fila de Alcala es de Alcala de verdad. Lo que pasa es otra cosa, peor:
-- la tarjeta lleva el nombre y el boton de OTRO producto.
--
-- ── LO QUE HAY DEBAJO ────────────────────────────────────────────────────
-- Tres productos de tres marcas; dos comparten escandallo 6e758cbe
-- ("Burrito Colosal de Cochinita"):
--
--   Burrito Colosal de Cochinita *   1d5a0c4f  Bendito Burrito  (sin receta)
--   BURRITO DE BIRRIA DE CERDO (DC)  3fa3daee  Dos Coyotes      6e758cbe
--   Burrito de cochinita (BB)        ee92da9a  Birria Burrito   6e758cbe
--
-- En Alcala hay dos cosas apagadas, de productos DISTINTOS:
--
--   folvy_off  3fa3daee  BURRITO DE BIRRIA DE CERDO (DC)  override manual 24/08
--   last_off   ee92da9a  Burrito de cochinita (BB)        apagado en catalogo Last
--
-- Agrupar por escandallo es coherente con el motor: _set_product_availability_core
-- cascadea por recipe_item_id/stock_group_id, asi que agotar uno agota a sus
-- hermanos y una sola tarjeta es lo correcto. El fallo es COMO elige su cara:
--
--   max(nm)       -> 'Burrito de cochinita (BB)' gana a 'BURRITO DE BIRRIA...'
--                    porque en C la minuscula pesa mas que la mayuscula
--   max(repr_id)  -> 'af79f846' gana a '3ca8f4c0' por orden de UUID
--
-- Dos desempates arbitrarios, y cada campo salia del max() de SU columna, o
-- sea de filas distintas. El representante acaba siendo Birria Burrito, que en
-- Alcala solo esta apagado en Last: no tiene override de Folvy que deshacer.
-- Y el borrado de _set_product_availability_core busca
--
--   pa.external_id = 'ee92da9a' OR pa.recipe_item_id = '6e758cbe'
--
-- mientras la fila real de Alcala guarda external_id='3fa3daee' y
-- recipe_item_id='616afc43' (la receta de cuando se escribio; el menu_item se
-- recaso despues). Ni una rama ni la otra. Medido: el boton borra 0 filas.
--
-- No es un caso aislado: 10 de los 26 overrides activos guardan una receta que
-- ya no es la de su menu_item.
--
-- ── EL ARREGLO ───────────────────────────────────────────────────────────
-- La tarjeta elige la fila que de verdad tiene override de Folvy en ESE local,
-- la mas reciente primero. Nombre, representante, motivo, hasta-cuando y set_at
-- salen todos de LA MISMA fila.
--
-- Con eso el representante pasa a ser 3ca8f4c0 (Dos Coyotes), su external_id es
-- '3fa3daee' y el borrado casa por la primera rama — sin depender de la receta
-- guardada, que es justo lo que estaba desincronizado en esas 10.
--
-- Se anade `otros_nombres`: los demas productos que caen en la misma tarjeta.
-- La tarjeta deja de esconder que habla de varios.
--
-- ── Y SE DEJA DE DUPLICAR ────────────────────────────────────────────────
-- availability_panel_by_token (la tablet de cocina) NO llamaba a
-- availability_panel: repetia la consulta entera copiada, con el mismo bug.
-- Arreglar solo oficina habria dejado a cocina mintiendo. Se extrae el nucleo
-- a _availability_panel_core y las dos pasan a llamarlo, cada una con su
-- puerta: oficina por rol, la tablet por token de dispositivo.
--
-- El motor no se toca: _set_product_availability_core queda igual y la cascada
-- cross-marca sigue siendo la misma. Solo cambia a quien apunta la pantalla.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) El nucleo, sin puerta (privado) y en un solo sitio.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._availability_panel_core(
  p_account_id uuid,
  p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_key text, name text, representative_menu_item_id uuid,
               recipe_item_id uuid, location_id uuid, location_name text,
               brands integer, brand_names text[], otros_nombres text[],
               photo_url text, source_folvy boolean, source_last boolean,
               reason text, available_until timestamp with time zone,
               set_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with
  last_off as (
    select ecp.organization_product_id::text as matricula, elm.location_id as loc
    from external_catalog_product ecp
    join external_location_map elm
      on elm.account_id = ecp.account_id and elm.source='lastapp'
     and elm.external_location_id = ecp.external_location_id::text and elm.is_active
    where ecp.account_id = p_account_id and ecp.source='lastapp' and ecp.is_enabled=false
    group by ecp.organization_product_id::text, elm.location_id
  ),
  folvy_off as (
    select pa.external_id as matricula, pa.recipe_item_id as rec_id, pa.location_id as loc,
           pa.reason as r_reason, pa.available_until as r_until, pa.set_at as r_set
    from product_availability pa
    where pa.account_id = p_account_id and pa.is_available = false
  ),
  ident as (
    select mi.external_id,
           max(mi.recipe_item_id::text)                                        as rec,
           min(mi.name)                                                        as nm,
           min(mi.id::text)                                                    as repr_id,
           count(distinct mi.brand_id)                                         as brs,
           array_agg(distinct b.name) filter (where b.name is not null)        as bnames,
           (array_agg(mi.photo_url) filter (where mi.photo_url is not null))[1] as photo
    from menu_item mi
    left join brand b on b.id = mi.brand_id
    where mi.account_id = p_account_id and mi.external_id is not null
    group by mi.external_id
  ),
  unioned as (
    select matricula, loc, true as s_last, false as s_folvy,
           null::text as u_reason, null::timestamptz as u_until, null::timestamptz as u_set
    from last_off
    union all
    select matricula, loc, false, true, r_reason, r_until, r_set
    from folvy_off
  ),
  -- expandimos las marcas de cada matrícula para reagregarlas a nivel producto×local
  exp as (
    select u.matricula, u.loc, u.s_last, u.s_folvy, u.u_reason, u.u_until, u.u_set,
           i.rec, i.nm, i.repr_id, i.brs, i.photo, i.external_id as i_ext,
           bn as brand_name
    from unioned u
    left join ident i on i.external_id = u.matricula
    left join lateral unnest(coalesce(i.bnames, array[]::text[])) as bn on true
  ),
  grouped as (
    select coalesce(rec, matricula)                                           as pkey,
           -- La cara de la tarjeta sale de UNA sola fila: la que de verdad tiene
           -- override de Folvy aquí, la más reciente primero. Antes cada campo
           -- salía del max() de su columna, y podían ser filas distintas.
           (array_agg(nm       order by s_folvy desc, (nm is null),
                                        u_set desc nulls last, repr_id))[1]    as nm,
           (array_agg(repr_id  order by s_folvy desc, (nm is null),
                                        u_set desc nulls last, repr_id))[1]    as repr,
           (array_agg(u_reason order by s_folvy desc, (nm is null),
                                        u_set desc nulls last, repr_id))[1]    as g_reason,
           (array_agg(u_until  order by s_folvy desc, (nm is null),
                                        u_set desc nulls last, repr_id))[1]    as g_until,
           (array_agg(u_set    order by s_folvy desc, (nm is null),
                                        u_set desc nulls last, repr_id))[1]    as g_set,
           max(rec)                                                           as rec,
           loc,
           max(brs)                                                           as brs,
           array_agg(distinct brand_name) filter (where brand_name is not null) as bnames,
           array_agg(distinct nm) filter (where nm is not null)                as all_names,
           (array_agg(photo) filter (where photo is not null))[1]            as photo,
           bool_or(s_folvy)                                                   as s_folvy,
           bool_or(s_last)                                                    as s_last,
           bool_or(i_ext is not null)                                         as tiene_ficha
    from exp
    group by coalesce(rec, matricula), loc
  )
  select g.pkey, coalesce(g.nm,'(producto)'), g.repr::uuid, g.rec::uuid,
         g.loc, l.name, coalesce(g.brs,0)::int, g.bnames,
         (select array_agg(x) from unnest(coalesce(g.all_names, array[]::text[])) x
           where x is distinct from g.nm),
         g.photo,
         g.s_folvy, g.s_last,
         coalesce(g.g_reason,'manual'), g.g_until, g.g_set
  from grouped g
  left join locations l on l.id = g.loc
  where (p_location_id is null or g.loc = p_location_id or g.loc is null)
    and g.tiene_ficha and coalesce(g.brs,0) > 0
  order by g.nm;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Oficina: misma firma de entrada, una columna mas de salida.
--    Cambia el tipo de retorno, asi que DROP + CREATE.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.availability_panel(uuid, uuid);

CREATE FUNCTION public.availability_panel(
  p_account_id uuid,
  p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_key text, name text, representative_menu_item_id uuid,
               recipe_item_id uuid, location_id uuid, location_name text,
               brands integer, brand_names text[], otros_nombres text[],
               photo_url text, source_folvy boolean, source_last boolean,
               reason text, available_until timestamp with time zone,
               set_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'availability_panel: sin acceso a la cuenta %', p_account_id;
  end if;

  return query select * from public._availability_panel_core(p_account_id, p_location_id);
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Tablet de cocina: deja de repetir la consulta. Misma firma, mismas
--    claves de siempre + otros_nombres.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.availability_panel_by_token(p_device_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'availability_panel_by_token: token no válido';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'product_key',                 p.product_key,
      'name',                        p.name,
      'representative_menu_item_id', p.representative_menu_item_id,
      'recipe_item_id',              p.recipe_item_id,
      'location_id',                 p.location_id,
      'location_name',               p.location_name,
      'brands',                      p.brands,
      'brand_names',                 p.brand_names,
      'otros_nombres',               p.otros_nombres,
      'photo_url',                   p.photo_url,
      'source_folvy',                p.source_folvy,
      'source_last',                 p.source_last,
      'reason',                      p.reason,
      'available_until',             p.available_until,
      'set_at',                      p.set_at
    ) order by p.name)
    from public._availability_panel_core(v_device.account_id, v_device.location_id) p
  ), '[]'::jsonb);
end;
$function$;

-- El nucleo no lleva puerta: que no lo pueda llamar nadie de fuera.
REVOKE ALL ON FUNCTION public._availability_panel_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._availability_panel_core(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
