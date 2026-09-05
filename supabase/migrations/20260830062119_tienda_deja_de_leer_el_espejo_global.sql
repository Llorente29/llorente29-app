-- ── El unico hogar de la regla de navegacion ────────────────────────────────
create or replace function public.menu_item_vendible_en_alguna_parte(p_menu_item_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select not exists (
    select 1
      from menu_item mi
      join product_availability pa
        on pa.account_id = mi.account_id
       and pa.is_available = false
       and (pa.available_until is null or pa.available_until > now())
       and ( (mi.external_id    is not null and pa.external_id    = mi.external_id)
          or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id) )
     where mi.id = p_menu_item_id
       and ( pa.location_id is null
          or not exists (
               select 1
                 from brand_location_availability bla
                where bla.brand_id = mi.brand_id
                  and bla.is_active = true
                  and not exists (
                        select 1
                          from product_availability pa2
                         where pa2.account_id = mi.account_id
                           and pa2.is_available = false
                           and (pa2.available_until is null or pa2.available_until > now())
                           and (pa2.location_id = bla.location_id or pa2.location_id is null)
                           and ( (mi.external_id    is not null and pa2.external_id    = mi.external_id)
                              or (mi.recipe_item_id is not null and pa2.recipe_item_id = mi.recipe_item_id) )
                      )
             ) )
  );
$function$;

comment on function public.menu_item_vendible_en_alguna_parte(uuid) is
  'Regla de NAVEGACION de la tienda propia (el cliente aun no ha elegido local): '
  'un producto es vendible si lo esta en ALGUN local activo de su marca. NO vale '
  'para el pedido, que si conoce el local y necesita la regla POR LOCAL (paso 2). '
  'Unico hogar de esta regla; copiada de shop_brand_menu_by_slug el 29/08/2026.';

-- ── Las seis puertas de la tienda dejan de mirar el espejo ──────────────────
do $mig$
declare
  v_objetivos text[] := array[
    'public._shop_reprice_line(uuid, jsonb)',
    'public.shop_item_config(text, uuid)',
    'public.shop_hub_by_slug(text)',
    'public._shop_account_free_gift(uuid)',
    'public._shop_brand_free_gift(uuid, uuid)',
    'public.place_shop_order(text, jsonb, boolean)'
  ];
  v_obj   text;
  v_def   text;
  v_n     int;
  v_vieja text := 'mi.is_available is not false';
  v_nueva text := 'public.menu_item_vendible_en_alguna_parte(mi.id)';
begin
  foreach v_obj in array v_objetivos loop
    v_def := pg_get_functiondef(v_obj::regprocedure);

    v_n := (length(v_def) - length(replace(v_def, v_vieja, ''))) / length(v_vieja);
    if v_n <> 1 then
      raise exception 'ABORTA: % tiene % aparicion(es) de "%", se esperaba exactamente 1. '
                      'La funcion ha cambiado desde el 29/08: revisar a mano antes de seguir.',
                      v_obj, v_n, v_vieja;
    end if;

    execute replace(v_def, v_vieja, v_nueva);
    raise notice 'reescrita: %', v_obj;
  end loop;
end
$mig$;

-- ── GUARDA FINAL: no dar nada por hecho ─────────────────────────────────────
do $ver$
declare
  v_objetivos text[] := array[
    'public._shop_reprice_line(uuid, jsonb)',
    'public.shop_item_config(text, uuid)',
    'public.shop_hub_by_slug(text)',
    'public._shop_account_free_gift(uuid)',
    'public._shop_brand_free_gift(uuid, uuid)',
    'public.place_shop_order(text, jsonb, boolean)'
  ];
  v_obj text;
  v_def text;
begin
  if to_regprocedure('public.menu_item_vendible_en_alguna_parte(uuid)') is null then
    raise exception 'El ayudante no quedo creado con la firma esperada';
  end if;

  foreach v_obj in array v_objetivos loop
    v_def := pg_get_functiondef(v_obj::regprocedure);
    if position('mi.is_available is not false' in v_def) > 0 then
      raise exception 'VERIFICACION: % sigue leyendo el espejo global', v_obj;
    end if;
    if position('menu_item_vendible_en_alguna_parte(mi.id)' in v_def) = 0 then
      raise exception 'VERIFICACION: % no quedo con la puerta nueva', v_obj;
    end if;
  end loop;

  raise notice 'VERIFICACION OK: las 6 puertas de la tienda usan la regla nueva';
end
$ver$;