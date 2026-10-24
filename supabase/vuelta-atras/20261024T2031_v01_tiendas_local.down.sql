-- supabase/vuelta-atras/20261024T2031_v01_tiendas_local.down.sql
--
-- Vuelta atrás de 20261024T2031_v01_tiendas_local.sql: quita el disparador y
-- las dos funciones, y devuelve a cada tienda el local que tenía antes, desde
-- la copia previa (conta_tienda_local_antes). Solo a las que siguen con el
-- local que se les puso: si alguien lo cambió después a mano, se respeta.

drop trigger if exists conta_tienda_local_por_direccion on public.platform_store;
drop function if exists public._conta_tienda_local_por_direccion();

do $$
begin
  if to_regclass('public.conta_tienda_local_antes') is not null then
    update public.platform_store ps
       set location_id = c.location_antes,
           updated_at = now(),
           updated_by_name = 'V01 · vuelta atrás del local por su dirección'
      from public.conta_tienda_local_antes c
     where c.store_id = ps.id
       and ps.location_id is not distinct from c.location_puesto;
  end if;
end $$;

drop table if exists public.conta_tienda_local_antes;
drop function if exists public.conta_local_de_tienda(uuid, text);
drop function if exists public.conta_clave_direccion(text);
