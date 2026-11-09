-- supabase/vuelta-atras/20261109T1403_g05_t4_ficha_factura.down.sql
-- Vuelta atrás de la 1403: fuera la lectura de la ficha de la factura de un recibo.
drop function if exists public.conta_pantalla_factura_recibo(uuid, uuid);
