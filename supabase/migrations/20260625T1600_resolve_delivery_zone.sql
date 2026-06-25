create or replace function public.resolve_delivery_zone(
  p_account_id uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_postal     text default null
)
returns table (
  zone_id      uuid,
  location_id  uuid,
  zone_name    text,
  method       text,
  delivery_fee numeric,
  min_order    numeric,
  eta_min      integer
)
language sql
stable
security definer
set search_path = public
as $$
  with pt as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g
  )
  select z.id, z.location_id, z.name, z.method, z.delivery_fee, z.min_order, z.eta_min
  from public.delivery_zone z, pt
  where z.account_id = p_account_id
    and z.is_active
    and (
      (z.method = 'radius'  and ST_DWithin(z.center, pt.g, z.radius_m))
      or
      (z.method = 'polygon' and ST_Covers(z.area, pt.g))
      or
      (z.method = 'postal'  and p_postal is not null and p_postal = any (z.postal_codes))
    )
  order by z.delivery_fee asc, z.priority desc, z.id asc
  limit 1;
$$;

comment on function public.resolve_delivery_zone is
  'Resuelve la zona de entrega más barata que cubre un punto (regla Uber). Devuelve local+coste+mínimo+ETA, o 0 filas si no hay cobertura. SECURITY DEFINER: verificar desde la app.';

grant execute on function public.resolve_delivery_zone(uuid, double precision, double precision, text) to authenticated;
