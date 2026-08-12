-- 20260812T1300_ecp_sellos_disponibilidad.sql
-- Sellos de antiguedad para el espejo de disponibilidad de Last.
-- Aplicada: 2026-08-12 por MCP (verificada: 3 columnas + indice, 2.877 filas intactas)
-- Encargo: claude/ENCARGO_CODE_last_catalog_sync_v2.md
--
-- external_catalog_product ya guardaba is_enabled por (catalogo, local) — su unique
-- (account_id, source, catalog_product_id, external_location_id) es el correcto — pero
-- le faltaba SABER DESDE CUANDO. Sin eso el informe es una foto, no una historia:
-- "Bendito Burrito lleva 6 dias caido" vale mucho mas que una lista de nombres.
--
--   disabled_since: cuando paso a agotado. NO se pisa mientras siga agotado.
--   missing_since : cuando dejo de aparecer en el catalogo de Last.
--   last_synced_at: cuando se comprobo por ultima vez (vigia de espejo rancio).
--
-- El vigia sobre last_synced_at es la pata que faltaba: el espejo llevaba 52 dias
-- congelado (21/06/2026) y nadie se entero.
--
-- NO reejecutar contra produccion: ya esta aplicada. Idempotente y no destructivo.

alter table public.external_catalog_product
  add column if not exists disabled_since timestamptz,
  add column if not exists missing_since  timestamptz,
  add column if not exists last_synced_at timestamptz;

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
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='ecp_agotados_idx'
  ) then
    raise exception 'falta el indice ecp_agotados_idx';
  end if;
end $$;
