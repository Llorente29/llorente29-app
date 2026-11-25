-- supabase/vuelta-atras/20261125T0816_x14b_ejercicios_que_falten.down.sql
-- X14 · 1b · Devuelve conta_traer_cargar y conta_traer_deshacer a sus respaldos: «Traer» vuelve a parar sin el ejercicio.
-- Los ejercicios que ya haya creado una carga se quedan (son de verdad y pueden tener asientos): se quitan deshaciendo la carga
-- ANTES de esta vuelta atrás.
select public._restaurar_funcion('public.conta_traer_deshacer(uuid,text)', '20261125T0816_x14b_ejercicios_que_falten');
select public._restaurar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261125T0816_x14b_ejercicios_que_falten');
