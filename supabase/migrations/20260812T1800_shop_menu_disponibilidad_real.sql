-- 20260812T1800_shop_menu_disponibilidad_real.sql
-- Aplicada: 2026-08-12 por MCP. VERIFICADA llamando a la propia funcion:
--   Bendito Burrito 17 -> 28 productos visibles · Meraki Pita 25 -> 31 ·
--   Scandal Burgers 21 -> 27 · Mila's Sandwiches 18 -> 23 ·
--   The Urban Kebab 26 -> 31 · Milanesa House 26 -> 29 ·
--   Smash Brothers 20 -> 23 · Dirty Burger 18 -> 21.
--
-- La TIENDA PROPIA ocultaba 46 productos a los clientes finales sin motivo.
--
-- Mismo fallo que el TPV (migracion 20260812T1138): shop_brand_menu_by_slug
-- filtraba por mi.is_available, columna MUERTA importada de Last (su 'enabled'
-- significa "fuera de esta carta", NO "agotado"). Ultimo cambio: 10/08; no la
-- mantiene nadie.
--
-- MEDIDO ANTES DE APLICAR: los 46 ocultos, y NINGUNO tenia fila real de agotado
-- en product_availability. Bendito Burrito perdia ~40% de su carta online.
-- Esto es venta directa perdida, no una pantalla interna.
--
-- DIFERENCIA CON EL TPV: esta funcion NO recibe location_id (la tienda es de
-- cara al cliente, no de un local). Pero YA calcula v_location_ids: los locales
-- activos donde opera la marca. Criterio correcto para una tienda: ocultar un
-- producto solo si esta agotado en TODOS esos locales (o si tiene fila global,
-- location_id null). Si queda en alguno, se puede servir.
--
-- Se respeta available_until: una fila caducada no oculta.
--
-- Sustitucion QUIRURGICA sobre el cuerpo vivo con guard de ocurrencia unica.
--
-- NO reejecutar contra produccion: ya esta aplicada (el guard abortaria).

do $$
declare v_src text; v_new text; v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='shop_brand_menu_by_slug';

  if v_src is null then
    raise exception 'shop_brand_menu_by_slug no existe';
  end if;

  v_hits := (length(v_src) - length(replace(v_src, 'and mi.is_available is not false', '')))
            / length('and mi.is_available is not false');
  if v_hits <> 1 then
    raise exception 'esperaba 1 ocurrencia del filtro, encontradas %', v_hits;
  end if;

  v_new := replace(v_src,
    'and mi.is_available is not false',
    'and not exists (
       select 1 from product_availability pa
        where pa.account_id = mi.account_id
          and pa.is_available = false
          and (pa.available_until is null or pa.available_until > now())
          and ((mi.external_id is not null and pa.external_id = mi.external_id)
            or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id))
          and (
            pa.location_id is null
            or not exists (
              select 1
                from brand_location_availability bla2
               where bla2.brand_id = p_brand_id
                 and bla2.is_active = true
                 and not exists (
                   select 1 from product_availability pa2
                    where pa2.account_id = mi.account_id
                      and pa2.is_available = false
                      and (pa2.available_until is null or pa2.available_until > now())
                      and (pa2.location_id = bla2.location_id or pa2.location_id is null)
                      and ((mi.external_id is not null and pa2.external_id = mi.external_id)
                        or (mi.recipe_item_id is not null and pa2.recipe_item_id = mi.recipe_item_id))
                 )
            )
          )
     )');

  execute v_new;
end $$;

do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='shop_brand_menu_by_slug';
  if v_src ilike '%mi.is_available is not false%' then
    raise exception 'el filtro viejo sigue presente';
  end if;
  if v_src not ilike '%product_availability%' then
    raise exception 'no quedo la fuente correcta';
  end if;
end $$;

notify pgrst, 'reload schema';
