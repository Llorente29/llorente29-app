-- Aplicada: 2026-08-08 por MCP.
-- Cargador del historico. Recibe el lote en formato compacto y lo inserta.
-- Formato: 'L|YYYY-MM-DD|pedidos|platos|bebidas|postres;L|...'
--   L = A (Alcala) | C (Carabanchel) | P (Plaza Castilla)
-- Idempotente por el UNIQUE (account, location, day, scope, source).

CREATE OR REPLACE FUNCTION public.load_sales_history_batch(p_batch text)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $function$
declare v_n integer;
begin
  with parsed as (
    select string_to_array(rec, '|') a
    from unnest(string_to_array(p_batch, ';')) rec
    where length(trim(rec)) > 0
  ),
  mapped as (
    select case a[1]
             when 'A' then '38158159-cd71-4056-950b-53425afac1ce'::uuid
             when 'C' then '92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid
             when 'P' then '629f9154-b888-48ed-9b8c-ffae77620615'::uuid
           end loc,
           a[2]::date d, a[3]::int o, a[4]::numeric pl, a[5]::numeric be, a[6]::numeric po
    from parsed
  )
  insert into public.sales_history_daily
    (account_id, location_id, day, scope, orders, dishes, drinks, desserts, source)
  select '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid, loc, d, 'licensed', o, pl, be, po,
         'lastapp_tabs_export'
  from mapped where loc is not null
  on conflict (account_id, location_id, day, scope, source) do update
    set orders = excluded.orders, dishes = excluded.dishes,
        drinks = excluded.drinks, desserts = excluded.desserts;

  get diagnostics v_n = row_count;
  return v_n;
end $function$;

DO $g$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='load_sales_history_batch') THEN
    RAISE EXCEPTION 'load_sales_history_batch no quedo'; END IF;
END $g$;
