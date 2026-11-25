-- supabase/vuelta-atras/20261125T0903_x14c_dia_de_inicio_a_mano.down.sql
-- X14 · 2 · Devuelve las cuatro funciones a sus respaldos: «Traer» vuelve a fijar el día de inicio en el siguiente al último
-- traído, y el corte a mano vuelve a pararse con cualquier asiento traído. No cambia ninguna fila: lo traído mientras tanto
-- se queda sin día de inicio (se fija a mano o se deshace la carga).
select public._restaurar_funcion('public.fiscal_year_corte_cambiable()', '20261125T0903_x14c_dia_de_inicio_a_mano');
select public._restaurar_funcion('public.conta_fijar_corte(uuid,date,text)', '20261125T0903_x14c_dia_de_inicio_a_mano');
select public._restaurar_funcion('public._conta_traer_seguir(uuid,timestamp with time zone)', '20261125T0903_x14c_dia_de_inicio_a_mano');
select public._restaurar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261125T0903_x14c_dia_de_inicio_a_mano');
