-- ============================================================================
-- VUELTA ATRÁS de 20261005T0110_r02_filas_migradas.sql
-- Quita SOLO las filas que escribió la migración (source = 'migrated'). Lo que
-- haya decidido una persona o aceptado de la IA se queda.
-- ============================================================================
\ir 20261005T0110_r02_filas_migradas.down.guarda.sql

delete from public.brand_delivery_policy where source = 'migrated';
