-- supabase/migrations/20260613T2000_sale_external_tab_ref.sql
-- ============================================================================
-- CAPA 0b del KDS — IDENTIDAD DEL PEDIDO VIVO (tab.id)
-- ============================================================================
-- Añade `sale.external_tab_ref` = id del TAB de Last (el "pedido" tal como lo ve
-- la cocina). La venta se sigue identificando por `external_ref = bill.id` (una
-- venta por bill, modelo canónico actual); `external_tab_ref` es metadato ADITIVO
-- que:
--   - habilita AGRUPAR varias ventas del mismo tab en el KDS (split de bills),
--   - prepara la futura reconciliación de SALA (tab sin bill al abrir),
--   sin reescribir el modelo. Debt-zero, future-proof.
--
-- Se rellena desde el webhook en tab:created / tab:updated / tab:closed.
-- Additivo y nullable: el histórico queda con NULL (no se recasa; innecesario).
-- ============================================================================

alter table sale add column if not exists external_tab_ref text;

create index if not exists sale_external_tab_ref_idx
  on sale (account_id, external_tab_ref);
