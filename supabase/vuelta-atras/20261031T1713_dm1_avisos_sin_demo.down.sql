-- supabase/vuelta-atras/20261031T1713_dm1_avisos_sin_demo.down.sql
-- Vuelta atrás de la 1713 (DM1 · PR 2a): encolar_alerta como estaba, del
-- respaldo y con su huella. Los avisos de una cuenta de demo vuelven a
-- encolarse: antes, quitar la marca de demo si alguna cuenta la tiene.
select public._restaurar_funcion('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)', '20261031T1713_dm1_avisos_sin_demo');
