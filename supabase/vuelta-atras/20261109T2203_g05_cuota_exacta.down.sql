-- supabase/vuelta-atras/20261109T2203_g05_cuota_exacta.down.sql
-- Vuelta atrás de la 2203: las dos funciones de facturar como estaban (de su
-- respaldo, byte a byte) y fuera _conta_cobro_cuota_exacta. Las facturas ya
-- emitidas con su cuota se quedan como están (son contabilidad).
select public._restaurar_funcion('public._conta_cobro_facturar(uuid)', '20261109T2203_g05_cuota_exacta');
select public._restaurar_funcion('public._conta_cobro_facturar_portal(uuid,date,text,text,text)', '20261109T2203_g05_cuota_exacta');
drop function if exists public._conta_cobro_cuota_exacta(uuid, jsonb, numeric);
