-- supabase/vuelta-atras/20261113T1136_s01p_uber_sin_tienda.down.sql
--
-- S01p·18 · 6 · la vuelta atrás: fuera las dos funciones. Lo que ya se haya asignado con el
-- botón se queda asignado (es el local y la marca de su tienda en su fecha).

drop function if exists public.conta_liquidacion_asignar_tienda(uuid, text);
drop function if exists public.conta_liquidaciones_sin_tienda(uuid, date, date);
