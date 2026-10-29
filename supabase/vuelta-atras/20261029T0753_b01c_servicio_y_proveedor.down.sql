-- ============================================================================
-- VUELTA ATRÁS · 20261029T0753_b01c_servicio_y_proveedor.sql
-- ----------------------------------------------------------------------------
-- Las conexiones de open-banking.io fuera de bank_aggregator_link (sin ellas
-- no cabe el CHECK de antes; los extractos y movimientos que trajeron se
-- quedan: se quitan, si hace falta, con bank_extracto_deshacer), el CHECK del
-- proveedor como lo dejó la 0150, y _bank_cuenta_de_empresa restaurada del
-- respaldo que guardó la 0753 (_restaurar_funcion comprueba la huella).
-- ============================================================================

delete from public.bank_aggregator_link where provider = 'open_banking_io';
alter table public.bank_aggregator_link drop constraint if exists bank_aggregator_link_provider_check;
alter table public.bank_aggregator_link add constraint bank_aggregator_link_provider_check check (provider in ('simulado', 'enable_banking'));

select public._restaurar_funcion('public._bank_cuenta_de_empresa(uuid)', '20261029T0753_b01c_servicio_y_proveedor');
