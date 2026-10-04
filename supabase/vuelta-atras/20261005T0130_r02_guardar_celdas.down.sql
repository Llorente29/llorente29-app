-- ============================================================================
-- VUELTA ATRÁS de 20261005T0130_r02_guardar_celdas.sql
-- Quita las tres funciones de guardado. No tienen datos propios: lo guardado
-- está en brand_delivery_policy y channel_delivery_policy, que se quedan.
-- ============================================================================
drop function if exists public.reparto_cambiar_desde_pedido(uuid, text);
drop function if exists public.reparto_guardar_herencia(uuid, text, text, uuid, text);
drop function if exists public.reparto_guardar_celda(uuid, uuid, text, uuid, text, text);
