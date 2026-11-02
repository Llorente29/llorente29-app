-- supabase/vuelta-atras/20261101T2248_n1c_centro_de_folvy.down.sql
--
-- Vuelta atrás de la 2248: lab_volcar_lote y lab_centros_del_lote como
-- estaban (del respaldo, con su huella), en orden inverso. La fila
-- «__sin_centro__» de lab_centro_local, si se confirmó, se queda: no estorba,
-- ningún centro de Cegid se llama así.
select public._restaurar_funcion('public.lab_volcar_lote(uuid)', '20261101T2248_n1c_centro_de_folvy');
select public._restaurar_funcion('public.lab_centros_del_lote(uuid)', '20261101T2248_n1c_centro_de_folvy');
