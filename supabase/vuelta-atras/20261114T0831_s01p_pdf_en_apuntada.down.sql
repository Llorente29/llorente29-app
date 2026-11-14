-- supabase/vuelta-atras/20261114T0831_s01p_pdf_en_apuntada.down.sql
--
-- S01p·22 · la vuelta atrás: conta_recibida_papel_poner desde su respaldo (rechaza toda apuntada).
select public._restaurar_funcion('public.conta_recibida_papel_poner(uuid,text,text,text)', '20261114T0831_s01p_pdf_en_apuntada');
