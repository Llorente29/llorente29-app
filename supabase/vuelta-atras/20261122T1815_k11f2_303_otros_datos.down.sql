-- supabase/vuelta-atras/20261122T1815_k11f2_303_otros_datos.down.sql
--
-- K11f2 · vuelta atrás de 20261122T1815: las dos funciones desde su respaldo (el 303 vuelve a no leer «Otros datos» y el
-- contraasiento a no copiar la plataforma). Los contraasientos que ya la copiaron se quedan como están.
select public._restaurar_funcion('public.journal_entry_anular(uuid,text,date,text)', '20261122T1815_k11f2_303_otros_datos');
select public._restaurar_funcion('public.conta_impuesto_303_cajas(vat_book_entry)', '20261122T1815_k11f2_303_otros_datos');
