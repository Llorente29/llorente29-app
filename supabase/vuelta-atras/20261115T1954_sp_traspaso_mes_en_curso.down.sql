-- supabase/vuelta-atras/20261115T1954_sp_traspaso_mes_en_curso.down.sql
--
-- SP · la vuelta atrás: conta_traspaso_confirmar y conta_traspaso_terminar desde su respaldo
-- (el mes en curso vuelve a no poder traspasarse hasta el día 1 del siguiente).
select public._restaurar_funcion('public.conta_traspaso_terminar(uuid,jsonb,boolean)', '20261115T1954_sp_traspaso_mes_en_curso');
select public._restaurar_funcion('public.conta_traspaso_confirmar(uuid,date)', '20261115T1954_sp_traspaso_mes_en_curso');
