-- 20260815T1950_hubrise_effective_price.sql
-- ENCARGO CODE — módulo de conexión HubRise, FASE 1.5.
-- Aplicada por MCP (verificada 2026-08-15: pg_get_functiondef confirma la
-- definición; test de regresión ejecutado con 0 mismatches sobre 1506
-- combos producto×canal-delivery de todas las marcas catalog_source='folvy').
--
-- effective_price(): cascada de precio única, firmada, consumible por
-- publish/TPV/Shop/economía. Cascada: (local+canal) → (local) →
-- (canal global) → menu_item.price (base). Hoy NO hay overrides de local
-- (0 filas con location_id en menu_item_override, verificado); con
-- p_location_id arbitrario la cascada colapsa exactamente al comportamiento
-- actual de hubrise-catalog-publish: (canal global) → base.

create or replace function public.effective_price(
  p_menu_item_id uuid,
  p_channel_id uuid default null,
  p_location_id uuid default null
) returns numeric
language sql
stable
as $$
  select coalesce(
    (select mio.price from public.menu_item_override mio
      where mio.menu_item_id = p_menu_item_id
        and p_channel_id is not null and mio.channel_id = p_channel_id
        and p_location_id is not null and mio.location_id = p_location_id
        and mio.price is not null
      limit 1),
    (select mio.price from public.menu_item_override mio
      where mio.menu_item_id = p_menu_item_id
        and mio.channel_id is null
        and p_location_id is not null and mio.location_id = p_location_id
        and mio.price is not null
      limit 1),
    (select mio.price from public.menu_item_override mio
      where mio.menu_item_id = p_menu_item_id
        and p_channel_id is not null and mio.channel_id = p_channel_id
        and mio.location_id is null
        and mio.price is not null
      limit 1),
    (select mi.price from public.menu_item mi where mi.id = p_menu_item_id)
  );
$$;

-- TEST DE REGRESIÓN OBLIGATORIO: con cero overrides de local, effective_price()
-- debe coincidir EXACTAMENTE con la lógica hoy en hubrise-catalog-publish
-- (override channel-only con location_id IS NULL, si no hay -> precio base)
-- para todo producto × canal delivery de toda marca catalog_source='folvy'.
-- Si algo no casa, la migración falla entera (no se cuela una cascada rota).
do $$
declare
  v_mismatches integer;
begin
  select count(*) into v_mismatches
  from (
    select mi.id as menu_item_id, sc.id as channel_id,
      coalesce(
        (select mio.price from public.menu_item_override mio
          where mio.menu_item_id = mi.id and mio.channel_id = sc.id
            and mio.location_id is null and mio.price is not null
          limit 1),
        mi.price
      ) as actual_price
    from public.menu_item mi
    join public.brand b on b.id = mi.brand_id
    join public.sales_channel sc on sc.account_id = mi.account_id
    where mi.is_active is distinct from false
      and sc.channel_type = 'delivery' and sc.archived_at is null and sc.is_active is distinct from false
      and b.catalog_source = 'folvy'
  ) actual
  where actual.actual_price is distinct from public.effective_price(actual.menu_item_id, actual.channel_id, null);

  if v_mismatches > 0 then
    raise exception 'effective_price() regression: % combos producto×canal no coinciden con el precio actual', v_mismatches;
  end if;
end $$;
