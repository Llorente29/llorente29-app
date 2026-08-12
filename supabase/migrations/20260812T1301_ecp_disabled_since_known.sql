-- Aplicada: 2026-08-12 por MCP
-- Encargo: ENCARGO_CODE_pantalla_agotados_last.md §0 (aplicado dentro de
-- last-catalog-sync v2, antes de la pantalla — la pantalla es un encargo
-- posterior).
--
-- external_catalog_product tiene datos del 21/06/2026. Muchos productos
-- figuran is_enabled=true cuando llevan semanas agotados de verdad. El
-- PRIMER barrido de last-catalog-sync vería la transición true->false y
-- sellaría disabled_since=hoy: "agotado desde hoy" para algo caído hace un
-- mes. Una mentira creíble, la peor clase.
--
-- disabled_since_known distingue una fecha REAL (observada en una
-- transición true->false vista por el barrido) de una fecha AUSENTE porque
-- no se puede conocer (producto ya agotado la primera vez que el barrido lo
-- toca). Un dato derivado que no se puede conocer se declara desconocido;
-- no se rellena con un valor plausible.
--
-- Regla que aplica supabase/functions/last-catalog-sync (ver index.ts):
--   1) primer barrido de una fila (last_synced_at IS NULL) y viene
--      enabled=false -> disabled_since = null, disabled_since_known = false.
--   2) transición true->false vista en vivo por el barrido -> disabled_since
--      = now(), disabled_since_known = true.
--   3) reactivación false->true -> disabled_since = null,
--      disabled_since_known = true.
--
-- default true es seguro para las filas ya existentes: hoy TODAS tienen
-- disabled_since null (nada sellado aún), así que no hay ninguna fecha
-- "conocida" falsa que declarar — el default solo importa a partir de que
-- el barrido nuevo empiece a sellar fechas de verdad.

alter table public.external_catalog_product
  add column if not exists disabled_since_known boolean not null default true;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='external_catalog_product'
      and column_name='disabled_since_known'
  ) then
    raise exception 'falta la columna disabled_since_known en external_catalog_product';
  end if;
end $$;
