-- supabase/vuelta-atras/20261031T1912_dm1_vigias_sin_demo.down.sql
-- Vuelta atrás de la 1912 (DM1 · PR 2a): las seis vigías como estaban, del
-- respaldo y con su huella. Una cuenta de demo vuelve a contar en ellas:
-- antes, quitar la marca de demo si alguna cuenta la tiene.
select public._restaurar_funcion('public._generate_daily_count_core(uuid,uuid,uuid[],integer,numeric,boolean)', '20261031T1912_dm1_vigias_sin_demo');
select public._restaurar_funcion('public.modifier_zero_cost_watchdog(interval,interval)', '20261031T1912_dm1_vigias_sin_demo');
select public._restaurar_funcion('public.modifier_incomplete_impact_watchdog(interval)', '20261031T1912_dm1_vigias_sin_demo');
select public._restaurar_funcion('public.sales_unmapped_watchdog(integer,integer)', '20261031T1912_dm1_vigias_sin_demo');
select public._restaurar_funcion('public.kds_device_stale_bundle_check()', '20261031T1912_dm1_vigias_sin_demo');
select public._restaurar_funcion('public.codigo_plataforma_watchdog(integer,numeric,interval)', '20261031T1912_dm1_vigias_sin_demo');
