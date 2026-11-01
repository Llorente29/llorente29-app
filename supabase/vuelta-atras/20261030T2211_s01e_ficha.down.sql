-- supabase/vuelta-atras/20261030T2211_s01e_ficha.down.sql
--
-- Vuelta atrás de la 2211: bank_casar y bank_contrato_guardar como estaban
-- (de su respaldo, con su huella). Lo que ya guardaron (el contrato y la fila
-- de un cargo casado, un cuadro sustituido) se queda como está.
select public._restaurar_funcion('public.bank_contrato_guardar(uuid,jsonb)', '20261030T2211_s01e_ficha');
select public._restaurar_funcion('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)', '20261030T2211_s01e_ficha');
