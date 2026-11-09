-- supabase/vuelta-atras/20261109T1007_g05_numero_con_formato.down.sql
--
-- Vuelta atrás de la 1007 del G05: conta_venta_emitir vuelve a ser la de antes,
-- la del respaldo que guardó la 1007 (la de producción el 09/11, md5 del cuerpo
-- 4b3ffe4c13b8c7b4f7dc98acaed6c187: el número de siempre, sin mirar el formato
-- de la serie; _restaurar_funcion comprueba la huella) y se quita
-- _conta_numero_con_formato. Las facturas ya emitidas con el formato nuevo se
-- quedan con su número (un número emitido no se toca). Va antes de la vuelta
-- atrás de la 1006 (que quita invoice_series.formato).

select public._restaurar_funcion('public.conta_venta_emitir(uuid,text)', '20261109T1007_g05_numero_con_formato');

drop function if exists public._conta_numero_con_formato(text, int, text, int);
