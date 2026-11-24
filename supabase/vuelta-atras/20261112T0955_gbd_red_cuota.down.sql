-- supabase/vuelta-atras/20261112T0955_gbd_red_cuota.down.sql
-- GBd · la vuelta atrás de la 0955: fuera las dos funciones de la red y su tabla
-- (lo apuntado de las devoluciones de prueba se va con ella).
drop function if exists public.conta_bitrix_red_apuntar(uuid, jsonb);
drop function if exists public.conta_bitrix_red_leer(uuid, text);
drop table if exists public.conta_bitrix_red;
