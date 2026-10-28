-- supabase/vuelta-atras/20261027T1910_f01b_cambios_carta.down.sql
--
-- Vuelta atrás de la 1910 (F01 · PR 2 · cambios de carta), que solo añade: se
-- quitan sus funciones y sus dos tablas, en orden inverso. El espejo de los
-- extras se vuelve a llenar solo con la próxima sincronización si se reaplica.
-- PARA si ya hay precios puestos desde Last (external_catalog_change con filas):
-- son cambios en la carta de alguien, con su apunte; antes se decide qué hacer.
-- Lo que se guardó desde la pantalla en tablas que existían (lo que descuentan
-- los extras, los platos añadidos) se queda: es verdad con o sin la 1910.

do $$
begin
  if to_regclass('public.external_catalog_change') is not null and exists (select 1 from public.external_catalog_change) then
    raise exception 'F01b: hay % precios puestos desde Last con su apunte: no se quita la 1910 sin decidir antes qué pasa con ellos.',
      (select count(*) from public.external_catalog_change);
  end if;
end $$;

drop function if exists public.f01_espejo_extras(uuid, uuid, jsonb);
drop function if exists public.f01_poner_precios_de_last(uuid, uuid);
drop function if exists public.f01_guardar_extras(uuid, uuid, jsonb);
drop function if exists public.f01_anadir_platos_nuevos(uuid, uuid);
drop function if exists public._f01b_quien(uuid);
drop function if exists public._f01b_last_de(uuid, uuid);
drop function if exists public.f01_cambios_carta(uuid);
drop function if exists public._f01b_cambios_marca(uuid, uuid, uuid, text);
drop function if exists public._f01b_extras(uuid, uuid);
drop function if exists public._f01b_propuesta(uuid, text);
drop table if exists public.external_catalog_change;
drop table if exists public.external_catalog_modifier;
