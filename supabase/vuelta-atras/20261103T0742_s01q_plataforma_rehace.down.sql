-- supabase/vuelta-atras/20261103T0742_s01q_plataforma_rehace.down.sql
-- Vuelta atrás de la 0742: las dos funciones, las de antes (desde su respaldo).
select public._restaurar_funcion('public._conta_plataforma_entrada(uuid,uuid)', '20261103T0742_s01q_plataforma_rehace');
select public._restaurar_funcion('public._conta_proponer_plataforma(uuid,uuid,text)', '20261103T0742_s01q_plataforma_rehace');
