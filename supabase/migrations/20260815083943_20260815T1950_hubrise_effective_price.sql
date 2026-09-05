-- 1.5 (ENCARGO CODE HubRise F1) — effective_price(): cascada de precio única,
-- firmada, consumible por publish/TPV/Shop/economía.
-- Cascada: (local+canal) → (local) → (canal global) → menu_item.price (base).
-- Hoy NO hay overrides de local (0 filas con location_id en menu_item_override,
-- verificado); con p_location_id arbitrario la cascada colapsa exactamente al
-- comportamiento actual: (canal global) → base.
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
