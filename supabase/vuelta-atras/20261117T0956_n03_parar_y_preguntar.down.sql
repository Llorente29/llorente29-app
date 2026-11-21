-- supabase/vuelta-atras/20261117T0956_n03_parar_y_preguntar.down.sql
--
-- N03 · la vuelta atrás de lo que cambia: las tres funciones desde su respaldo. Las respuestas
-- guardadas se quedan en la factura (la 0955), sin efecto.
select public._restaurar_funcion('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)', '20261117T0956_n03_parar_y_preguntar');
select public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261117T0956_n03_parar_y_preguntar');
select public._restaurar_funcion('public.conta_pagos_lista(uuid,date)', '20261117T0956_n03_parar_y_preguntar');
