-- supabase/migrations/20260701T1400_shop_locations_by_slug.sql
--
-- RPC pública para la tienda Folvy Shop (sin sesión): locales activos de la
-- cuenta dueña del slug, con nombre y dirección. La usa el checkout para el
-- selector de recogida (multi-local) y para mostrar dónde recoge el cliente.
-- Solo lectura, datos no sensibles (nombre + dirección pública del local).

create or replace function shop_locations_by_slug(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', l.id, 'name', l.name, 'address', l.address)
      order by l.name
    ),
    '[]'::jsonb
  )
  from locations l
  join accounts a on a.id = l.account_id
  where a.slug = p_slug
    and l.active = true;
$$;

grant execute on function shop_locations_by_slug(text) to anon, authenticated;
