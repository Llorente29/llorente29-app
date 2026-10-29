-- supabase/vuelta-atras/20261029T0733_l1a_informe_origen.down.sql
--
-- Deja _informe_registro_jornada como estaba antes de la 0733 (la de la 0705,
-- con su huella: _restaurar_funcion la compara) y quita _solo_cambia_origen.

select public._restaurar_funcion('public._informe_registro_jornada(uuid,date,date,boolean,boolean)', '20261029T0733_l1a_informe_origen');
drop function if exists public._solo_cambia_origen(jsonb, jsonb);
