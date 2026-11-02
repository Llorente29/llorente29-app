-- supabase/vuelta-atras/20261101T1703_b01p_dejar_de_pagar.down.sql
--
-- Vuelta atrás de la 1703 (B01 Revolut · PR 2c-1): quita «dejar de pagar» y la
-- columna de a qué se fue a Revolut. Lo que ya se quitó o canceló con ella se
-- queda así (son permisos y pagos de verdad).
drop function if exists public.conta_pago_dejar(uuid, uuid, text, text);
alter table public.revolut_conexion drop constraint if exists revolut_conexion_oauth_para_check;
alter table public.revolut_conexion drop column if exists oauth_para;
