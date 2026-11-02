-- supabase/vuelta-atras/20261101T2154_n1b_campo_del_fichero.down.sql
--
-- Vuelta atrás de la 2154: _lab_campo como estaba (solo por el nombre), del
-- respaldo con su huella.
select public._restaurar_funcion('public._lab_campo(uuid,text,text)', '20261101T2154_n1b_campo_del_fichero');
