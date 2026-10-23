-- supabase/migrations/20261208T0840_c08_lovers_catalogo_2qjdb.sql
--
-- C08 · DATOS: Lovers Burgers de Carabanchel publica en el catálogo de HubRise
-- que sí existe (Julio, 23/10). Una sola fila de brand_hubrise_catalog.
--
-- Medido el 23/10 a las 16:15 UTC con la API de HubRise (GET, solo lectura,
-- con el token escritor de la cuenta, desde la base):
--   · q3v47 → 404 «Catalog does not exist». Lo creó «Conectar a delivery» a
--     las 15:40 UTC: buscó en la location un catálogo llamado «Lovers Burgers»
--     (el nombre de la marca), no lo encontró —el de HubRise se llama «Lovers
--     Burger», sin la s— y creó otro. Ese otro ya no está.
--   · 2qjdb → existe, «Lovers Burger», location 1b6p8-2 (Carabanchel, cuenta
--     HubRise 1b6p8), creado a las 15:28 UTC. Es el que usa Uber Eats de
--     Carabanchel, con la publicación automática encendida.
--
-- Cambia external_catalog_id de q3v47 a 2qjdb en la fila 84c5951d-…, y nada
-- más. Anclado por id, cuenta, marca y location (regla 9). PARA si la fila no
-- está como se midió (otro catálogo, o ya cambiada). En staging, nada: no
-- tiene la cuenta de Foodint.
-- No toca el camino del pedido (lo leen hubrise-catalog-publish y
-- availability-dispatch, al publicar la carta), ni coste ni stock.
-- Vuelta atrás: supabase/vuelta-atras/20261208T0840_c08_lovers_catalogo_2qjdb.down.sql
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_fila constant uuid := '84c5951d-461d-454a-9fad-7b3bafd7e85b';
  v_marca constant uuid := '99dff23e-98a8-46ab-af54-0cc19d036b72';
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'C08 0840: esta base no tiene la cuenta de Foodint (staging): no hay fila que cambiar.';
    return;
  end if;
  update public.brand_hubrise_catalog
     set external_catalog_id = '2qjdb'
   where id = v_fila and account_id = v_acc and brand_id = v_marca
     and external_location_id = '1b6p8-2' and external_catalog_id = 'q3v47';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'C08 0840: la fila de Lovers Burgers en Carabanchel no está como se midió (q3v47): cambiadas %. No se cambia nada: vuelve a medir.', v_n;
  end if;
  raise notice 'C08 0840: Lovers Burgers · Carabanchel, del catálogo q3v47 (no existe en HubRise) al 2qjdb.';
end $$;
