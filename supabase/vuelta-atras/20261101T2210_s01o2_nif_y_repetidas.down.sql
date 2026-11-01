-- supabase/vuelta-atras/20261101T2210_s01o2_nif_y_repetidas.down.sql
--
-- Vuelta atrás de la 2210: las tres funciones como estaban (su respaldo, byte a byte) y fuera la clave.
select public._restaurar_funcion('public.supplier_invoice_repetida(uuid,uuid,text,text,date,numeric,uuid)', '20261101T2210_s01o2_nif_y_repetidas');
select public._restaurar_funcion('public.conta_factura_desde_lectura(uuid,uuid)', '20261101T2210_s01o2_nif_y_repetidas');
select public._restaurar_funcion('public.tg_supplier_invoice_no_repetida()', '20261101T2210_s01o2_nif_y_repetidas');
drop function if exists public._conta_nif_clave(text);
