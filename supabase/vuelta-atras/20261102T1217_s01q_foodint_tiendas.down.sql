-- supabase/vuelta-atras/20261102T1217_s01q_foodint_tiendas.down.sql
--
-- Vuelta atrás de la 1217: las tiendas, sus tramos y sus liquidaciones vuelven al
-- local y la marca de antes (los guardó la 1217 en conta_s01q_tienda_antes), y
-- cada liquidación vuelve a decir si queda por aclarar.
do $$
declare r record;
begin
  if to_regclass('public.conta_s01q_tienda_antes') is null then return; end if;
  update public.platform_store s set location_id = a.location_id, brand_id = a.brand_id, updated_at = now()
    from public.conta_s01q_tienda_antes a where a.tabla = 'platform_store' and a.fila = s.id;
  update public.platform_store_tramo x set location_id = a.location_id, brand_id = a.brand_id
    from public.conta_s01q_tienda_antes a where a.tabla = 'platform_store_tramo' and a.fila = x.id;
  update public.channel_settlement cs set location_id = a.location_id, brand_id = a.brand_id, updated_at = now()
    from public.conta_s01q_tienda_antes a where a.tabla = 'channel_settlement' and a.fila = cs.id;
  for r in select fila from public.conta_s01q_tienda_antes where tabla = 'channel_settlement' loop
    perform public._conta_liquidacion_marcar(r.fila);
  end loop;
  drop table public.conta_s01q_tienda_antes;
end $$;
