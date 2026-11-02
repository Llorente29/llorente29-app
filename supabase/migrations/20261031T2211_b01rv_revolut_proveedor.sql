-- ============================================================================
-- B01 Revolut · PR 1 · 2 · EL PROVEEDOR «revolut» EN LAS CUENTAS CONECTADAS
-- ----------------------------------------------------------------------------
-- Va después de la 2210 (que solo añade). Un cambio, declarado:
--
--   bank_aggregator_link: su CHECK del proveedor admite además «revolut».
--   Solo amplía: lo que cabía (simulado, enable_banking, open_banking_io)
--   sigue cabiendo. Así cada cuenta de Revolut se apunta como las de BBVA, por
--   bank_agregador_apuntar, y Bancos la pinta igual («Al día · hace 5 min»).
--
-- No toca datos ni nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261031T2211_b01rv_revolut_proveedor.down.sql
-- cambia: public.bank_aggregator_link · prueba: supabase/staging/sql/20261031_b01rv_revolut_prueba.sql
-- ============================================================================

alter table public.bank_aggregator_link drop constraint if exists bank_aggregator_link_provider_check;
alter table public.bank_aggregator_link add constraint bank_aggregator_link_provider_check
  check (provider in ('simulado', 'enable_banking', 'open_banking_io', 'revolut'));
