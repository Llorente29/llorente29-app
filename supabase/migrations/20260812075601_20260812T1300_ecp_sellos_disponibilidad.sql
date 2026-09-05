-- 20260812T1300_ecp_sellos_disponibilidad.sql
-- Sellos de antiguedad para el espejo de disponibilidad de Last.
-- external_catalog_product ya guarda is_enabled por (catalogo, local); le faltaba
-- SABER DESDE CUANDO. Sin esto el informe es una foto, no una historia.
-- disabled_since: cuando paso a agotado (no se pisa mientras siga agotado).
-- missing_since : cuando dejo de aparecer en el catalogo de Last.
-- last_synced_at: cuando se comprobo por ultima vez (vigia de espejo rancio).

alter table public.external_catalog_product
  add column if not exists disabled_since timestamptz,
  add column if not exists missing_since  timestamptz,
  add column if not exists last_synced_at timestamptz;

-- Los agotados en Folvy solo cuentan si el producto existe en la carta de Folvy.
create index if not exists ecp_agotados_idx
  on public.external_catalog_product (account_id, external_location_id)
  where is_enabled = false;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='external_catalog_product'
      and column_name in ('disabled_since','missing_since','last_synced_at')
    having count(*) = 3
  ) then
    raise exception 'faltan columnas de sello en external_catalog_product';
  end if;
end $$;