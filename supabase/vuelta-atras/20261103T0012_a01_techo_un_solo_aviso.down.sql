-- supabase/vuelta-atras/20261103T0012_a01_techo_un_solo_aviso.down.sql
-- Vuelta atrás de la 0012 (A01 · techo): _aviso_poner_en_cola como la dejó el
-- #450, del respaldo y con su huella.
select public._restaurar_funcion('public._aviso_poner_en_cola(text,text,text,text,uuid,uuid,uuid,text,integer)', '20261103T0012_a01_techo_un_solo_aviso');
