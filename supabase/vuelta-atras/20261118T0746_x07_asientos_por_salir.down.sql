-- supabase/vuelta-atras/20261118T0746_x07_asientos_por_salir.down.sql
--
-- X07 · Vuelta atrás: quita la función nueva (solo lee; no deja nada detrás).

drop function if exists public.conta_erp10_asientos_por_salir(uuid, date);
