-- supabase/vuelta-atras/20261102T1216_s01q_motor_mes.down.sql
--
-- Vuelta atrás de la 1216: fuera la vista del mes. El motor de siempre no se tocó.
drop function if exists public.conta_liquidaciones_mes(uuid, date);
