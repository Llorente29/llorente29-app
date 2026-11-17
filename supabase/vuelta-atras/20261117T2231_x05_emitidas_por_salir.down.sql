-- supabase/vuelta-atras/20261117T2231_x05_emitidas_por_salir.down.sql
--
-- X05 · Vuelta atrás: quita la función nueva (solo lee; no deja nada detrás).

drop function if exists public.conta_erp10_emitidas_por_salir(uuid, date);
