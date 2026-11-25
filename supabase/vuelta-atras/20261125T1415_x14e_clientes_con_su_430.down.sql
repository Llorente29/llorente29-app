-- supabase/vuelta-atras/20261125T1415_x14e_clientes_con_su_430.down.sql
-- X14 · 2 · Devuelve conta_traer_cargar y conta_traer_deshacer a sus respaldos (Traer deja de poner el código de cliente y
-- vuelve a quedarse con lo de Sumied) y quita las piezas nuevas. Lo ya puesto por una carga se queda (es de verdad): se
-- quita deshaciendo la carga ANTES. El ajuste del 2024 se devuelve con la vuelta atrás de su fichero, que va antes.
select public._restaurar_funcion('public.conta_traer_deshacer(uuid,text)', '20261125T1415_x14e_clientes_con_su_430');
select public._restaurar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261125T1415_x14e_clientes_con_su_430');
drop function if exists public._conta_traer_ajustar_a_erp10(uuid, text);
drop function if exists public._conta_traer_como_erp10_deshacer(jsonb);
drop function if exists public._conta_traer_como_erp10(uuid, uuid, uuid, text, uuid, text, text);
