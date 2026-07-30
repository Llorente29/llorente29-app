-- 20260730T1713_stock_group_unique_index_fix.sql
-- ============================================================================
-- CORRECTIVA — 20260730T1700 reportó "Success" pero uq_stock_group_hubrise_ref
-- (UNIQUE compuesto account_id, hubrise_ref) no quedó creado de verdad en la
-- BBDD viva — confirmado por Julio. El fichero 20260730T1700 en sí está
-- completo y correcto (mismo patrón que 20260730T1710: discrepancia de
-- ejecución, no de autoría). Se re-aplica aquí, aislado, con GUARD real
-- contra pg_indexes.
--
-- Folvy es multi-tenant: el índice es COMPUESTO (account_id, hubrise_ref) a
-- propósito — el ref solo necesita ser único POR CUENTA, no global.
--
-- No se edita 20260730T1700 (ya "aplicada"). Idempotente: DROP incondicional
-- (por si quedó creado bajo el mismo nombre con otra definición — un
-- IF NOT EXISTS no lo habría corregido) + CREATE con la definición correcta.
-- Aplicada: —
-- ============================================================================

begin;

drop index if exists public.uq_stock_group_hubrise_ref;
create unique index if not exists uq_stock_group_hubrise_ref
  on public.stock_group (account_id, hubrise_ref);

-- GUARD: verificar contra pg_indexes que quedó de verdad creado — no dar por
-- hecho el CREATE.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'stock_group'
      and indexname = 'uq_stock_group_hubrise_ref'
      and indexdef ilike '%(account_id, hubrise_ref)%'
  ) then
    raise exception 'uq_stock_group_hubrise_ref no quedó creado como UNIQUE (account_id, hubrise_ref) — abortando';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select indexname, indexdef from pg_indexes where tablename = 'stock_group';
-- Debe mostrar uq_stock_group_hubrise_ref con (account_id, hubrise_ref).
