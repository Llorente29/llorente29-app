-- supabase/vuelta-atras/20261103T1527_s01q_mes_rapido.down.sql
-- Vuelta atrás de la 1527: las dos funciones, las de antes (desde su respaldo).
select public._restaurar_funcion('public.conta_liquidaciones_mes(uuid,date)', '20261103T1527_s01q_mes_rapido');
select public._restaurar_funcion('public.conta_liquidaciones(uuid,date,date)', '20261103T1527_s01q_mes_rapido');
