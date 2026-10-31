-- supabase/vuelta-atras/20261031T0930_s01g_soporte_columnas.down.sql
--
-- Vuelta atrás de la 0930: fuera las dos funciones y las dos columnas (lo
-- que guardan se pierde: qué recepciones se dijeron «no es soporte»).
drop function if exists public.conta_llegada_pdf_subido(uuid, text, text, text, integer, text);
drop function if exists public.conta_recepcion_no_es_soporte(uuid);
alter table public.goods_receipt_path drop column if exists not_support_by_name;
alter table public.goods_receipt_path drop column if exists not_support_at;
