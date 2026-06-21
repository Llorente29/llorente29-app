-- ============================================================================
-- FIX: availability_panel_by_token NO delega en availability_panel (que tiene
-- guard de sesión y aborta sin auth.uid()). Replica su lectura directamente,
-- validando solo el TOKEN. account + location salen del dispositivo.
-- ============================================================================
create or replace function public.availability_panel_by_token(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_location_id uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'availability_panel_by_token: token no válido';
  end if;
  update kds_device set last_seen_at = now() where id = v_device.id;
  v_account_id  := v_device.account_id;
  v_location_id := v_device.location_id;

  return coalesce((
    with
    last_off as (
      select ecp.organization_product_id::text as matricula, elm.location_id as loc
      from external_catalog_product ecp
      join external_location_map elm
        on elm.account_id = ecp.account_id and elm.source='lastapp'
       and elm.external_location_id = ecp.external_location_id::text and elm.is_active
      where ecp.account_id = v_account_id and ecp.source='lastapp' and ecp.is_enabled=false
      group by ecp.organization_product_id::text, elm.location_id
    ),
    folvy_off as (
      select pa.external_id as matricula, pa.recipe_item_id as rec_id, pa.location_id as loc,
             pa.reason as r_reason, pa.available_until as r_until, pa.set_at as r_set
      from product_availability pa
      where pa.account_id = v_account_id and pa.is_available = false
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
      where mi.account_id = v_account_id and mi.external_id is not null
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
             max(nm)                                                            as nm,
             max(repr_id)                                                       as repr,
             max(rec)                                                           as rec,
             loc,
             max(brs)                                                           as brs,
             array_agg(distinct brand_name) filter (where brand_name is not null) as bnames,
             (array_agg(photo) filter (where photo is not null))[1]            as photo,
             bool_or(s_folvy)                                                   as s_folvy,
             bool_or(s_last)                                                    as s_last,
             max(u_reason)                                                      as g_reason,
             max(u_until)                                                       as g_until,
             max(u_set)                                                         as g_set,
             bool_or(i_ext is not null)                                         as tiene_ficha
      from exp
      group by coalesce(rec, matricula), loc
    )
    select jsonb_agg(jsonb_build_object(
      'product_key',                 g.pkey,
      'name',                        coalesce(g.nm,'(producto)'),
      'representative_menu_item_id', g.repr::uuid,
      'recipe_item_id',              g.rec::uuid,
      'location_id',                 g.loc,
      'location_name',               l.name,
      'brands',                      coalesce(g.brs,0)::int,
      'brand_names',                 g.bnames,
      'photo_url',                   g.photo,
      'source_folvy',                g.s_folvy,
      'source_last',                 g.s_last,
      'reason',                      coalesce(g.g_reason,'manual'),
      'available_until',             g.g_until,
      'set_at',                      g.g_set
    ) order by g.nm)
    from grouped g
    left join locations l on l.id = g.loc
    where (v_location_id is null or g.loc = v_location_id or g.loc is null)
      and g.tiene_ficha and coalesce(g.brs,0) > 0
  ), '[]'::jsonb);
end;
$function$;
