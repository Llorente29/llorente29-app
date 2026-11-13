-- supabase/vuelta-atras/20261113T1504_s01p_correo_por_aclarar.down.sql
--
-- S01p·20 · 1 · la vuelta atrás: fuera las tres funciones. Las filas «por aclarar» que ya
-- se hayan creado se quedan en la bandeja (son correos que llegaron y no se entendieron).

drop function if exists public.conta_correo_sin_factura_pdf(uuid, text, text, text, integer, text);
drop function if exists public.conta_entrada_sin_factura_resuelta(uuid, text, text);
drop function if exists public.conta_entrada_sin_factura(jsonb);
