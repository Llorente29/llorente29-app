-- 20260828T1250_availability_panel_core_last_fuera_del_86.sql
-- ============================================================================
-- REGISTRO DE LO QUE YA CORRE. Aplicado a mano en produccion el 28/08 ~12:50.
-- ============================================================================
-- Esto NO es un cambio nuevo: es la definicion viva, transcrita para que el
-- repositorio deje de ir por detras. Reaplicar la version anterior del repo
-- encima retrocederia el cambio EN SILENCIO — es exactamente lo que paso con
-- order_for_print y orders_feed.
--
-- QUE HACE. La CTE `last_off` lleva un `and false`, asi que el panel del 86 no
-- muestra NADA que venga de Last: ni cedidas, ni propias, ni en ningun local.
--
--   Decision de Julio, 28/08: «QUITA TODO LO RELACIONADO CON EL 86 DE LAST,
--   cedidas y propias y cualquier local. En un futuro volveremos pero ahora no.»
--
-- Verificado tras aplicarlo: 0 tarjetas de Last en Alcala, en Carabanchel y en
-- la vista de todos los locales. 57 tarjetas, todas de Folvy.
-- Contexto: claude/folvy_86_last_fuera_alcala_20260828.md
--
-- MARCHA ATRAS: quitar el `and false` de la CTE `last_off`. Nada mas. El resto
-- de la funcion no se toco, y el filtro vive DENTRO de la funcion a proposito:
-- la alternativa era desactivar filas de external_location_map, que las leen
-- tambien la importacion de ventas de Last y lastapp-sync-catalog, y habria
-- puesto en riesgo la entrada de pedidos de Just Eat en Camichi.
--
-- FIDELIDAD: salida literal de
--   SELECT pg_get_functiondef('public._availability_panel_core(uuid,uuid)'::regprocedure);
-- verificada byte a byte contra produccion: md5 046155c974a7bc9d3fed39b2306a461e
-- (5.175 caracteres). Aplicar este fichero hoy es un no-op: es lo mismo que ya
-- esta vivo.
--
-- OJO — SE PIERDEN DOS COMENTARIOS. La version viva NO trae dos bloques que si
-- estaban en 20260825T2500: el que explicaba la expansion de marcas por
-- matricula, y el que explicaba por que la cara de la tarjeta sale de UNA sola
-- fila («Antes cada campo salia del max() de su columna, y podian ser filas
-- distintas»). La LOGICA es identica; solo falta la explicacion. No se re-anaden
-- aqui porque el fichero tiene que casar byte a byte con lo vivo; recuperarlos
-- exige un CREATE OR REPLACE nuevo, y eso es una decision aparte.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._availability_panel_core(p_account_id uuid, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_key text, name text, representative_menu_item_id uuid, recipe_item_id uuid, location_id uuid, location_name text, brands integer, brand_names text[], otros_nombres text[], photo_url text, source_folvy boolean, source_last boolean, reason text, available_until timestamp with time zone, set_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
      -- 28/08/2026 · Julio: LAST FUERA DEL PANEL DEL 86, todas las marcas y locales.
      -- Provisional. Para revertir: quitar el "and false" de la linea siguiente.
      and false
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
$function$
;
