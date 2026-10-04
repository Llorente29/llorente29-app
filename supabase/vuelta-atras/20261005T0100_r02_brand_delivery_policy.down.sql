-- ============================================================================
-- VUELTA ATRÁS de 20261005T0100_r02_brand_delivery_policy.sql
-- Quita la resolución y la tabla nueva. Va la última de las del R02.
-- ============================================================================
\ir 20261005T0100_r02_brand_delivery_policy.down.guarda.sql

drop function if exists public.resolve_delivery_by(uuid, uuid, text, uuid);
drop table if exists public.brand_delivery_policy;
drop function if exists public.tg_brand_delivery_policy_misma_cuenta();
