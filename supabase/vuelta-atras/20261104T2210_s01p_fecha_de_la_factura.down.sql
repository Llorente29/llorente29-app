-- supabase/vuelta-atras/20261104T2210_s01p_fecha_de_la_factura.down.sql
-- Vuelta atrás de la 2210: la regla V04 de antes («nunca antes del día en que entró»), desde su respaldo.
select public._restaurar_funcion('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)', '20261104T2210_s01p_fecha_de_la_factura');
