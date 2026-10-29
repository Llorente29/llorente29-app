-- supabase/vuelta-atras/20261028T1934_l1a3_fichar_con_precision.down.sql
--
-- Deja fichar() como antes de la 1934, byte a byte, desde su respaldo
-- (_restaurar_funcion compara la huella; replace mantiene sus permisos), y
-- quita fichar_con_precision. La precisión ya guardada se queda en su columna
-- hasta la vuelta atrás de la 1800.

select public._restaurar_funcion('public.fichar(uuid,text,text,uuid,double precision,double precision,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text)', '20261028T1934_l1a3_fichar_con_precision');
drop function if exists public.fichar_con_precision(uuid,text,text,uuid,float8,float8,timestamptz,timestamptz,text,boolean,integer,text,text,boolean,text,integer);
