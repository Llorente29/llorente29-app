-- supabase/vuelta-atras/20261102T0929_s01o3_comun_por_defecto.down.sql
--
-- Vuelta atrás de la 0140: la regla como estaba y fuera la columna. Lo que ya se apuntó común se queda.
select public._restaurar_funcion('public._conta_factura_segura(uuid)', '20261102T0929_s01o3_comun_por_defecto');
alter table public.supplier drop column if exists default_common;
