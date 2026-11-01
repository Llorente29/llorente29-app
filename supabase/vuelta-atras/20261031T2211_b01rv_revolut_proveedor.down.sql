-- Vuelta atrás de 20261031T2211_b01rv_revolut_proveedor.sql
-- Las cuentas conectadas a Revolut fuera de bank_aggregator_link (sin ellas no
-- cabe el CHECK de antes; los extractos y movimientos que trajeron se quedan),
-- y el CHECK del proveedor como lo dejó la 0753 del B01c.
delete from public.bank_aggregator_link where provider = 'revolut';
alter table public.bank_aggregator_link drop constraint if exists bank_aggregator_link_provider_check;
alter table public.bank_aggregator_link add constraint bank_aggregator_link_provider_check
  check (provider in ('simulado', 'enable_banking', 'open_banking_io'));
