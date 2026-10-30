-- supabase/vuelta-atras/20261030T1638_s01d_contrato_parcial.down.sql
--
-- Vuelta atrás de la 1638: bank_contrato_guardar como estaba (del respaldo,
-- con su huella). Un contrato guardado con cuadro parcial se queda como está:
-- solo deja de poder guardarse otro igual.
select public._restaurar_funcion('public.bank_contrato_guardar(uuid,jsonb)', '20261030T1638_s01d_contrato_parcial');
