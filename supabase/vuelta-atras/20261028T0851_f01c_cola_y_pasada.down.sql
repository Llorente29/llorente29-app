-- supabase/vuelta-atras/20261028T0851_f01c_cola_y_pasada.down.sql
--
-- Vuelta atrás de la 0851 (F01 · PR 3): quita el disparador de recipe_line y
-- restaura f01_pasada_last byte a byte como la dejó la 1320
-- (_restaurar_funcion comprueba la huella). Lo que la pasada ya hizo (marcas
-- unidas, ventas colocadas) se queda: es verdad con o sin la 0851.

drop trigger if exists trg_recipe_line_f01c_receta_puesta on public.recipe_line;
select public._restaurar_funcion('public.f01_pasada_last(uuid)', '20261028T0851_f01c_cola_y_pasada');
