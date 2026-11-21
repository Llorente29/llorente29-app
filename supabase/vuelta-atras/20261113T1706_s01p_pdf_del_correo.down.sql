-- supabase/vuelta-atras/20261113T1706_s01p_pdf_del_correo.down.sql
--
-- S01p·20 · 1b · la vuelta atrás: fuera las dos funciones. Los PDF que ya se hayan puesto se quedan
-- como el papel de su factura (son su correo; quitarlos dejaría la factura sin papel).

drop function if exists public.conta_correo_papeles_que_faltan(uuid);
drop function if exists public.conta_factura_papel_del_correo(uuid, text);
