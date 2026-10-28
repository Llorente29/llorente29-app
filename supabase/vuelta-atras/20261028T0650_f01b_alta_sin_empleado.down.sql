-- supabase/vuelta-atras/20261028T0650_f01b_alta_sin_empleado.down.sql
--
-- Vuelta atrás de la 0650 (F01 · PR 2): restaura _f01_alta_marca byte a byte
-- como la dejó la 1320 (_restaurar_funcion comprueba la huella). Las marcas
-- dadas de alta mientras tanto se quedan como están (created_by null).

select public._restaurar_funcion('public._f01_alta_marca(uuid,uuid,text,text,boolean,text,boolean,uuid,text)', '20261028T0650_f01b_alta_sin_empleado');
