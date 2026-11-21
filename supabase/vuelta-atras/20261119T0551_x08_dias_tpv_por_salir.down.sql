-- supabase/vuelta-atras/20261119T0551_x08_dias_tpv_por_salir.down.sql
--
-- Vuelta atrás de 20261119T0551_x08_dias_tpv_por_salir.sql: la función nueva fuera.
-- No la llama ninguna otra función (solo la pantalla).
drop function if exists public.conta_erp10_dias_tpv_por_salir(uuid, date);
