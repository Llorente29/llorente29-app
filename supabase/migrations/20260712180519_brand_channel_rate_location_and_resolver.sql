-- 1) location_id opcional en brand_channel_rate (override fino por local)
alter table public.brand_channel_rate
  add column if not exists location_id uuid references public.locations(id) on delete cascade;

comment on column public.brand_channel_rate.location_id is
  'Override de tarifa para un local concreto. NULL = aplica a todos los locales de la marca en ese canal. Resolucion: (marca+local) > (marca, local NULL) > channel_rate defecto del canal.';

-- 2) unique que incluye location_id (NULLS NOT DISTINCT, PG15+) para que
--    (brand_channel, service_type, NULL) siga siendo unica y no se dupliquen overrides
alter table public.brand_channel_rate
  drop constraint if exists brand_channel_rate_brand_channel_id_service_type_key;

create unique index if not exists brand_channel_rate_bc_st_loc_key
  on public.brand_channel_rate (brand_channel_id, service_type, location_id) nulls not distinct;

-- 3) resolutor de comision en cascada: (marca+local) > (marca) > defecto canal
create or replace function public.resolve_channel_commission(
  p_account uuid, p_channel uuid, p_brand uuid, p_location uuid, p_service_type text
) returns numeric
language sql stable security invoker as $$
  select coalesce(
    (
      select r.commission_pct
      from public.brand_channel_rate r
      join public.brand_channel bc on bc.id = r.brand_channel_id
      where r.account_id = p_account
        and bc.brand_id = p_brand
        and bc.channel_id = p_channel
        and r.service_type = p_service_type
        and coalesce(r.is_active, true)
        and (r.location_id = p_location or r.location_id is null)
      order by (r.location_id is not null) desc   -- local concreto primero
      limit 1
    ),
    (
      select cr.commission_pct
      from public.channel_rate cr
      where cr.account_id = p_account
        and cr.sales_channel_id = p_channel
        and cr.service_type = p_service_type
        and coalesce(cr.is_active, true)
      limit 1
    )
  );
$$;

comment on function public.resolve_channel_commission is
  'Devuelve la comision (%) de un pedido segun cuenta/canal/marca/local/modo, en cascada: brand_channel_rate por local > por marca > channel_rate defecto.';