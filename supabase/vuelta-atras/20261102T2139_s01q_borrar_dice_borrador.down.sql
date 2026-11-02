-- supabase/vuelta-atras/20261102T2139_s01q_borrar_dice_borrador.down.sql
--
-- Vuelta atrás de la 2120: _conta_asientos_borrar, la de antes (desde su respaldo).
select public._restaurar_funcion('public._conta_asientos_borrar(uuid,uuid[],text,text)', '20261102T2139_s01q_borrar_dice_borrador');
