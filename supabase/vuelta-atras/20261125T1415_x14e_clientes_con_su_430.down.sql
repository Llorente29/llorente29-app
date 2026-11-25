-- supabase/vuelta-atras/20261125T1415_x14e_clientes_con_su_430.down.sql
-- X14 · 2 · Devuelve conta_traer_cargar y conta_traer_deshacer a sus respaldos: Traer deja de poner el código de cliente.
-- Los códigos ya puestos por una carga se quedan (son de verdad y los usa el cobro): se quitan deshaciendo la carga ANTES.
select public._restaurar_funcion('public.conta_traer_deshacer(uuid,text)', '20261125T1415_x14e_clientes_con_su_430');
select public._restaurar_funcion('public.conta_traer_cargar(uuid,text,jsonb,text)', '20261125T1415_x14e_clientes_con_su_430');
